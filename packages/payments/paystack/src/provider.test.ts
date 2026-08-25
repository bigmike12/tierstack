import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BillingError, money, newId } from "@tierstack/shared";
import type { PaystackEnvelope, PaystackTransport } from "./client";
import { fromProviderReference, toProviderReference } from "./mapping";
import { PaystackPaymentProvider } from "./provider";

/**
 * These tests exercise the adapter against a recorded transport, not against
 * Paystack. They prove the mapping is right — what an amount means, what counts
 * as settled, which fields survive into storage — and they cannot prove that
 * Paystack's live API still looks like this. That check needs real credentials
 * and a test-mode transaction, and has not been run.
 */

const SECRET = process.env.TEST_SECRET_KEY || "";

class StubTransport implements PaystackTransport {
  readonly calls: { method: string; path: string; body?: unknown }[] = [];

  constructor(private readonly responses: Record<string, { status: number; body: PaystackEnvelope }>) {}

  async request(method: "GET" | "POST", path: string, body?: unknown) {
    this.calls.push({ method, path, body });
    const key = `${method} ${path}`;
    const response = this.responses[key];
    if (!response) throw new Error(`No stubbed response for ${key}`);
    return response;
  }
}

function provider(transport: PaystackTransport) {
  return new PaystackPaymentProvider({ secretKey: SECRET, transport });
}

const SUCCESSFUL_TRANSACTION = {
  id: 302961,
  // Paystack echoes the dashed reference it was given.
  reference: "pay-9kQ2mVt4Xw7bN1Za",
  status: "success",
  amount: 1_000_000,
  currency: "NGN",
  paid_at: "2026-08-21T10:00:00.000Z",
  gateway_response: "Successful",
  customer: { customer_code: "CUS_xyz", email: "ada@example.test" },
  authorization: {
    authorization_code: "AUTH_abc123",
    card_type: "visa",
    last4: "4081",
    exp_month: "12",
    exp_year: "2030",
    bank: "TEST BANK",
    channel: "card",
    reusable: true,
    bin: "408408",
    account_name: "Ada Lovelace",
  },
};

