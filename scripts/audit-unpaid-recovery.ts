/**
 * DRY RUN — read-only audit of the historical UNPAID-recovery replay bug.
 *
 *   npx tsx scripts/audit-unpaid-recovery.ts [--org <slug|id>] [--json] [--all]
 *
 * Before the fix, a subscription recovering from UNPAID was moved to ACTIVE
 * with its billing period left untouched. When the recovery landed *after* that
 * period had already ended, the row went back into the renewals sweep with an
 * expired `currentPeriodEnd` — and the sweep advanced it one period, and one
 * invoice, per pass until it caught up with the present. Every one of those
 * periods was time the customer spent in UNPAID with entitlements revoked.
 *
 * This script finds the subscriptions that went through that, and the invoices
 * it produced. It writes nothing: no subscription, invoice, payment, transition
 * or any other record is created, updated or deleted, and no migration is
 * involved. The Prisma client below is wrapped in a guard that throws on any
 * operation that is not a read, so a mistake in this file cannot become a
 * write. Deciding what to do about what it finds — rebasing periods, voiding,
 * crediting or refunding invoices — is deliberately left to a human.
 */
import { loadRootEnv } from "@tierstack/shared";

// Load the monorepo .env before anything reads process.env.
loadRootEnv();

import { createPrismaClient, type PrismaClient } from "@tierstack/database";
import { classifyHistoricalRecovery, isCatchUpInvoice, type RecoveryVerdict } from "@tierstack/billing";
import { formatMoney, money } from "@tierstack/shared";

/** Prisma operations that cannot modify anything. Everything else is refused. */
const READ_ONLY_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

/**
 * The safeguard that makes "read-only" a property of the client rather than a
 * promise in a comment. Raw queries are not routed through `$allOperations`, so
 * this file does not use them at all.
 */
function readOnlyClient(prisma: PrismaClient) {
  return prisma.$extends({
    query: {
      $allOperations({ operation, model, args, query }) {
        if (!READ_ONLY_OPERATIONS.has(operation)) {
          throw new Error(
            `DRY RUN VIOLATION: refused a ${operation} on ${model ?? "the database"}. ` +
              "This script is read-only."
          );
        }
        return query(args);
      },
    },
  });
}

const DAY_MS = 86_400_000;

/**
 * How far apart the settling invoice's `paidAt` and the recovery transition's
 * `createdAt` may be and still be treated as the same event. They are written
 * in one transaction, so this only absorbs clock/rounding drift.
 */
const SETTLEMENT_TOLERANCE_MS = 120_000;

/**
 * The two predicates below decide everything this script reports, and both live
 * in `@tierstack/billing` next to the behaviour they describe — under the test
 * suite, where a true positive (a daily plan replayed thirty times) and each
 * false-positive trap are pinned by `recovery.test.ts`. A detector that has
 * only ever returned "nothing found" is not evidence of nothing.
 */
type Verdict = RecoveryVerdict;

const VERDICT_NOTE: Record<Verdict, string> = {
  AFFECTED_REPLAYING:
    "recovered onto an already-expired period and the row still carries it — the sweep is billing the lapse forward now",
  AFFECTED_CAUGHT_UP:
    "recovered onto an already-expired period; the sweep has since billed its way back to the present",
  CLEAN_REBASED: "recovered under the fixed behaviour — the period was rebased onto the payment",
  CLEAN_IN_PERIOD: "recovered while its period was still running — nothing to replay",
  NEEDS_REVIEW: "the period at the moment of recovery could not be established from the record",
};

interface CatchUpInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  currency: string;
  total: number;
  amountPaid: number;
  amountDue: number;
  billingPeriodStart: Date | null;
  billingPeriodEnd: Date | null;
  createdAt: Date;
  paidAt: Date | null;
  attempts: number;
}

interface Finding {
  verdict: Verdict;
  subscriptionId: string;
  customerId: string;
  customerEmail: string;
  organizationId: string;
  planName: string;
  priceCode: string;
  interval: string;
  status: string;
  recoveredAt: Date;
  /** How the pre-recovery period was established, for auditability. */
  periodBeforeSource: "settling_invoice" | "last_invoice_before_recovery" | "unknown";
  periodBeforeStart: Date | null;
  periodBeforeEnd: Date | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  daysRecoveryToCurrentPeriodEnd: number;
  daysLapsedAtRecovery: number | null;
  catchUpInvoices: CatchUpInvoice[];
  catchUpTotal: number;
  catchUpCollected: number;
  currency: string;
}

function days(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / DAY_MS) * 10) / 10;
}

function iso(value: Date | null): string {
  return value ? value.toISOString().replace(".000Z", "Z") : "—";
}

