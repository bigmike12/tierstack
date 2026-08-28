import { describe, expect, it } from "vitest";
import { classifyFailure, isWorthRetrying } from "./failures";

describe("classifyFailure", () => {
  it("treats a card that has expired as needing a new one", () => {
    expect(classifyFailure("Expired card")).toBe("REQUIRES_ACTION");
    expect(classifyFailure("Card expired")).toBe("REQUIRES_ACTION");
  });

  it("treats a card the issuer will not allow online as needing a new one", () => {
    expect(classifyFailure("Transaction Not Permitted To Cardholder")).toBe("REQUIRES_ACTION");
    expect(classifyFailure("Restricted card")).toBe("REQUIRES_ACTION");
  });

  it("keeps retrying the things that clear on their own", () => {
    expect(classifyFailure("Insufficient Funds")).toBe("RETRYABLE");
    expect(classifyFailure("Do not honour")).toBe("RETRYABLE");
    expect(classifyFailure("Issuer or switch inoperative")).toBe("RETRYABLE");
    expect(classifyFailure("Transaction limit exceeded")).toBe("RETRYABLE");
  });

  it("classifies the bare 'Declined' Paystack sends as retryable", () => {
    // Observed against live Paystack. It says nothing about why, so the only
    // safe reading is that it might clear.
    expect(classifyFailure("Declined")).toBe("RETRYABLE");
  });

  it("does not let a generic word override a specific one", () => {
    // Rails append "declined" to everything. The specific half decides.
    expect(classifyFailure("Declined: expired card")).toBe("REQUIRES_ACTION");
    expect(classifyFailure("Card declined — stolen card")).toBe("REQUIRES_ACTION");
  });

  it("is case and punctuation insensitive", () => {
    expect(classifyFailure("  EXPIRED CARD.  ")).toBe("REQUIRES_ACTION");
    expect(classifyFailure("INSUFFICIENT FUNDS.")).toBe("RETRYABLE");
  });

  it("returns UNKNOWN rather than guessing", () => {
    expect(classifyFailure("Rail said something nobody has seen before")).toBe("UNKNOWN");
    expect(classifyFailure("")).toBe("UNKNOWN");
    expect(classifyFailure(null)).toBe("UNKNOWN");
    expect(classifyFailure(undefined)).toBe("UNKNOWN");
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
    // Four more attempts on an expired card is four more emails and five more
    // days before the customer is told the only thing that would help.
    expect(isWorthRetrying("REQUIRES_ACTION")).toBe(false);
  });
});
