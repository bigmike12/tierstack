import { describe, expect, it } from "vitest";
import { isGracePeriodExpired, nextRetryAt, openGracePeriod, statusForFailureAction, type DunningPolicy } from "./grace";

const policy: DunningPolicy = {
  gracePeriodDays: 7,
  maxRetryAttempts: 4,
  retryIntervals: [0, 1, 3, 5],
  accessDuringGracePeriod: "FULL_ACCESS",
  failureAction: "MARK_UNPAID",
  invoiceDueDays: 0,
};

const failedAt = new Date("2026-08-21T09:00:00Z");

describe("grace period", () => {
  it("uses the organization's configured length, not a built-in default", () => {
    expect(openGracePeriod(policy, failedAt).gracePeriodEnd.toISOString()).toBe("2026-08-28T09:00:00.000Z");
    expect(openGracePeriod({ ...policy, gracePeriodDays: 1 }, failedAt).gracePeriodEnd.toISOString()).toBe(
      "2026-08-22T09:00:00.000Z"
    );
    expect(openGracePeriod({ ...policy, gracePeriodDays: 30 }, failedAt).gracePeriodEnd.toISOString()).toBe(
      "2026-09-20T09:00:00.000Z"
    );
  });

  it("supports a zero-day grace period", () => {
    const window = openGracePeriod({ ...policy, gracePeriodDays: 0 }, failedAt);
    expect(window.gracePeriodEnd.getTime()).toBe(failedAt.getTime());
    expect(isGracePeriodExpired(window.gracePeriodEnd, failedAt)).toBe(true);
  });

  it("freezes the policy so later settings changes do not alter a running grace period", () => {
    const window = openGracePeriod(policy, failedAt);
    policy.retryIntervals.push(99);
    expect(window.snapshot.retryIntervals).toEqual([0, 1, 3, 5]);
    policy.retryIntervals.pop();
  });

  it("walks the configured retry schedule", () => {
    expect(nextRetryAt(policy, failedAt, 0)?.toISOString()).toBe("2026-08-21T09:00:00.000Z");
    expect(nextRetryAt(policy, failedAt, 1)?.toISOString()).toBe("2026-08-22T09:00:00.000Z");
    expect(nextRetryAt(policy, failedAt, 2)?.toISOString()).toBe("2026-08-24T09:00:00.000Z");
    expect(nextRetryAt(policy, failedAt, 3)?.toISOString()).toBe("2026-08-26T09:00:00.000Z");
  });

  it("stops scheduling once the retry budget is spent", () => {
    expect(nextRetryAt(policy, failedAt, 4)).toBeNull();
    expect(nextRetryAt({ ...policy, maxRetryAttempts: 2 }, failedAt, 2)).toBeNull();
  });

  it("reuses the final interval when the schedule is shorter than the attempt budget", () => {
    const short = { ...policy, retryIntervals: [0, 2], maxRetryAttempts: 4 };
    expect(nextRetryAt(short, failedAt, 3)?.toISOString()).toBe("2026-08-23T09:00:00.000Z");
  });

  it("maps each failure action onto its terminal status", () => {
    expect(statusForFailureAction("MARK_UNPAID")).toBe("UNPAID");
    expect(statusForFailureAction("CANCEL")).toBe("CANCELED");
    expect(statusForFailureAction("PAUSE")).toBe("PAUSED");
  });

  it("detects expiry", () => {
    expect(isGracePeriodExpired(new Date("2026-08-20T00:00:00Z"), failedAt)).toBe(true);
    expect(isGracePeriodExpired(new Date("2026-08-22T00:00:00Z"), failedAt)).toBe(false);
    expect(isGracePeriodExpired(null, failedAt)).toBe(false);
  });
});