function amount(value: number, currency: string): string {
  return formatMoney(money(value, currency));
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const org = argv.includes("--org") ? argv[argv.indexOf("--org") + 1] : null;
  return {
    org: org ?? null,
    json: argv.includes("--json"),
    /** Print every recovery examined, including the clean ones. */
    all: argv.includes("--all"),
  };
}

function banner(): void {
  console.log("");
  console.log("═".repeat(78));
  console.log("  DRY RUN — READ-ONLY AUDIT. NOTHING IN THE DATABASE IS MODIFIED.");
  console.log("  Historical UNPAID → ACTIVE recovery replay (catch-up invoices)");
  console.log("═".repeat(78));
}

function criteria(): void {
  console.log("");
  console.log("Detection criteria");
  console.log("──────────────────");
  console.log(
    [
      "  1. A recovery is a SubscriptionTransition of UNPAID → ACTIVE. Any such row",
      "     whose reason is not `payment_succeeded` is reported separately rather",
      "     than assumed to be one.",
      "  2. The period the subscription held at that moment is read from the invoice",
      "     the recovery settled — the one whose paidAt falls within",
      `     ${SETTLEMENT_TOLERANCE_MS / 1000}s of the transition (they are written in one transaction).`,
      "     Failing that, the last invoice created before the recovery is used and the",
      "     finding is downgraded to NEEDS_REVIEW.",
      "  3. The recovery replayed the lapse only if that period had ALREADY ENDED at",
      "     the recovery. Recovering mid-period left a valid period behind and is",
      "     reported CLEAN_IN_PERIOD.",
      "  4. A catch-up invoice is one created AFTER the recovery whose own",
      "     billingPeriodStart is BEFORE it — under correct behaviour no invoice can",
      "     cover a window that opened before the money arrived.",
      "",
      "Safeguards against false positives",
      "──────────────────────────────────",
      "  • Recoveries carrying `periodRebasedOnRecovery` in their transition metadata",
      "    ran under the fixed code and are excluded (CLEAN_REBASED).",
      "  • Detection uses the INVOICE's billingPeriodStart, never a line item's",
      "    periodStart: usage is billed in arrears, so a correct renewal invoice",
      "    legitimately carries usage lines pointing at the period that just closed.",
      "  • Proration invoices (metadata.reason of plan_change / seat_change) are",
      "    excluded — a mid-period plan change back-dates its window by design.",
      "  • When a subscription recovered more than once, each recovery only claims",
      "    invoices created before the next recovery, so nothing is double-counted.",
      "  • Anything that cannot be established from the record is NEEDS_REVIEW, not",
      "    an accusation.",
    ].join("\n")
  );
}

