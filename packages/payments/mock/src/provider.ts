import { createHmac, randomUUID } from "node:crypto";
import {
  BasePaymentProvider,
  safeEqual,
  type ChargePaymentMethodInput,
  type CheckoutResult,
  type CreateCheckoutInput,
  type CreatePaymentLinkInput,
  type CreateProviderCustomerInput,
  type NormalizedPaymentEvent,
  type PaymentLinkResult,
  type PaymentProviderCapabilities,
  type PaymentResult,
  type ProviderCustomerResult,
  type ProviderPaymentMethodType,
  type RefundPaymentInput,
  type RefundResult,
  type WebhookRequest,
  type WebhookVerificationResult,
} from "@billing-platform/payments-core";
import { BillingError, assertCurrency, money } from "@billing-platform/shared";
import type { MockStore, MockTransaction } from "./store";

/**
 * Test outcome directives. Pass one as `metadata.mockOutcome` (API, SDK or
 * dashboard) to make a payment behave deterministically. Without a directive a
 * checkout stays PENDING until it is completed, and a stored-method charge
 * succeeds — which mirrors how the real rails behave on a healthy card.
 */
export type MockOutcome = "SUCCESS" | "FAILED" | "PENDING" | "EXPIRED";

export interface MockProviderOptions {
  store: MockStore;
  organizationId: string;
  /** Signs simulated webhooks so the same verification path is exercised. */
  webhookSecret: string;
  /** Base URL the simulated hosted checkout page is served from. */
  checkoutBaseUrl: string;
  /** Minutes a checkout stays open. */
  checkoutTtlMinutes?: number;
}

const CAPABILITIES: PaymentProviderCapabilities = {
  recurringCard: true,
  directDebit: true,
  bankTransfer: true,
  mobileMoney: true,
  refunds: true,
  paymentLinks: true,
  tokenization: true,
  supportedMethods: ["CARD", "BANK_TRANSFER", "DIRECT_DEBIT", "MOBILE_MONEY", "USSD"],
  supportedCurrencies: ["NGN", "USD", "KES", "GHS", "ZAR"],
};

/**
 * A complete, working payment rail that moves no money. Every flow the billing
 * engine depends on — hosted checkout, tokenization, recurring charge, failure,
 * refund, signed webhook — is implemented here, so the whole platform runs
 * locally with no provider credentials at all.
 */
export class MockPaymentProvider extends BasePaymentProvider {
  readonly kind = "MOCK" as const;

  constructor(private readonly options: MockProviderOptions) {
    super();
  }

  override getCapabilities(): PaymentProviderCapabilities {
    return CAPABILITIES;
  }

