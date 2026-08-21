import { describe, expect, it } from "vitest";
import { requestHash } from "./idempotency";

describe("idempotency request hashing", () => {
  it("is stable across key ordering", () => {
    const a = requestHash("POST", "/v1/subscriptions", { priceId: "p", quantity: 2 });
    const b = requestHash("POST", "/v1/subscriptions", { quantity: 2, priceId: "p" });
    expect(a).toBe(b);
  });

  it("changes when a value changes", () => {
    const a = requestHash("POST", "/v1/subscriptions", { priceId: "p", quantity: 2 });
    const b = requestHash("POST", "/v1/subscriptions", { priceId: "p", quantity: 3 });
    expect(a).not.toBe(b);
  });

  it("changes when the endpoint changes", () => {
    const a = requestHash("POST", "/v1/subscriptions", { priceId: "p" });
    const b = requestHash("POST", "/v1/invoices", { priceId: "p" });
    expect(a).not.toBe(b);
  });

  it("distinguishes nested differences", () => {
    const a = requestHash("POST", "/v1/subscriptions", { customer: { externalId: "u1" } });
    const b = requestHash("POST", "/v1/subscriptions", { customer: { externalId: "u2" } });
    expect(a).not.toBe(b);
  });

  it("distinguishes array ordering", () => {
    const a = requestHash("PUT", "/v1/billing-settings", { retryIntervals: [0, 1, 3] });
    const b = requestHash("PUT", "/v1/billing-settings", { retryIntervals: [3, 1, 0] });
    expect(a).not.toBe(b);
  });
});