async function main(): Promise<void> {
  const args = parseArgs();
  const base = createPrismaClient();
  const prisma = readOnlyClient(base);
  const now = new Date();

  banner();
  criteria();

  let organizationId: string | null = null;
  if (args.org) {
    const organization = await prisma.organization.findFirst({
      where: { OR: [{ id: args.org }, { slug: args.org }] },
      select: { id: true, name: true, slug: true },
    });
    if (!organization) {
      console.error(`\nNo organization matches "${args.org}".`);
      await base.$disconnect();
      process.exitCode = 1;
      return;
    }
    organizationId = organization.id;
    console.log(`\nScope: ${organization.name} (${organization.slug})`);
  } else {
    console.log("\nScope: every organization in this database");
  }

  // 1. Every UNPAID → ACTIVE transition ever recorded.
  const transitions = await prisma.subscriptionTransition.findMany({
    where: {
      fromStatus: "UNPAID",
      toStatus: "ACTIVE",
      ...(organizationId ? { subscription: { organizationId } } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: {
      subscription: {
        include: {
          customer: { select: { id: true, email: true } },
          price: { include: { plan: { select: { name: true } } } },
        },
      },
    },
  });

  const recoveries = transitions.filter((t) => t.reason === "payment_succeeded");
  const unclassified = transitions.filter((t) => t.reason !== "payment_succeeded");

  console.log(
    `\nExamined ${transitions.length} UNPAID → ACTIVE transition(s): ` +
      `${recoveries.length} payment recovery, ${unclassified.length} other.`
  );

  // Recoveries per subscription, so each one only claims the invoices issued
  // before the next recovery on the same subscription.
  const bySubscription = new Map<string, typeof recoveries>();
  for (const recovery of recoveries) {
    const list = bySubscription.get(recovery.subscriptionId) ?? [];
    list.push(recovery);
    bySubscription.set(recovery.subscriptionId, list);
  }

  const findings: Finding[] = [];

  for (const [subscriptionId, events] of bySubscription) {
    const invoices = await prisma.invoice.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { attempts: true } } },
    });

    for (const [index, event] of events.entries()) {
      const subscription = event.subscription;
      const recoveredAt = event.createdAt;
      const nextRecoveryAt = events[index + 1]?.createdAt ?? null;
      const metadata = (event.metadata ?? {}) as Record<string, unknown>;

      // SAFEGUARD: the fixed code stamps this on the transition it rebased.
      const rebasedByFixedCode = metadata.periodRebasedOnRecovery === true;

      // The invoice this recovery settled, and with it the period the
      // subscription was holding at that moment.
      const settling = invoices
        .filter(
          (invoice) =>
            invoice.paidAt !== null &&
            Math.abs(invoice.paidAt.getTime() - recoveredAt.getTime()) <= SETTLEMENT_TOLERANCE_MS
        )
        .sort(
          (a, b) =>
            Math.abs(a.paidAt!.getTime() - recoveredAt.getTime()) -
            Math.abs(b.paidAt!.getTime() - recoveredAt.getTime())
        )[0];

      const fallback = [...invoices]
        .reverse()
        .find((invoice) => invoice.createdAt < recoveredAt && invoice.billingPeriodEnd !== null);

      const source = settling ?? fallback ?? null;
      const periodBeforeSource: Finding["periodBeforeSource"] = settling
        ? "settling_invoice"
        : fallback
          ? "last_invoice_before_recovery"
          : "unknown";

      const periodBeforeStart = source?.billingPeriodStart ?? null;
      const periodBeforeEnd = source?.billingPeriodEnd ?? null;

      // Invoices issued after this recovery covering a window that opened
      // before it — the signature of a replayed period.
      const catchUp = invoices.filter((invoice) => {
        const reason = (invoice.metadata as Record<string, unknown> | null)?.reason;
        return isCatchUpInvoice(
          {
            createdAt: invoice.createdAt,
            billingPeriodStart: invoice.billingPeriodStart,
            reason: typeof reason === "string" ? reason : null,
          },
          { recoveredAt, nextRecoveryAt }
        );
      });

      const verdict = classifyHistoricalRecovery({
        recoveredAt,
        transitionMetadata: rebasedByFixedCode ? { periodRebasedOnRecovery: true } : metadata,
        periodBeforeEnd,
        currentPeriodStart: subscription.currentPeriodStart,
      });

      const currency = subscription.price.currency;

      findings.push({
        verdict,
        subscriptionId,
        customerId: subscription.customerId,
        customerEmail: subscription.customer.email,
        organizationId: subscription.organizationId,
        planName: subscription.price.plan.name,
        priceCode: subscription.price.code,
        interval: `${subscription.price.intervalCount} × ${subscription.price.intervalUnit}`,
        status: subscription.status,
        recoveredAt,
        periodBeforeSource,
        periodBeforeStart,
        periodBeforeEnd,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        daysRecoveryToCurrentPeriodEnd: days(recoveredAt, subscription.currentPeriodEnd),
        daysLapsedAtRecovery: periodBeforeEnd ? days(periodBeforeEnd, recoveredAt) : null,
        catchUpInvoices: catchUp.map((invoice) => ({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
          currency: invoice.currency,
          total: invoice.total,
          amountPaid: invoice.amountPaid,
          amountDue: invoice.amountDue,
          billingPeriodStart: invoice.billingPeriodStart,
          billingPeriodEnd: invoice.billingPeriodEnd,
          createdAt: invoice.createdAt,
          paidAt: invoice.paidAt,
          attempts: invoice._count.attempts,
        })),
        catchUpTotal: catchUp.reduce((sum, invoice) => sum + invoice.total, 0),
        catchUpCollected: catchUp.reduce((sum, invoice) => sum + invoice.amountPaid, 0),
        currency,
      });
    }
  }

  if (args.json) {
    console.log("\n" + JSON.stringify({ dryRun: true, generatedAt: now, findings }, null, 2));
    await base.$disconnect();
    return;
  }

  report(findings, unclassified, args.all, now);
  await base.$disconnect();
}

