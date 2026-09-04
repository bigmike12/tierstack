import { describe, expect, it } from "vitest";
import { addInterval, type BillingInterval } from "@tierstack/shared";
import {
  classifyHistoricalRecovery,
  isCatchUpInvoice,
  isPeriodDue,
  planPaymentRecovery,
  type RecoveryInput,
} from "./recovery";
import type { SubscriptionStatus } from "./state-machine";

const MONTHLY: BillingInterval = { unit: "MONTH", count: 1 };
const DAILY: BillingInterval = { unit: "DAY", count: 1 };

/** The subscription columns the renewal and recovery paths actually read. */
interface SubscriptionRow {
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  billingAnchorDay: number | null;
}

const iso = (value: string) => new Date(value);

function subscription(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    status: "UNPAID",
    currentPeriodStart: iso("2026-02-01T00:00:00Z"),
    currentPeriodEnd: iso("2026-03-01T00:00:00Z"),
    billingAnchorDay: 1,
    ...over,
  };
}

/** A settled payment, applied the way applyPaymentResult applies one. */
function recover(row: SubscriptionRow, interval: BillingInterval, recoveredAt: Date): SubscriptionRow {
  const plan = planPaymentRecovery({ ...row, interval, recoveredAt } satisfies RecoveryInput);
  if (!plan.recovers) return row;
  return {
    status: "ACTIVE",
    // A plan that did not rebase must leave the period columns alone.
    currentPeriodStart: plan.rebased ? plan.currentPeriodStart : row.currentPeriodStart,
    currentPeriodEnd: plan.rebased ? plan.currentPeriodEnd : row.currentPeriodEnd,
    billingAnchorDay: plan.rebased ? plan.billingAnchorDay : row.billingAnchorDay,
  };
}

interface IssuedInvoice {
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
}

/**
 * The renewals sweep, reduced to the decisions the engine makes per pass: pick
 * up subscriptions whose period has ended, and — for each, re-checking under
 * the lock via `isPeriodDue` exactly as renewSubscription does — open the next
 * period from the previous period end and invoice it.
 *
 * The period arithmetic mirrors renewSubscription; the guard that decides
 * whether a pass bills at all is the production function.
 */
function runRenewalSweeps(
  row: SubscriptionRow,
  interval: BillingInterval,
  ticks: readonly Date[]
): { row: SubscriptionRow; invoices: IssuedInvoice[] } {
  const invoices: IssuedInvoice[] = [];
  let current = row;

  for (const now of ticks) {
    if (!["ACTIVE", "TRIALING"].includes(current.status)) continue;
    if (!isPeriodDue(current.currentPeriodEnd, now)) continue;

    const periodStart = current.currentPeriodEnd;
    const periodEnd = addInterval(periodStart, interval, current.billingAnchorDay ?? undefined);
    invoices.push({ billingPeriodStart: periodStart, billingPeriodEnd: periodEnd });
    current = { ...current, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd };
  }

  return { row: current, invoices };
}

/** One sweep tick per day, from `from` up to and including `to`. */
function dailyTicks(from: Date, to: Date): Date[] {
  const ticks: Date[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) ticks.push(new Date(t));
  return ticks;
}

/**
 * Consecutive passes of the worker at one moment in time. The sweep runs every
 * few minutes and advances a subscription by a single period per pass, so a
 * backlog is worked off one invoice per pass rather than all at once.
 */
function workerPasses(now: Date, count: number): Date[] {
  return Array.from({ length: count }, () => now);
}

