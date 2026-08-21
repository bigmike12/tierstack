import { describe, expect, it } from "vitest";
import { canTransition, hasServiceAccess, isTerminal, transition } from "./state-machine";

describe("subscription state machine", () => {
  it("walks the documented failure path", () => {
    expect(canTransition("ACTIVE", "PAST_DUE")).toBe(true);
    expect(canTransition("PAST_DUE", "GRACE_PERIOD")).toBe(true);
    expect(canTransition("GRACE_PERIOD", "UNPAID")).toBe(true);
  });

  it("allows recovery from grace period back to active", () => {
    expect(canTransition("GRACE_PERIOD", "ACTIVE")).toBe(true);
    expect(canTransition("PAST_DUE", "ACTIVE")).toBe(true);
    expect(canTransition("UNPAID", "ACTIVE")).toBe(true);
  });

  it("refuses to move out of a terminal state", () => {
    expect(isTerminal("CANCELED")).toBe(true);
    expect(() => transition("CANCELED", "ACTIVE", "manual")).toThrow(/cannot move from CANCELED/);
    expect(() => transition("EXPIRED", "ACTIVE", "manual")).toThrow();
  });

  it("refuses skipping straight from active to unpaid", () => {
    expect(() => transition("ACTIVE", "UNPAID", "skip")).toThrow(/cannot move from ACTIVE to UNPAID/);
  });

  it("refuses reviving a paused subscription into grace period", () => {
    expect(() => transition("PAUSED", "GRACE_PERIOD", "skip")).toThrow();
  });

  it("records the reason for the change", () => {
    const result = transition("ACTIVE", "PAST_DUE", "payment_failed");
    expect(result).toEqual({ from: "ACTIVE", to: "PAST_DUE", reason: "payment_failed" });
  });

  it("applies the organization's grace-period access policy", () => {
    expect(hasServiceAccess("GRACE_PERIOD", "FULL_ACCESS")).toEqual({ access: true, restricted: false });
    expect(hasServiceAccess("GRACE_PERIOD", "RESTRICTED_ACCESS")).toEqual({ access: true, restricted: true });
    expect(hasServiceAccess("GRACE_PERIOD", "NO_ACCESS")).toEqual({ access: false, restricted: false });
    expect(hasServiceAccess("UNPAID", "FULL_ACCESS")).toEqual({ access: false, restricted: false });
    expect(hasServiceAccess("TRIALING", "NO_ACCESS")).toEqual({ access: true, restricted: false });
  });
});