function report(
  findings: Finding[],
  unclassified: { subscriptionId: string; reason: string; createdAt: Date }[],
  showAll: boolean,
  now: Date
): void {
  const affected = findings.filter(
    (f) => f.verdict === "AFFECTED_REPLAYING" || f.verdict === "AFFECTED_CAUGHT_UP"
  );
  const review = findings.filter((f) => f.verdict === "NEEDS_REVIEW");
  const shown = showAll ? findings : [...affected, ...review];

  console.log("\n\nSubscription report");
  console.log("═".repeat(78));

  if (shown.length === 0) {
    console.log("\n  No subscription shows the replay signature.");
  }

  for (const f of shown) {
    console.log("");
    console.log(`  ${f.verdict}  ${f.subscriptionId}`);
    console.log(`    ${VERDICT_NOTE[f.verdict]}`);
    console.log(`    customer            ${f.customerId}  <${f.customerEmail}>`);
    console.log(`    plan / price        ${f.planName} · ${f.priceCode} (${f.interval})`);
    console.log(`    status now          ${f.status}`);
    console.log(`    recovered at        ${iso(f.recoveredAt)}`);
    console.log(
      `    period before       ${iso(f.periodBeforeStart)} → ${iso(f.periodBeforeEnd)}` +
        `  [${f.periodBeforeSource}]`
    );
    console.log(
      `    period now          ${iso(f.currentPeriodStart)} → ${iso(f.currentPeriodEnd)}` +
        (f.periodBeforeSource === "settling_invoice" &&
        f.periodBeforeStart &&
        f.currentPeriodStart.getTime() === f.periodBeforeStart.getTime()
          ? "  (unchanged by the recovery)"
          : "")
    );
    if (f.daysLapsedAtRecovery !== null) {
      console.log(
        f.daysLapsedAtRecovery >= 0
          ? `    lapse at recovery   paid ${f.daysLapsedAtRecovery} day(s) after that period ended`
          : `    lapse at recovery   none — paid ${-f.daysLapsedAtRecovery} day(s) before that period ended`
      );
    }
    console.log(`    recovery → period end  ${f.daysRecoveryToCurrentPeriodEnd} day(s)`);
    console.log(
      `    catch-up invoices   ${f.catchUpInvoices.length}` +
        (f.catchUpInvoices.length > 0
          ? `  billed ${amount(f.catchUpTotal, f.currency)}, collected ${amount(f.catchUpCollected, f.currency)}`
          : "")
    );
  }

  const withInvoices = findings.filter((f) => f.catchUpInvoices.length > 0);

  console.log("\n\nInvoice report — invoices that look like replayed periods");
  console.log("═".repeat(78));
  if (withInvoices.length === 0) {
    console.log("\n  None.");
  }
  for (const f of withInvoices) {
    console.log(`\n  ${f.subscriptionId} · ${f.customerEmail}`);
    for (const invoice of f.catchUpInvoices) {
      console.log(
        `    ${invoice.invoiceNumber.padEnd(18)} ${invoice.status.padEnd(6)} ` +
          `${iso(invoice.billingPeriodStart)} → ${iso(invoice.billingPeriodEnd)}  ` +
          `total ${amount(invoice.total, invoice.currency)}, ` +
          `paid ${amount(invoice.amountPaid, invoice.currency)}, ` +
          `due ${amount(invoice.amountDue, invoice.currency)}, ` +
          `${invoice.attempts} payment attempt(s)`
      );
    }
  }

  if (unclassified.length > 0) {
    console.log("\n\nUNPAID → ACTIVE transitions with an unexpected reason — inspect by hand");
    console.log("═".repeat(78));
    for (const t of unclassified) {
      console.log(`  ${iso(t.createdAt)}  ${t.subscriptionId}  reason="${t.reason}"`);
    }
  }

  const counts = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.verdict] = (acc[f.verdict] ?? 0) + 1;
    return acc;
  }, {});
  const invoiceCount = findings.reduce((sum, f) => sum + f.catchUpInvoices.length, 0);
  const currencies = [...new Set(findings.flatMap((f) => f.catchUpInvoices.map((i) => i.currency)))];

  console.log("\n\nBlast radius");
  console.log("═".repeat(78));
  console.log(`  recoveries examined        ${findings.length}`);
  for (const verdict of Object.keys(VERDICT_NOTE) as Verdict[]) {
    console.log(`    ${verdict.padEnd(24)} ${counts[verdict] ?? 0}`);
  }
  console.log(`  subscriptions to rebase    ${counts.AFFECTED_REPLAYING ?? 0}`);
  console.log(`  catch-up invoices          ${invoiceCount}`);
  for (const currency of currencies) {
    const billed = findings
      .flatMap((f) => f.catchUpInvoices)
      .filter((i) => i.currency === currency)
      .reduce((sum, i) => sum + i.total, 0);
    const collected = findings
      .flatMap((f) => f.catchUpInvoices)
      .filter((i) => i.currency === currency)
      .reduce((sum, i) => sum + i.amountPaid, 0);
    console.log(
      `    ${currency}  billed ${amount(billed, currency)}, collected ${amount(collected, currency)}` +
        `  (collected is what a refund decision applies to)`
    );
  }

  console.log("");
  console.log("─".repeat(78));
  console.log(`  DRY RUN complete at ${iso(now)}. No records were created, updated or deleted.`);
  console.log("─".repeat(78));
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