describe("recovery from UNPAID", () => {
  it("gives a monthly subscription that lapsed for five days exactly one new period", () => {
    const lapsed = subscription();
    // Grace ran out inside February; the customer pays five days after the
    // period they never received had already ended.
    const recoveredAt = iso("2026-03-06T10:00:00Z");

    const recovered = recover(lapsed, MONTHLY, recoveredAt);

    expect(recovered.status).toBe("ACTIVE");
    expect(recovered.currentPeriodStart.toISOString()).toBe("2026-03-06T10:00:00.000Z");
    expect(recovered.currentPeriodEnd.toISOString()).toBe("2026-04-06T10:00:00.000Z");

    // And nothing bills again until that one period actually runs out, however
    // often the worker runs in the meantime.
    const { invoices } = runRenewalSweeps(recovered, MONTHLY, [
      ...workerPasses(recoveredAt, 10),
      ...dailyTicks(recoveredAt, iso("2026-04-05T10:00:00Z")),
    ]);
    expect(invoices).toEqual([]);
  });

  it("gives a daily subscription that lapsed for thirty days one period, not thirty invoices", () => {
    const lapsed = subscription({
      currentPeriodStart: iso("2026-02-01T00:00:00Z"),
      currentPeriodEnd: iso("2026-02-02T00:00:00Z"),
      billingAnchorDay: null,
    });
    const recoveredAt = iso("2026-03-04T00:00:00Z");

    // Reactivated on its expired period — what recovery used to do — the sweep
    // walks the whole lapse forward one invoice per pass: a month of charges
    // for a month nobody was served.
    const unfixed = runRenewalSweeps({ ...lapsed, status: "ACTIVE" }, DAILY, workerPasses(recoveredAt, 40));
    expect(unfixed.invoices.length).toBeGreaterThanOrEqual(30);

    const recovered = recover(lapsed, DAILY, recoveredAt);
    expect(recovered.currentPeriodStart.toISOString()).toBe("2026-03-04T00:00:00.000Z");
    expect(recovered.currentPeriodEnd.toISOString()).toBe("2026-03-05T00:00:00.000Z");

    // However many times the worker runs, nothing bills until that one day is
    // up, and then only for the day that follows the recovery.
    const { invoices } = runRenewalSweeps(recovered, DAILY, [
      ...workerPasses(recoveredAt, 40),
      iso("2026-03-05T00:00:00Z"),
    ]);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.billingPeriodStart.toISOString()).toBe("2026-03-05T00:00:00.000Z");
  });

  it("re-running the renewal worker issues no catch-up invoice for the lapse", () => {
    const lapsed = subscription({
      currentPeriodStart: iso("2026-02-01T00:00:00Z"),
      currentPeriodEnd: iso("2026-02-02T00:00:00Z"),
      billingAnchorDay: null,
    });
    const recoveredAt = iso("2026-03-04T00:00:00Z");
    const recovered = recover(lapsed, DAILY, recoveredAt);

    // Sixteen days of the worker running, at every cadence it plausibly runs at.
    const { invoices } = runRenewalSweeps(recovered, DAILY, [
      ...workerPasses(recoveredAt, 40),
      ...dailyTicks(recoveredAt, iso("2026-03-20T00:00:00Z")),
    ]);

    // One period per elapsed day and not one more, all of them after the
    // recovery: nothing bills a window the subscription spent revoked.
    expect(invoices).toHaveLength(16);
    for (const invoice of invoices) {
      expect(invoice.billingPeriodStart.getTime()).toBeGreaterThanOrEqual(recoveredAt.getTime());
      expect(invoice.billingPeriodStart.getTime()).toBeGreaterThan(lapsed.currentPeriodEnd.getTime());
    }
  });

  it("re-anchors a monthly cycle onto the recovery, clamping at month end", () => {
    const lapsed = subscription({
      currentPeriodStart: iso("2025-12-31T00:00:00Z"),
      currentPeriodEnd: iso("2026-01-31T00:00:00Z"),
      billingAnchorDay: 31,
    });

    const recovered = recover(lapsed, MONTHLY, iso("2026-01-31T12:00:00Z"));

    expect(recovered.billingAnchorDay).toBe(31);
    expect(recovered.currentPeriodEnd.toISOString()).toBe("2026-02-28T12:00:00.000Z");
  });

  it("never moves a period end backwards", () => {
    const interval: BillingInterval = { unit: "MONTH", count: 1 };
    // Recovery inside the lapsed period (grace expired early in a long period)
    // still hands back at least the time the row already promised.
    for (const day of [1, 5, 15, 28, 40]) {
      const row = subscription();
      const recoveredAt = new Date(row.currentPeriodStart.getTime() + day * 86_400_000);
      const recovered = recover(row, interval, recoveredAt);
      expect(recovered.currentPeriodEnd.getTime()).toBeGreaterThanOrEqual(row.currentPeriodEnd.getTime());
    }
  });
});

