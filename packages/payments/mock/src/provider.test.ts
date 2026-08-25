import { beforeEach, describe, expect, it } from "vitest";
import { money } from "@tierstack/shared";
import { MockPaymentProvider } from "./provider";
import { InMemoryMockStore } from "./store";

const store = new InMemoryMockStore();
const provider = new MockPaymentProvider({
  store,
  organizationId: "org_test",
  webhookSecret: "whsec_test",
  checkoutBaseUrl: "http://localhost:4000",
});

const customer = { customerId: "cus_1", email: "buyer@example.test", name: "Buyer" };

beforeEach(() => store.clear());

describe("mock payment provider", () => {
  it("opens a pending checkout with a usable URL", async () => {
    const checkout = await provider.createCheckout({
      reference: "ref_1",
      amount: money(1_000_000, "NGN"),
      customer,
      savePaymentMethod: true,
    });
    expect(checkout.status).toBe("PENDING");
    expect(checkout.checkoutUrl).toContain("/mock/checkout/ref_1");
  });

  it("resolves a checkout on customer completion and tokenizes the method", async () => {
    await provider.createCheckout({
      reference: "ref_2",
      amount: money(1_000_000, "NGN"),
      customer,
      savePaymentMethod: true,
    });
    const { transaction } = await provider.completeCheckout("ref_2", "SUCCESS");
    expect(transaction.status).toBe("SUCCEEDED");

    const verified = await provider.verifyPayment("ref_2");
    expect(verified.status).toBe("SUCCEEDED");
    expect(verified.amount.amount).toBe(1_000_000);
    expect(verified.paymentMethod?.providerPaymentMethodRef).toMatch(/^mock_pm_ok_/);
    expect(verified.paymentMethod?.last4).toBe("4081");
  });

  it("honours an explicit failure directive", async () => {
    await provider.createCheckout({
      reference: "ref_3",
      amount: money(500_00, "NGN"),
      customer,
      metadata: { mockOutcome: "FAILED" },
    });
    const result = await provider.verifyPayment("ref_3");
    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("card_declined");
  });

  it("expires a stale checkout on verification", async () => {
    await provider.createCheckout({
      reference: "ref_4",
      amount: money(100, "NGN"),
      customer,
      metadata: { mockOutcome: "EXPIRED" },
    });
    const result = await provider.verifyPayment("ref_4");
    expect(result.status).toBe("CANCELED");
    expect(result.failureCode).toBe("checkout_expired");
  });

  it("charges a stored payment method without a checkout", async () => {
    const result = await provider.chargePaymentMethod({
      reference: "ref_5",
      amount: money(1_000_000, "NGN"),
      customer,
      paymentMethod: { type: "CARD", providerPaymentMethodRef: "mock_pm_ok_abc" },
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.paidAt).toBeInstanceOf(Date);
  });

  it("declines a token minted to fail, so recovery flows can be tested", async () => {
    const result = await provider.chargePaymentMethod({
      reference: "ref_6",
      amount: money(1_000_000, "NGN"),
      customer,
      paymentMethod: { type: "CARD", providerPaymentMethodRef: "mock_pm_fail_abc" },
    });
    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("insufficient_funds");
  });

  it("signs webhooks and rejects tampered payloads", async () => {
    await provider.createCheckout({
      reference: "ref_7",
      amount: money(1_000_000, "NGN"),
      customer,
      metadata: { mockOutcome: "SUCCESS" },
    });
    const txn = await provider.getTransaction("ref_7");
    const { body, signature } = provider.buildWebhook(txn!);

    const good = await provider.verifyWebhook({
      headers: { "x-mock-signature": signature },
      rawBody: Buffer.from(body),
    });
    expect(good.verified).toBe(true);

    const tampered = await provider.verifyWebhook({
      headers: { "x-mock-signature": signature },
      rawBody: Buffer.from(body.replace("1000000", "1")),
    });
    expect(tampered.verified).toBe(false);

    const unsigned = await provider.verifyWebhook({ headers: {}, rawBody: Buffer.from(body) });
    expect(unsigned.verified).toBe(false);
  });

  it("normalizes its own webhook into the canonical event shape", async () => {
    await provider.createCheckout({
      reference: "ref_8",
      amount: money(1_000_000, "NGN"),
      customer,
      savePaymentMethod: true,
      metadata: { mockOutcome: "SUCCESS" },
    });
    const txn = await provider.getTransaction("ref_8");
    const { body } = provider.buildWebhook(txn!);
    const event = await provider.normalizeWebhook(JSON.parse(body));

    expect(event.type).toBe("PAYMENT_SUCCEEDED");
    expect(event.reference).toBe("ref_8");
    expect(event.amount?.amount).toBe(1_000_000);
    expect(event.providerEventId).toContain(txn!.providerReference);
  });

  it("produces a stable event id so replays de-duplicate", async () => {
    await provider.createCheckout({
      reference: "ref_9",
      amount: money(100, "NGN"),
      customer,
      metadata: { mockOutcome: "SUCCESS" },
    });
    const txn = await provider.getTransaction("ref_9");
    const first = await provider.normalizeWebhook(JSON.parse(provider.buildWebhook(txn!).body));
    const second = await provider.normalizeWebhook(JSON.parse(provider.buildWebhook(txn!).body));
    expect(first.providerEventId).toBe(second.providerEventId);
  });

  it("refunds", async () => {
    const refund = await provider.refundPayment({
      providerReference: "mock_tx_1",
      amount: money(1_000_000, "NGN"),
    });
    expect(refund.status).toBe("SUCCEEDED");
  });
});
