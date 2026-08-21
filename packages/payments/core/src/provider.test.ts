import { describe, expect, it } from "vitest";
import { BasePaymentProvider, requireCapability } from "./provider";
import type { PaymentProviderCapabilities } from "./types";

class HalfBakedProvider extends BasePaymentProvider {
  readonly kind = "PAYSTACK" as const;
  override getCapabilities(): PaymentProviderCapabilities {
    return {
      recurringCard: false,
      directDebit: false,
      bankTransfer: true,
      mobileMoney: false,
      refunds: false,
      paymentLinks: false,
      tokenization: false,
      supportedMethods: ["BANK_TRANSFER"],
      supportedCurrencies: ["NGN"],
    };
  }
}

describe("provider capability enforcement", () => {
  const provider = new HalfBakedProvider();

  it("returns an explicit unsupported-capability error instead of faking support", async () => {
    await expect(provider.chargePaymentMethod({} as never)).rejects.toMatchObject({
      code: "UNSUPPORTED_PROVIDER_CAPABILITY",
    });
    await expect(provider.refundPayment({} as never)).rejects.toMatchObject({
      code: "UNSUPPORTED_PROVIDER_CAPABILITY",
    });
  });

  it("guards capabilities before the call is made", () => {
    expect(() => requireCapability(provider, "bankTransfer")).not.toThrow();
    expect(() => requireCapability(provider, "refunds")).toThrow(/does not support/);
  });
});