describe("recovery during a grace period", () => {
  it("keeps the period the customer was being served on", () => {
    const inGrace = subscription({ status: "GRACE_PERIOD" });

    const recovered = recover(inGrace, MONTHLY, iso("2026-02-11T09:30:00Z"));

    expect(recovered.status).toBe("ACTIVE");
    expect(recovered.currentPeriodStart.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(recovered.currentPeriodEnd.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(recovered.billingAnchorDay).toBe(1);
  });

  it("keeps the period for a PAST_DUE recovery too — access was never revoked", () => {
    const pastDue = subscription({ status: "PAST_DUE" });
    const recovered = recover(pastDue, MONTHLY, iso("2026-02-03T09:30:00Z"));
    expect(recovered.currentPeriodEnd.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("leaves an INCOMPLETE first payment and a converting trial on their period", () => {
    for (const status of ["INCOMPLETE", "TRIALING"] as const) {
      const row = subscription({ status });
      const plan = planPaymentRecovery({
        ...row,
        interval: MONTHLY,
        recoveredAt: iso("2026-02-05T00:00:00Z"),
      });
      expect(plan.recovers).toBe(true);
      expect(plan.rebased).toBe(false);
    }
  });
});

describe("recovery is idempotent", () => {
  it("does not open a second period when the same recovery is applied twice", () => {
    const lapsed = subscription();
    const recoveredAt = iso("2026-03-06T10:00:00Z");

    const once = recover(lapsed, MONTHLY, recoveredAt);
    // A webhook and the reconciliation sweep resolving the same attempt, or a
    // second invoice on the same subscription settling moments later: the
    // subscription is ACTIVE by then and no longer recoverable.
    const twice = recover(once, MONTHLY, iso("2026-03-06T10:00:05Z"));

    expect(twice).toEqual(once);
  });

  it("reports no recovery for a subscription that is not lapsed", () => {
    for (const status of ["ACTIVE", "PAUSED", "CANCELED", "EXPIRED"] as const) {
      const plan = planPaymentRecovery({
        ...subscription({ status }),
        interval: MONTHLY,
        recoveredAt: iso("2026-03-06T10:00:00Z"),
      });
      expect(plan.recovers).toBe(false);
      expect(plan.rebased).toBe(false);
      expect(plan.currentPeriodEnd.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    }
  });
});

describe("recovery racing the renewal sweep", () => {
  it("does not charge twice when a recovery lands after the sweep picked the subscription up", () => {
    // The sweep selects on `currentPeriodEnd <= now` and then works its batch
    // one subscription at a time. Here the recovery commits in that gap.
    const selectedAt = iso("2026-03-06T10:00:00Z");
    const stale = subscription({ status: "ACTIVE" });
    expect(isPeriodDue(stale.currentPeriodEnd, selectedAt)).toBe(true);

    const recovered = recover(subscription({ status: "UNPAID" }), MONTHLY, selectedAt);

    // renewSubscription re-reads under its advisory lock with onlyWhenDue set,
    // and finds the period is no longer due — so it opens nothing.
    const reachedAt = iso("2026-03-06T10:00:30Z");
    expect(isPeriodDue(recovered.currentPeriodEnd, reachedAt)).toBe(false);

    const { invoices } = runRenewalSweeps(recovered, MONTHLY, [reachedAt]);
    expect(invoices).toEqual([]);
  });

  it("bills one period, once, when overlapping sweeps both reach the same subscription", () => {
    const recoveredAt = iso("2026-03-06T10:00:00Z");
    const recovered = recover(subscription(), MONTHLY, recoveredAt);

    // Two sweeps running over the same tick — the second is the one that was
    // already in flight when the first advanced the row.
    const dueAt = iso("2026-04-06T10:00:00Z");
    const first = runRenewalSweeps(recovered, MONTHLY, [dueAt]);
    const second = runRenewalSweeps(first.row, MONTHLY, [dueAt]);

    expect(first.invoices).toHaveLength(1);
    expect(second.invoices).toEqual([]);
  });
});

describe("auditing recoveries that predate the rebase", () => {
  const recoveredAt = iso("2026-03-04T00:00:00Z");

  it("flags a subscription still carrying the period it lapsed on", () => {
    expect(
      classifyHistoricalRecovery({
        recoveredAt,
        // The period it was reactivated onto ended a month before the payment.
        periodBeforeEnd: iso("2026-02-02T00:00:00Z"),
        currentPeriodStart: iso("2026-02-01T00:00:00Z"),
      })
    ).toBe("AFFECTED_REPLAYING");
  });

  it("separates a subscription the sweep has already billed back to the present", () => {
    expect(
      classifyHistoricalRecovery({
        recoveredAt,
        periodBeforeEnd: iso("2026-02-02T00:00:00Z"),
        // Thirty passes later the period has been walked past the recovery.
        currentPeriodStart: iso("2026-03-10T00:00:00Z"),
      })
    ).toBe("AFFECTED_CAUGHT_UP");
  });

  it("clears a recovery that happened while the period was still running", () => {
    expect(
      classifyHistoricalRecovery({
        recoveredAt,
        periodBeforeEnd: iso("2026-04-01T00:00:00Z"),
        currentPeriodStart: iso("2026-03-01T00:00:00Z"),
      })
    ).toBe("CLEAN_IN_PERIOD");
  });

  it("clears a recovery the fixed path already rebased", () => {
    expect(
      classifyHistoricalRecovery({
        recoveredAt,
        transitionMetadata: { periodRebasedOnRecovery: true },
        periodBeforeEnd: iso("2026-02-02T00:00:00Z"),
        currentPeriodStart: recoveredAt,
      })
    ).toBe("CLEAN_REBASED");
  });

  it("refuses to guess when the period at recovery is unknown", () => {
    expect(
      classifyHistoricalRecovery({
        recoveredAt,
        periodBeforeEnd: null,
        currentPeriodStart: iso("2026-02-01T00:00:00Z"),
      })
    ).toBe("NEEDS_REVIEW");
  });

  it("recognises the invoices a replayed lapse produces", () => {
    // What the sweep actually did: one invoice per pass, each covering a day
    // that had already gone by.
    const replayed = [
      { createdAt: recoveredAt, billingPeriodStart: iso("2026-02-02T00:00:00Z") },
      { createdAt: recoveredAt, billingPeriodStart: iso("2026-02-03T00:00:00Z") },
      { createdAt: recoveredAt, billingPeriodStart: iso("2026-03-03T00:00:00Z") },
    ].map((invoice) => ({ ...invoice, createdAt: new Date(invoice.createdAt.getTime() + 1000) }));

    for (const invoice of replayed) {
      expect(isCatchUpInvoice(invoice, { recoveredAt })).toBe(true);
    }
  });

  it("does not mistake correct billing for a replay", () => {
    const cases: { name: string; invoice: Parameters<typeof isCatchUpInvoice>[0] }[] = [
      {
        name: "the renewal that follows a rebased recovery",
        invoice: {
          createdAt: iso("2026-04-04T00:00:00Z"),
          billingPeriodStart: iso("2026-04-04T00:00:00Z"),
        },
      },
      {
        name: "the invoice the recovery itself settled",
        invoice: {
          createdAt: iso("2026-02-01T00:00:00Z"),
          billingPeriodStart: iso("2026-02-01T00:00:00Z"),
        },
      },
      {
        name: "a proration invoice, back-dated to the running period by design",
        invoice: {
          createdAt: iso("2026-03-10T00:00:00Z"),
          billingPeriodStart: iso("2026-03-01T00:00:00Z"),
          reason: "plan_change",
        },
      },
      {
        name: "a seat change mid-period",
        invoice: {
          createdAt: iso("2026-03-10T00:00:00Z"),
          billingPeriodStart: iso("2026-03-01T00:00:00Z"),
          reason: "seat_change",
        },
      },
      {
        name: "an invoice carrying no period at all",
        invoice: { createdAt: iso("2026-03-10T00:00:00Z"), billingPeriodStart: null },
      },
    ];

    for (const { name, invoice } of cases) {
      expect(isCatchUpInvoice(invoice, { recoveredAt }), name).toBe(false);
    }
  });

  it("does not attribute one invoice to two recoveries", () => {
    const nextRecoveryAt = iso("2026-05-01T00:00:00Z");
    const afterTheNextRecovery = {
      createdAt: iso("2026-05-02T00:00:00Z"),
      billingPeriodStart: iso("2026-02-02T00:00:00Z"),
    };
    expect(isCatchUpInvoice(afterTheNextRecovery, { recoveredAt })).toBe(true);
    expect(isCatchUpInvoice(afterTheNextRecovery, { recoveredAt, nextRecoveryAt })).toBe(false);
  });

  it("the fixed engine produces nothing the audit would flag", () => {
    // End to end: recover a lapsed daily plan under the fix, run the worker,
    // and hand every invoice it issues to the detector.
    const lapsed = subscription({
      currentPeriodStart: iso("2026-02-01T00:00:00Z"),
      currentPeriodEnd: iso("2026-02-02T00:00:00Z"),
      billingAnchorDay: null,
    });
    const recovered = recover(lapsed, DAILY, recoveredAt);
    const { invoices } = runRenewalSweeps(recovered, DAILY, [
      ...workerPasses(recoveredAt, 40),
      ...dailyTicks(recoveredAt, iso("2026-03-20T00:00:00Z")),
    ]);

    expect(
      classifyHistoricalRecovery({
        recoveredAt,
        transitionMetadata: { periodRebasedOnRecovery: true },
        periodBeforeEnd: lapsed.currentPeriodEnd,
        currentPeriodStart: recovered.currentPeriodStart,
      })
    ).toBe("CLEAN_REBASED");

    for (const invoice of invoices) {
      expect(
        isCatchUpInvoice(
          { createdAt: invoice.billingPeriodStart, billingPeriodStart: invoice.billingPeriodStart },
          { recoveredAt }
        )
      ).toBe(false);
    }
  });
});