  override async testCredentials(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: "Mock provider is always reachable." };
  }

  override async createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
    const outcome = readOutcome(input.metadata);
    const ttlMinutes = this.options.checkoutTtlMinutes ?? 30;
    const method = (input.allowedMethods?.[0] ?? "CARD") as ProviderPaymentMethodType;
    const providerReference = `mock_ch_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

    const txn: MockTransaction = {
      reference: input.reference,
      providerReference,
      organizationId: this.options.organizationId,
      amount: input.amount.amount,
      currency: input.amount.currency,
      status: "PENDING",
      customerEmail: input.customer.email,
      customerId: input.customer.customerId,
      description: input.description,
      savePaymentMethod: Boolean(input.savePaymentMethod),
      method,
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
      metadata: (input.metadata ?? {}) as Record<string, unknown>,
    };

    // A directive resolves the checkout immediately so automated tests do not
    // have to drive the hosted page.
    if (outcome === "SUCCESS") this.applySuccess(txn);
    if (outcome === "FAILED") this.applyFailure(txn, "card_declined", "Card declined by issuer (simulated).");
    if (outcome === "EXPIRED") {
      txn.status = "CANCELED";
      txn.expiresAt = new Date(Date.now() - 1000).toISOString();
      txn.failureCode = "checkout_expired";
      txn.failureReason = "Checkout session expired (simulated).";
    }

    await this.options.store.put(txn);

    return {
      reference: txn.reference,
      providerReference,
      checkoutUrl: `${this.options.checkoutBaseUrl}/mock/checkout/${encodeURIComponent(txn.reference)}`,
      status: txn.status,
      expiresAt: new Date(txn.expiresAt),
      raw: txn,
    };
  }

  override async verifyPayment(reference: string): Promise<PaymentResult> {
    const txn = await this.requireTransaction(reference);
    if (txn.status === "PENDING" && new Date(txn.expiresAt).getTime() < Date.now()) {
      txn.status = "CANCELED";
      txn.failureCode = "checkout_expired";
      txn.failureReason = "Checkout session expired (simulated).";
      await this.options.store.put(txn);
    }
    return this.toPaymentResult(txn);
  }

  override async chargePaymentMethod(input: ChargePaymentMethodInput): Promise<PaymentResult> {
    if (!CAPABILITIES.supportedMethods.includes(input.paymentMethod.type)) {
      this.unsupported(`charge:${input.paymentMethod.type}`);
    }
    const outcome = readOutcome(input.metadata) ?? decodeOutcomeFromToken(input.paymentMethod.providerPaymentMethodRef);
    const txn: MockTransaction = {
      reference: input.reference,
      providerReference: `mock_tx_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      organizationId: this.options.organizationId,
      amount: input.amount.amount,
      currency: input.amount.currency,
      status: "PROCESSING",
      customerEmail: input.customer.email,
      customerId: input.customer.customerId,
      description: input.description,
      savePaymentMethod: false,
      method: input.paymentMethod.type,
      paymentMethodRef: input.paymentMethod.providerPaymentMethodRef,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      metadata: (input.metadata ?? {}) as Record<string, unknown>,
    };

    if (outcome === "FAILED") {
      this.applyFailure(txn, "insufficient_funds", "Insufficient funds (simulated).");
    } else if (outcome === "PENDING") {
      txn.status = "PENDING";
    } else {
      this.applySuccess(txn);
    }

    await this.options.store.put(txn);
    return this.toPaymentResult(txn);
  }

  override async createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLinkResult> {
    const checkout = await this.createCheckout({
      reference: input.reference,
      amount: input.amount,
      customer: input.customer ?? {
        customerId: "cus_unknown",
        email: "link@example.test",
      },
      description: input.description,
      metadata: input.metadata,
    });
    return {
      reference: checkout.reference,
      providerReference: checkout.providerReference,
      url: checkout.checkoutUrl,
      expiresAt: input.expiresAt ?? checkout.expiresAt,
      raw: checkout.raw,
    };
  }

  override async createCustomer(input: CreateProviderCustomerInput): Promise<ProviderCustomerResult> {
    return { providerCustomerRef: `mock_cus_${input.customerId}` };
  }

  override async refundPayment(input: RefundPaymentInput): Promise<RefundResult> {
    return {
      providerRefundRef: `mock_rf_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      status: "SUCCEEDED",
      amount: input.amount,
    };
  }

  /** Signature scheme deliberately mirrors the real adapters: HMAC over raw bytes. */
  override async verifyWebhook(request: WebhookRequest): Promise<WebhookVerificationResult> {
    const header = request.headers["x-mock-signature"];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!signature) return { verified: false, reason: "Missing x-mock-signature header." };

    const expected = createHmac("sha256", this.options.webhookSecret)
      .update(request.rawBody)
      .digest("hex");

    if (!safeEqual(signature, expected)) {
      return { verified: false, reason: "Signature mismatch." };
    }
    return { verified: true, payload: JSON.parse(request.rawBody.toString("utf8")) };
  }

  override async normalizeWebhook(payload: unknown): Promise<NormalizedPaymentEvent> {
    const event = payload as {
      id?: string;
      event?: string;
      data?: Record<string, unknown>;
    };
    const data = event.data ?? {};
    const reference = typeof data.reference === "string" ? data.reference : undefined;
    const rawEventType = event.event ?? "unknown";

    const type =
      rawEventType === "payment.succeeded"
        ? "PAYMENT_SUCCEEDED"
        : rawEventType === "payment.failed"
          ? "PAYMENT_FAILED"
          : rawEventType === "payment.pending"
            ? "PAYMENT_PENDING"
            : rawEventType === "refund.succeeded"
              ? "REFUND_SUCCEEDED"
              : "UNKNOWN";

    const amount =
      typeof data.amount === "number" && typeof data.currency === "string"
        ? money(data.amount, assertCurrency(data.currency))
        : undefined;

    return {
      providerEventId: event.id ?? `mock_evt_${reference ?? randomUUID()}`,
      type,
      rawEventType,
      reference,
      providerReference: typeof data.providerReference === "string" ? data.providerReference : undefined,
      amount,
      paidAt: typeof data.paidAt === "string" ? new Date(data.paidAt) : undefined,
      failureCode: typeof data.failureCode === "string" ? data.failureCode : undefined,
      failureReason: typeof data.failureReason === "string" ? data.failureReason : undefined,
      paymentMethod:
        typeof data.paymentMethodRef === "string"
          ? {
              type: (typeof data.method === "string" ? data.method : "CARD") as ProviderPaymentMethodType,
              providerPaymentMethodRef: data.paymentMethodRef,
              brand: "visa",
              last4: "4081",
              expMonth: 12,
              expYear: new Date().getUTCFullYear() + 4,
            }
          : undefined,
      raw: payload,
    };
  }

  // -- simulation controls used by the local mock checkout page ---------------

  /** Drive a pending checkout to its outcome, as a customer would. */
  async completeCheckout(
    reference: string,
    outcome: MockOutcome
  ): Promise<{ transaction: MockTransaction; webhook: { body: string; signature: string } }> {
    const txn = await this.requireTransaction(reference);
    if (txn.status === "SUCCEEDED") {
      throw new BillingError("ALREADY_EXISTS", "This mock checkout has already succeeded.");
    }
    if (outcome === "SUCCESS") this.applySuccess(txn);
    else if (outcome === "FAILED") this.applyFailure(txn, "card_declined", "Card declined by issuer (simulated).");
    else if (outcome === "PENDING") txn.status = "PENDING";
    else {
      txn.status = "CANCELED";
      txn.failureCode = "checkout_expired";
      txn.failureReason = "Checkout session expired (simulated).";
    }
    await this.options.store.put(txn);
    return { transaction: txn, webhook: this.buildWebhook(txn) };
  }

  /** Serialize and sign the webhook the provider would have sent. */
  buildWebhook(txn: MockTransaction): { body: string; signature: string } {
    const eventName =
      txn.status === "SUCCEEDED"
        ? "payment.succeeded"
        : txn.status === "FAILED" || txn.status === "CANCELED"
          ? "payment.failed"
          : "payment.pending";

    const body = JSON.stringify({
      id: `mock_evt_${txn.providerReference}_${txn.status}`,
      event: eventName,
      createdAt: new Date().toISOString(),
      data: {
        reference: txn.reference,
        providerReference: txn.providerReference,
        amount: txn.amount,
        currency: txn.currency,
        status: txn.status,
        method: txn.method,
        paidAt: txn.paidAt,
        failureCode: txn.failureCode,
        failureReason: txn.failureReason,
        paymentMethodRef: txn.paymentMethodRef,
      },
    });
    const signature = createHmac("sha256", this.options.webhookSecret).update(body).digest("hex");
    return { body, signature };
  }

  async getTransaction(reference: string): Promise<MockTransaction | null> {
    return this.options.store.get(reference);
  }

  async listTransactions(): Promise<MockTransaction[]> {
    return this.options.store.list(this.options.organizationId);
  }

  // -- internals -------------------------------------------------------------

  private applySuccess(txn: MockTransaction): void {
    txn.status = "SUCCEEDED";
    txn.paidAt = new Date().toISOString();
    txn.failureCode = undefined;
    txn.failureReason = undefined;
    if (txn.savePaymentMethod && !txn.paymentMethodRef) {
      txn.paymentMethodRef = `mock_pm_ok_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    }
  }

  private applyFailure(txn: MockTransaction, code: string, reason: string): void {
    txn.status = "FAILED";
    txn.failureCode = code;
    txn.failureReason = reason;
  }

  private async requireTransaction(reference: string): Promise<MockTransaction> {
    const txn = await this.options.store.get(reference);
    if (!txn) {
      throw new BillingError("PAYMENT_ATTEMPT_NOT_FOUND", `No mock transaction for reference "${reference}".`);
    }
    return txn;
  }

  private toPaymentResult(txn: MockTransaction): PaymentResult {
    return {
      reference: txn.reference,
      providerReference: txn.providerReference,
      status: txn.status,
      amount: money(txn.amount, assertCurrency(txn.currency)),
      paidAt: txn.paidAt ? new Date(txn.paidAt) : undefined,
      failureCode: txn.failureCode,
      failureReason: txn.failureReason,
      paymentMethod:
        txn.status === "SUCCEEDED" && txn.paymentMethodRef
          ? {
              type: txn.method as ProviderPaymentMethodType,
              providerPaymentMethodRef: txn.paymentMethodRef,
              providerCustomerRef: `mock_cus_${txn.customerId}`,
              brand: "visa",
              last4: "4081",
              expMonth: 12,
              expYear: new Date().getUTCFullYear() + 4,
            }
          : undefined,
      raw: txn,
    };
  }
}

function readOutcome(metadata: Record<string, unknown> | undefined): MockOutcome | undefined {
  const value = metadata?.mockOutcome;
  if (typeof value !== "string") return undefined;
  const upper = value.toUpperCase();
  return ["SUCCESS", "FAILED", "PENDING", "EXPIRED"].includes(upper) ? (upper as MockOutcome) : undefined;
}

/**
 * Tokens minted as `mock_pm_fail_*` always decline. That gives tests a stored
 * payment method whose *next* charge fails, which is what the dunning suite
 * needs in order to exercise recovery.
 */
function decodeOutcomeFromToken(ref: string): MockOutcome | undefined {
  if (ref.startsWith("mock_pm_fail")) return "FAILED";
  if (ref.startsWith("mock_pm_pending")) return "PENDING";
  return undefined;
}
