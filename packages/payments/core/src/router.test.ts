import { describe, expect, it } from "vitest";
import { requireRoute, routePayment, type RoutableProvider } from "./router";
import { BasePaymentProvider } from "./provider";
import type { PaymentProviderCapabilities, ProviderKind } from "./types";

class StubProvider extends BasePaymentProvider {
  constructor(
    readonly kind: ProviderKind,
    private readonly capabilities: PaymentProviderCapabilities
  ) {
    super();
  }
  override getCapabilities(): PaymentProviderCapabilities {
    return this.capabilities;
  }
}

const cardOnly: PaymentProviderCapabilities = {
  recurringCard: true,
  directDebit: false,
  bankTransfer: false,
  mobileMoney: false,
  refunds: true,
  paymentLinks: true,
  tokenization: true,
  supportedMethods: ["CARD"],
  supportedCurrencies: ["NGN"],
};

const transferOnly: PaymentProviderCapabilities = {
  ...cardOnly,
  recurringCard: false,
  tokenization: false,
  bankTransfer: true,
  supportedMethods: ["BANK_TRANSFER"],
  supportedCurrencies: ["NGN", "USD"],
};

function make(kind: ProviderKind, caps: PaymentProviderCapabilities, extra: Partial<RoutableProvider> = {}): RoutableProvider {
  return {
    kind,
    provider: new StubProvider(kind, caps),
    enabled: true,
    isDefault: false,
    priority: 100,
    ...extra,
  };
}

describe("payment routing", () => {
  it("prefers the default provider", () => {
    const decision = routePayment(
      [make("FLUTTERWAVE", cardOnly), make("PAYSTACK", cardOnly, { isDefault: true })],
      { currency: "NGN", method: "CARD" }
    );
    expect(decision.candidates[0]?.kind).toBe("PAYSTACK");
    expect(decision.candidates).toHaveLength(2);
  });

  it("excludes providers that cannot handle the payment method", () => {
    const decision = routePayment([make("MONNIFY", transferOnly)], { currency: "NGN", method: "CARD" });
    expect(decision.candidates).toHaveLength(0);
    expect(decision.rejected[0]?.reason).toMatch(/does not support CARD/);
  });

  it("excludes providers that cannot settle the currency", () => {
    const decision = routePayment([make("PAYSTACK", cardOnly)], { currency: "USD", method: "CARD" });
    expect(decision.candidates).toHaveLength(0);
    expect(decision.rejected[0]?.reason).toMatch(/does not settle USD/);
  });

  it("honours organization routing rules", () => {
    const decision = routePayment(
      [make("PAYSTACK", cardOnly, { routingRules: { countries: ["GH"] } })],
      { currency: "NGN", country: "NG", method: "CARD" }
    );
    expect(decision.candidates).toHaveLength(0);
  });

  it("never fails a stored payment method over to another provider", () => {
    const decision = routePayment(
      [make("PAYSTACK", cardOnly), make("FLUTTERWAVE", cardOnly, { isDefault: true })],
      { currency: "NGN", method: "CARD", pinnedProvider: "PAYSTACK" }
    );
    expect(decision.candidates.map((c) => c.kind)).toEqual(["PAYSTACK"]);
    expect(decision.rejected[0]?.reason).toMatch(/cannot be charged elsewhere/);
  });

  it("prefers the provider that last succeeded for the customer", () => {
    const decision = routePayment(
      [make("PAYSTACK", cardOnly, { isDefault: true }), make("FLUTTERWAVE", cardOnly)],
      { currency: "NGN", method: "CARD", lastSuccessfulProvider: "FLUTTERWAVE" }
    );
    expect(decision.candidates[0]?.kind).toBe("FLUTTERWAVE");
  });

  it("deprioritises unhealthy providers without removing them", () => {
    const decision = routePayment(
      [make("PAYSTACK", cardOnly, { isDefault: true, healthy: false }), make("FLUTTERWAVE", cardOnly)],
      { currency: "NGN", method: "CARD" }
    );
    expect(decision.candidates.map((c) => c.kind)).toEqual(["FLUTTERWAVE", "PAYSTACK"]);
  });

  it("skips disabled providers", () => {
    const decision = routePayment([make("PAYSTACK", cardOnly, { enabled: false })], {
      currency: "NGN",
      method: "CARD",
    });
    expect(decision.candidates).toHaveLength(0);
  });

  it("throws a descriptive error when nothing is eligible", () => {
    const decision = routePayment([], { currency: "NGN", method: "CARD" });
    expect(() => requireRoute(decision, { currency: "NGN", method: "CARD" })).toThrow(
      /No configured payment provider/
    );
  });

  describe("the mock rail is never a fallback for a real one", () => {
    it("is excluded entirely once a real provider is configured", () => {
      const decision = routePayment(
        [make("MOCK", cardOnly, { priority: 10, isDefault: true }), make("PAYSTACK", cardOnly, { priority: 100 })],
        { currency: "NGN" }
      );

      expect(decision.candidates.map((c) => c.kind)).toEqual(["PAYSTACK"]);
      expect(decision.rejected.find((r) => r.kind === "MOCK")?.reason).toMatch(/never used/i);
    });

    it("is excluded even when it outranks the real rail on every signal", () => {
      // Default, lowest priority number, and the last provider that succeeded —
      // the mock rail wins on all three and must still not be chosen.
      const decision = routePayment(
        [make("MOCK", cardOnly, { priority: 0, isDefault: true }), make("PAYSTACK", cardOnly, { priority: 500 })],
        { currency: "NGN", lastSuccessfulProvider: "MOCK" }
      );

      expect(decision.candidates.map((c) => c.kind)).toEqual(["PAYSTACK"]);
    });

    it("is excluded even when the real rail is unhealthy", () => {
      // An outage must surface as a failed payment, never as a fake success.
      const decision = routePayment(
        [make("MOCK", cardOnly, { priority: 10 }), make("PAYSTACK", cardOnly, { priority: 100, healthy: false })],
        { currency: "NGN" }
      );

      expect(decision.candidates.map((c) => c.kind)).toEqual(["PAYSTACK"]);
    });

    it("still routes to the mock rail when it is the only one", () => {
      const decision = routePayment([make("MOCK", cardOnly, { priority: 10, isDefault: true })], {
        currency: "NGN",
      });
      expect(decision.candidates.map((c) => c.kind)).toEqual(["MOCK"]);
    });

    it("ignores a disabled real rail when deciding", () => {
      // A provider that is switched off is not a rail, so the mock one is still
      // the only thing available.
      const decision = routePayment(
        [make("MOCK", cardOnly, { priority: 10 }), make("PAYSTACK", cardOnly, { priority: 100, enabled: false })],
        { currency: "NGN" }
      );
      expect(decision.candidates.map((c) => c.kind)).toEqual(["MOCK"]);
    });
  });
});