describe("PaystackPaymentProvider", () => {
  it("refuses to construct without a secret key", () => {
    expect(() => new PaystackPaymentProvider({ secretKey: "" })).toThrow(BillingError);
  });

  it("declares only the capabilities it implements", () => {
    const capabilities = provider(new StubTransport({})).getCapabilities();
    // Mandate creation is not implemented, so the engine must never route to it.
    expect(capabilities.directDebit).toBe(false);
    expect(capabilities.recurringCard).toBe(true);
    expect(capabilities.supportedCurrencies).toContain("NGN");
  });

  // Paystack rejects a reference containing an underscore, and every id this
  // platform generates is `prefix_random`. These are the tests that were missing
  // when the adapter first shipped.
  describe("reference handling", () => {
    it("never sends an underscore to Paystack", async () => {
      const transport = new StubTransport({
        "POST /transaction/initialize": {
          status: 200,
          body: {
            status: true,
            data: { authorization_url: "https://checkout.paystack.com/abc", reference: "pay-9kQ2mVt4Xw7bN1Za" },
          },
        },
      });

      await provider(transport).createCheckout({
        reference: "pay_9kQ2mVt4Xw7bN1Za",
        amount: money(1_000_000, "NGN"),
        customer: { customerId: "cus_1", email: "ada@example.test" },
      });

      const sent = String((transport.calls[0]!.body as Record<string, unknown>).reference);
      expect(sent).not.toContain("_");
      expect(sent).toBe("pay-9kQ2mVt4Xw7bN1Za");
      // Paystack's documented rule: alphanumerics plus - . = only.
      expect(sent).toMatch(/^[A-Za-z0-9.=-]+$/);
    });

    it("sends no underscore on a recurring charge either", async () => {
      const transport = new StubTransport({
        "POST /transaction/charge_authorization": {
          status: 200,
          body: { status: true, data: SUCCESSFUL_TRANSACTION },
        },
      });

      await provider(transport).chargePaymentMethod({
        reference: "pay_R8sLp0Yc3Hd6Kf2W",
        amount: money(1_000_000, "NGN"),
        customer: { customerId: "cus_1", email: "ada@example.test" },
        paymentMethod: { type: "CARD", providerPaymentMethodRef: "AUTH_abc123" },
      });

      expect(String((transport.calls[0]!.body as Record<string, unknown>).reference)).toBe(
        "pay-R8sLp0Yc3Hd6Kf2W"
      );
    });

    it("verifies against the dashed form Paystack knows", async () => {
      const transport = new StubTransport({
        "GET /transaction/verify/pay-9kQ2mVt4Xw7bN1Za": {
          status: 200,
          body: { status: true, data: SUCCESSFUL_TRANSACTION },
        },
      });
      // Throws "no stubbed response" if the wrong path is requested.
      await provider(transport).verifyPayment("pay_9kQ2mVt4Xw7bN1Za");
      expect(transport.calls[0]!.path).toBe("/transaction/verify/pay-9kQ2mVt4Xw7bN1Za");
    });

    it("hands the engine back the platform id, not Paystack's spelling", async () => {
      const transport = new StubTransport({
        "GET /transaction/verify/pay-9kQ2mVt4Xw7bN1Za": {
          status: 200,
          body: { status: true, data: SUCCESSFUL_TRANSACTION },
        },
      });

      const result = await provider(transport).verifyPayment("pay_9kQ2mVt4Xw7bN1Za");
      // The engine looks the PaymentAttempt up by this; a dashed id finds nothing.
      expect(result.reference).toBe("pay_9kQ2mVt4Xw7bN1Za");
      expect(result.providerReference).toBe("pay-9kQ2mVt4Xw7bN1Za");
    });

    it("converts a webhook reference back before the engine sees it", async () => {
      const event = { event: "charge.success", data: SUCCESSFUL_TRANSACTION };
      const result = await provider(new StubTransport({})).normalizeWebhook(event);
      expect(result.reference).toBe("pay_9kQ2mVt4Xw7bN1Za");
      expect(result.providerReference).toBe("pay-9kQ2mVt4Xw7bN1Za");
    });

    it("round-trips every id this platform can generate", () => {
      for (let i = 0; i < 200; i += 1) {
        const id = newId("paymentAttempt");
        const out = toProviderReference(id);
        expect(out).toMatch(/^[A-Za-z0-9.=-]+$/);
        expect(fromProviderReference(out)).toBe(id);
      }
    });
  });

  it("initializes a checkout as PENDING, never as paid", async () => {
    const transport = new StubTransport({
      "POST /transaction/initialize": {
        status: 200,
        body: {
          status: true,
          data: { authorization_url: "https://checkout.paystack.com/abc", reference: "pay-9kQ2mVt4Xw7bN1Za" },
        },
      },
    });

    const result = await provider(transport).createCheckout({
      reference: "pay_9kQ2mVt4Xw7bN1Za",
      amount: money(1_000_000, "NGN"),
      customer: { customerId: "cus_1", email: "ada@example.test" },
    });

    expect(result.status).toBe("PENDING");
    expect(result.checkoutUrl).toBe("https://checkout.paystack.com/abc");
    // ₦10,000 is 1000000 kobo — sent through unchanged, not multiplied again.
    expect((transport.calls[0]!.body as Record<string, unknown>).amount).toBe(1_000_000);
    expect((transport.calls[0]!.body as Record<string, unknown>).reference).toBe("pay-9kQ2mVt4Xw7bN1Za");
  });

  it("reads the settled amount back from Paystack rather than trusting the caller", async () => {
    const transport = new StubTransport({
      "GET /transaction/verify/pay-9kQ2mVt4Xw7bN1Za": {
        status: 200,
        body: { status: true, data: { ...SUCCESSFUL_TRANSACTION, amount: 999_999 } },
      },
    });

    const result = await provider(transport).verifyPayment("pay_9kQ2mVt4Xw7bN1Za");
    expect(result.status).toBe("SUCCEEDED");
    expect(result.amount).toEqual({ amount: 999_999, currency: "NGN" });
  });

  it("keeps only safe payment-method metadata", async () => {
    const transport = new StubTransport({
      "GET /transaction/verify/pay-9kQ2mVt4Xw7bN1Za": {
        status: 200,
        body: { status: true, data: SUCCESSFUL_TRANSACTION },
      },
    });

    const result = await provider(transport).verifyPayment("pay_9kQ2mVt4Xw7bN1Za");
    expect(result.paymentMethod).toEqual({
      type: "CARD",
      providerPaymentMethodRef: "AUTH_abc123",
      providerCustomerRef: "CUS_xyz",
      brand: "visa",
      last4: "4081",
      expMonth: 12,
      expYear: 2030,
      bankName: "TEST BANK",
    });
    // The BIN and account name Paystack sends are not ours to keep.
    const serialized = JSON.stringify(result.paymentMethod);
    expect(serialized).not.toContain("408408");
    expect(serialized).not.toContain("Ada Lovelace");
  });

  it("does not store an authorization Paystack marked as non-reusable", async () => {
    const transport = new StubTransport({
      "GET /transaction/verify/pay-9kQ2mVt4Xw7bN1Za": {
        status: 200,
        body: {
          status: true,
          data: {
            ...SUCCESSFUL_TRANSACTION,
            authorization: { ...SUCCESSFUL_TRANSACTION.authorization, reusable: false },
          },
        },
      },
    });

    const result = await provider(transport).verifyPayment("pay_9kQ2mVt4Xw7bN1Za");
    expect(result.status).toBe("SUCCEEDED");
    expect(result.paymentMethod).toBeUndefined();
  });

  it("keeps no payment method off a failed charge", async () => {
    const transport = new StubTransport({
      "GET /transaction/verify/pay-9kQ2mVt4Xw7bN1Za": {
        status: 200,
        body: {
          status: true,
          data: {
            ...SUCCESSFUL_TRANSACTION,
            status: "failed",
            gateway_response: "Insufficient funds",
            paid_at: null,
          },
        },
      },
    });

    const result = await provider(transport).verifyPayment("pay_9kQ2mVt4Xw7bN1Za");
    expect(result.status).toBe("FAILED");
    expect(result.failureReason).toBe("Insufficient funds");
    expect(result.paymentMethod).toBeUndefined();
  });

  it("treats an abandoned checkout as pending, not failed", async () => {
    const transport = new StubTransport({
      "GET /transaction/verify/pay-9kQ2mVt4Xw7bN1Za": {
        status: 200,
        body: { status: true, data: { ...SUCCESSFUL_TRANSACTION, status: "abandoned", paid_at: null } },
      },
    });
    // The customer walked away; that is a different fact from a declined card
    // and must not put the subscription into recovery.
    expect((await provider(transport).verifyPayment("pay_9kQ2mVt4Xw7bN1Za")).status).toBe("PENDING");
  });

  it("treats an unrecognised status as pending, never as success", async () => {
    const transport = new StubTransport({
      "GET /transaction/verify/pay-9kQ2mVt4Xw7bN1Za": {
        status: 200,
        body: { status: true, data: { ...SUCCESSFUL_TRANSACTION, status: "some_new_state" } },
      },
    });
    expect((await provider(transport).verifyPayment("pay_9kQ2mVt4Xw7bN1Za")).status).toBe("PENDING");
  });

  it("charges a stored authorization with the platform's own reference", async () => {
    const transport = new StubTransport({
      "POST /transaction/charge_authorization": {
        status: 200,
        body: { status: true, data: { ...SUCCESSFUL_TRANSACTION, reference: "pay-R8sLp0Yc3Hd6Kf2W" } },
      },
    });

    const result = await provider(transport).chargePaymentMethod({
      reference: "pay_R8sLp0Yc3Hd6Kf2W",
      amount: money(1_000_000, "NGN"),
      customer: { customerId: "cus_1", email: "ada@example.test" },
      paymentMethod: { type: "CARD", providerPaymentMethodRef: "AUTH_abc123" },
    });

    expect(result.status).toBe("SUCCEEDED");
    const body = transport.calls[0]!.body as Record<string, unknown>;
    expect(body.authorization_code).toBe("AUTH_abc123");
    // Paystack rejects a repeated reference, which is what makes a retry safe.
    // It is sent in Paystack's spelling; the engine still sees its own id back.
    expect(body.reference).toBe("pay-R8sLp0Yc3Hd6Kf2W");
    expect(result.reference).toBe("pay_R8sLp0Yc3Hd6Kf2W");
  });

  it("refuses to charge a method type it cannot charge", async () => {
    await expect(
      provider(new StubTransport({})).chargePaymentMethod({
        reference: "pay_Zz1Aa2Bb3Cc4Dd5E",
        amount: money(1000, "NGN"),
        customer: { customerId: "cus_1", email: "ada@example.test" },
        paymentMethod: { type: "USSD", providerPaymentMethodRef: "x" },
      })
    ).rejects.toMatchObject({ code: "UNSUPPORTED_PROVIDER_CAPABILITY" });
  });

  it("surfaces an application-level rejection as a provider error", async () => {
    const transport = new StubTransport({
      "POST /transaction/initialize": {
        status: 200,
        body: { status: false, message: "Invalid key" },
      },
    });

    await expect(
      provider(transport).createCheckout({
        reference: "pay_9kQ2mVt4Xw7bN1Za",
        amount: money(1000, "NGN"),
        customer: { customerId: "cus_1", email: "ada@example.test" },
      })
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });

  // -- webhooks --------------------------------------------------------------

  function signed(body: unknown) {
    const rawBody = Buffer.from(JSON.stringify(body), "utf8");
    return {
      rawBody,
      headers: {
        "x-paystack-signature": createHmac("sha512", SECRET).update(rawBody).digest("hex"),
      },
    };
  }

  it("verifies a signature over the exact request bytes", async () => {
    const event = { event: "charge.success", data: SUCCESSFUL_TRANSACTION };
    const result = await provider(new StubTransport({})).verifyWebhook(signed(event));
    expect(result.verified).toBe(true);
    expect(result.payload).toEqual(event);
  });

  it("rejects a body that was altered after signing", async () => {
    const request = signed({ event: "charge.success", data: SUCCESSFUL_TRANSACTION });
    const tampered = {
      ...request,
      rawBody: Buffer.from(request.rawBody.toString("utf8").replace("1000000", "1"), "utf8"),
    };
    const result = await provider(new StubTransport({})).verifyWebhook(tampered);
    expect(result.verified).toBe(false);
  });

  it("rejects a webhook with no signature at all", async () => {
    const result = await provider(new StubTransport({})).verifyWebhook({
      headers: {},
      rawBody: Buffer.from("{}", "utf8"),
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/signature/i);
  });

  it("derives a de-duplication id that is stable across redeliveries", async () => {
    const paystack = provider(new StubTransport({}));
    const event = { event: "charge.success", data: SUCCESSFUL_TRANSACTION };

    const first = await paystack.normalizeWebhook(event);
    const second = await paystack.normalizeWebhook(event);

    expect(first.providerEventId).toBe(second.providerEventId);
    expect(first.providerEventId).toBe("charge.success:302961");
    expect(first.type).toBe("PAYMENT_SUCCEEDED");
    expect(first.reference).toBe("pay_9kQ2mVt4Xw7bN1Za");
    expect(first.amount).toEqual({ amount: 1_000_000, currency: "NGN" });
  });

  it("does not collide two different events on one transaction", async () => {
    const paystack = provider(new StubTransport({}));
    const success = await paystack.normalizeWebhook({ event: "charge.success", data: SUCCESSFUL_TRANSACTION });
    const refund = await paystack.normalizeWebhook({ event: "refund.processed", data: SUCCESSFUL_TRANSACTION });
    expect(success.providerEventId).not.toBe(refund.providerEventId);
  });

  it("normalizes an unknown event without guessing at it", async () => {
    const result = await provider(new StubTransport({})).normalizeWebhook({
      event: "subscription.not_renew",
      data: { id: 5 },
    });
    expect(result.type).toBe("UNKNOWN");
    expect(result.rawEventType).toBe("subscription.not_renew");
  });
});
