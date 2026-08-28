import { describe, expect, it } from "vitest";
import { classifyFailure, isWorthRetrying } from "./failures";

describe("classifyFailure", () => {
  it("treats a card that has expired as needing a new one", () => {
    expect(classifyFailure("Card expired, please use another card")).toBe("REQUIRES_ACTION");
  });

  it("treats a card the issuer will not allow online as needing a new one", () => {
    expect(classifyFailure("Transaction not permitted to cardholder")).toBe("REQUIRES_ACTION");
  });

  it("keeps retrying the things that clear on their own", () => {
    expect(classifyFailure("Insufficient Funds")).toBe("RETRYABLE");
  });

  it("classifies the bare 'Declined' Paystack sends as retryable", () => {
    expect(classifyFailure("Declined")).toBe("RETRYABLE");
  });

  it("does not let a generic word override a specific one", () => {
    // "declined" alone is retryable, but this message is a decline *because*
    // the card expired — the specific reason must win over the generic one.
    expect(classifyFailure("Declined: expired card")).toBe("REQUIRES_ACTION");
  });

  it("is case and punctuation insensitive", () => {
    expect(classifyFailure("  EXPIRED CARD!!  ")).toBe("REQUIRES_ACTION");
    expect(classifyFailure("INSUFFICIENT FUNDS.")).toBe("RETRYABLE");
  });

  it("returns UNKNOWN rather than guessing", () => {
    expect(classifyFailure("some reason no rail has ever sent")).toBe("UNKNOWN");
    expect(classifyFailure(null)).toBe("UNKNOWN");
    expect(classifyFailure(undefined)).toBe("UNKNOWN");
    expect(classifyFailure("")).toBe("UNKNOWN");
  });
});

describe("isWorthRetrying", () => {
  it("keeps trying anything that is not known to be hopeless", () => {
    expect(isWorthRetrying("RETRYABLE")).toBe(true);
    expect(isWorthRetrying("UNKNOWN")).toBe(true);
    expect(isWorthRetrying(null)).toBe(true);
    expect(isWorthRetrying(undefined)).toBe(true);
  });

  it("stops on a card that needs replacing", () => {
    expect(isWorthRetrying("REQUIRES_ACTION")).toBe(false);
  });
});
