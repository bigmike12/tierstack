import { describe, expect, it } from "vitest";
import { allowedTransitions, canTransition, hasServiceAccess, isTerminal, transition } from "./state-machine";

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

  it("keeps a never-paid subscription out of the lapsed-customer states", () => {
    expect(canTransition("INCOMPLETE", "ACTIVE")).toBe(true);
    expect(canTransition("INCOMPLETE", "CANCELED")).toBe(true);
    expect(canTransition("INCOMPLETE", "EXPIRED")).toBe(true);
    // PAST_DUE and GRACE_PERIOD both describe a paying customer who lapsed.
    expect(canTransition("INCOMPLETE", "PAST_DUE")).toBe(false);
    expect(canTransition("INCOMPLETE", "GRACE_PERIOD")).toBe(false);
    expect(canTransition("INCOMPLETE", "UNPAID")).toBe(false);
    expect(allowedTransitions("INCOMPLETE")).toEqual(["ACTIVE", "CANCELED", "EXPIRED"]);
  });

  it("grants no service on a subscription that has never been paid", () => {
    // The grace policy is irrelevant here: there is nothing to be gracious about.
    expect(hasServiceAccess("INCOMPLETE", "FULL_ACCESS")).toEqual({ access: false, restricted: false });
    expect(hasServiceAccess("INCOMPLETE", "RESTRICTED_ACCESS")).toEqual({ access: false, restricted: false });
    expect(hasServiceAccess("INCOMPLETE", "NO_ACCESS")).toEqual({ access: false, restricted: false });
  });

  it("refuses to move an unpaid subscription into a grace period", () => {
    expect(() => transition("INCOMPLETE", "GRACE_PERIOD", "payment_failed")).toThrow(
      /cannot move from INCOMPLETE to GRACE_PERIOD/
    );
  });

  it("applies the organization's grace-period access policy", () => {
    expect(hasServiceAccess("GRACE_PERIOD", "FULL_ACCESS")).toEqual({ access: true, restricted: false });
    expect(hasServiceAccess("GRACE_PERIOD", "RESTRICTED_ACCESS")).toEqual({ access: true, restricted: true });
    expect(hasServiceAccess("GRACE_PERIOD", "NO_ACCESS")).toEqual({ access: false, restricted: false });
    expect(hasServiceAccess("UNPAID", "FULL_ACCESS")).toEqual({ access: false, restricted: false });
    expect(hasServiceAccess("TRIALING", "NO_ACCESS")).toEqual({ access: true, restricted: false });
  });
});
