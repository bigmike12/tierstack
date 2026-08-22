import { createHmac } from "node:crypto";
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
  type RefundPaymentInput,
  type RefundResult,
  type WebhookRequest,
  type WebhookVerificationResult,
} from "@tierbase/payments-core";
import { BillingError } from "@tierbase/shared";
import { HttpPaystackTransport, unwrap, type PaystackTransport } from "./client";
import {
  PAYSTACK_CURRENCIES,
  asRecord,
  asString,
  fromPaystackAmount,
  parsePaidAt,
  toChannels,
  toEventType,
  toPaymentStatus,
  toPaystackAmount,
  toTokenizedMethod,
} from "./mapping";

export interface PaystackProviderOptions {
  secretKey: string;
  /** Only used to build a checkout URL when Paystack does not return one. */
  publicKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injected in tests; production uses the HTTP transport. */
  transport?: PaystackTransport;
}

/**
 * What Paystack can do, as this adapter implements it.
 *
 * `directDebit` is false on purpose. Paystack does offer direct debit products,
 * but this adapter does not implement mandate creation, so declaring the
 * capability would make the engine route a payment to a method that cannot
 * complete. False here means the engine never asks, and asking anyway raises
 * UNSUPPORTED_PROVIDER_CAPABILITY rather than failing halfway through a charge.
 */
const CAPABILITIES: PaymentProviderCapabilities = {
  recurringCard: true,
  directDebit: false,
  bankTransfer: true,
  mobileMoney: true,
  refunds: true,
  paymentLinks: true,
  tokenization: true,
  supportedMethods: ["CARD", "BANK_ACCOUNT", "BANK_TRANSFER", "MOBILE_MONEY", "USSD"],
  supportedCurrencies: PAYSTACK_CURRENCIES,
};

/**
 * The Paystack rail.
 *
 * Two rules shape everything below. First, the platform's own `reference` is
 * what every call is keyed on, so a timed-out request can always be resolved by
 * asking Paystack about that reference rather than guessing. Second, nothing a
 * customer's browser reports is believed: a checkout is only settled by
 * `verifyPayment` or by a signature-verified webhook, both of which read the
 * amount back from Paystack and hand it to the engine to compare against the
 * invoice.
 */
export class PaystackPaymentProvider extends BasePaymentProvider {
  readonly kind = "PAYSTACK" as const;

  private readonly transport: PaystackTransport;

  constructor(private readonly options: PaystackProviderOptions) {
    super();
    if (!options.secretKey) {
      throw new BillingError(
        "PROVIDER_ERROR",
        "The Paystack adapter needs a secretKey credential (sk_test_… or sk_live_…)."
      );
    }
    this.transport =
      options.transport ??
      new HttpPaystackTransport({
        secretKey: options.secretKey,
        baseUrl: options.baseUrl,
        timeoutMs: options.timeoutMs,
      });
  }

  override getCapabilities(): PaymentProviderCapabilities {
    return CAPABILITIES;
  }

  /**
   * Lists one transaction. Any authenticated endpoint would do; this one is
   * cheap and read-only, so testing credentials can never move money.
   */
  override async testCredentials(): Promise<{ ok: boolean; message: string }> {
    try {
      const result = await this.transport.request("GET", "/transaction?perPage=1");
      if (result.status === 401) {
        return { ok: false, message: "Paystack rejected the secret key." };
      }
      if (result.status < 200 || result.status >= 300) {
        return { ok: false, message: result.body.message ?? `Paystack returned HTTP ${result.status}.` };
      }
      return { ok: true, message: "Paystack accepted the secret key." };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Could not reach Paystack.",
      };
    }
  }

  override async createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
    const data = unwrap(
      await this.transport.request("POST", "/transaction/initialize", {
        email: input.customer.email,
        amount: toPaystackAmount(input.amount),
        currency: input.amount.currency,
        reference: input.reference,
        ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
        ...(toChannels(input.allowedMethods) ? { channels: toChannels(input.allowedMethods) } : {}),
        // Paystack echoes metadata back on verify and on the webhook, which is
        // how a payment is tied to its subscription without a second lookup.
        metadata: {
          ...(input.metadata ?? {}),
          tierbase_customer_id: input.customer.customerId,
          ...(input.description ? { description: input.description } : {}),
        },
      }),
      "transaction initialization"
    );

    const checkoutUrl = asString(data.authorization_url);
    if (!checkoutUrl) {
      throw new BillingError("PROVIDER_ERROR", "Paystack did not return a checkout URL.");
    }

    return {
      reference: asString(data.reference) ?? input.reference,
      providerReference: asString(data.reference) ?? input.reference,
      checkoutUrl,
      // Initialization only opens a checkout; nothing has been paid yet, and
      // saying otherwise here would grant access before any money moved.
      status: "PENDING",
      raw: data,
    };
  }

  override async verifyPayment(reference: string): Promise<PaymentResult> {
    const data = unwrap(
      await this.transport.request("GET", `/transaction/verify/${encodeURIComponent(reference)}`),
      "transaction verification"
    );
    return this.toPaymentResult(reference, data);
  }

  /**
   * A renewal: charging a stored authorization with nobody present. This is the
   * one call that must never be retried blindly — the platform's reference makes
   * it idempotent on Paystack's side, so a repeat with the same reference is
   * rejected rather than charged twice.
   */
  override async chargePaymentMethod(input: ChargePaymentMethodInput): Promise<PaymentResult> {
    if (input.paymentMethod.type !== "CARD" && input.paymentMethod.type !== "BANK_ACCOUNT") {
      return this.unsupported(`recurring charge for ${input.paymentMethod.type}`);
    }

    const data = unwrap(
      await this.transport.request("POST", "/transaction/charge_authorization", {
        email: input.customer.email,
        amount: toPaystackAmount(input.amount),
        currency: input.amount.currency,
        reference: input.reference,
        authorization_code: input.paymentMethod.providerPaymentMethodRef,
        metadata: {
          ...(input.metadata ?? {}),
          tierbase_customer_id: input.customer.customerId,
        },
      }),
      "authorization charge"
    );

    return this.toPaymentResult(input.reference, data);
  }

  override async createCustomer(input: CreateProviderCustomerInput): Promise<ProviderCustomerResult> {
    const [firstName, ...rest] = (input.name ?? "").trim().split(/\s+/).filter(Boolean);
    const data = unwrap(
      await this.transport.request("POST", "/customer", {
        email: input.email,
        ...(firstName ? { first_name: firstName } : {}),
        ...(rest.length > 0 ? { last_name: rest.join(" ") } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        metadata: { ...(input.metadata ?? {}), tierbase_customer_id: input.customerId },
      }),
      "customer creation"
    );

    const code = asString(data.customer_code);
    if (!code) throw new BillingError("PROVIDER_ERROR", "Paystack did not return a customer code.");
    return { providerCustomerRef: code, raw: data };
  }

  override async createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLinkResult> {
    const data = unwrap(
      await this.transport.request("POST", "/page", {
        name: input.description ?? `Payment ${input.reference}`,
        amount: toPaystackAmount(input.amount),
        currency: input.amount.currency,
        // The slug is the URL, and it must be stable per reference so the same
        // link is never created twice.
        slug: input.reference.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        metadata: { ...(input.metadata ?? {}), tierbase_reference: input.reference },
      }),
      "payment page creation"
    );

    const slug = asString(data.slug);
    if (!slug) throw new BillingError("PROVIDER_ERROR", "Paystack did not return a payment page slug.");

    return {
      reference: input.reference,
      providerReference: String(data.id ?? slug),
      url: `https://paystack.com/pay/${slug}`,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      raw: data,
    };
  }

  override async refundPayment(input: RefundPaymentInput): Promise<RefundResult> {
    const data = unwrap(
      await this.transport.request("POST", "/refund", {
        transaction: input.providerReference,
        amount: toPaystackAmount(input.amount),
        ...(input.reason ? { merchant_note: input.reason } : {}),
      }),
      "refund"
    );

    // Paystack refunds settle asynchronously; only "processed" is final.
    const status = String(data.status ?? "pending").toLowerCase();
    return {
      providerRefundRef: String(data.id ?? input.providerReference),
      status: status === "processed" ? "SUCCEEDED" : status === "failed" ? "FAILED" : "PENDING",
      amount: input.amount,
      raw: data,
    };
  }

  /**
   * HMAC-SHA512 of the exact request bytes, keyed on the secret key.
   *
   * The raw buffer is used deliberately: re-serializing the parsed JSON changes
   * key order and whitespace, and the signature would never match. A comparison
   * that fails must not leak timing information either, hence safeEqual.
   */
  override async verifyWebhook(request: WebhookRequest): Promise<WebhookVerificationResult> {
    const header = request.headers["x-paystack-signature"];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!signature) {
      return { verified: false, reason: "Missing x-paystack-signature header." };
    }

    const expected = createHmac("sha512", this.options.secretKey).update(request.rawBody).digest("hex");
    if (!safeEqual(signature, expected)) {
      return { verified: false, reason: "Signature does not match the request body." };
    }

    try {
      return { verified: true, payload: JSON.parse(request.rawBody.toString("utf8")) };
    } catch {
      // A body that passed the signature check but is not JSON means Paystack
      // sent something this adapter cannot read — not a forgery, but not
      // processable either.
      return { verified: false, reason: "Signed payload is not valid JSON." };
    }
  }

  override async normalizeWebhook(payload: unknown): Promise<NormalizedPaymentEvent> {
    const envelope = asRecord(payload);
    const data = asRecord(envelope.data);
    const rawEventType = String(envelope.event ?? "unknown");

    const reference = asString(data.reference);
    const currency = asString(data.currency);
    const amount =
      currency && data.amount !== undefined ? fromPaystackAmount(data.amount, currency) : undefined;

    const customer = asRecord(data.customer);
    const method = toTokenizedMethod(data.authorization, asString(customer.customer_code) ?? null);

    // Paystack does not send a dedicated event id, so the de-duplication key is
    // composed from the event name and the transaction id — the same delivery
    // replayed produces the same key, and two genuinely different events on one
    // transaction do not collide.
    const providerEventId = `${rawEventType}:${String(data.id ?? reference ?? "unknown")}`;

    return {
      providerEventId,
      type: toEventType(envelope.event),
      rawEventType,
      ...(reference ? { reference, providerReference: reference } : {}),
      ...(amount ? { amount } : {}),
      ...(parsePaidAt(data.paid_at) ? { paidAt: parsePaidAt(data.paid_at) } : {}),
      ...(String(data.status ?? "") === "failed"
        ? {
            failureCode: "PAYSTACK_DECLINED",
            failureReason: asString(data.gateway_response) ?? "The payment was declined.",
          }
        : {}),
      ...(method ? { paymentMethod: method } : {}),
      raw: payload,
    };
  }

  // -------------------------------------------------------------------------

  /** One place where a Paystack transaction becomes a PaymentResult. */
  private toPaymentResult(reference: string, data: Record<string, unknown>): PaymentResult {
    const currency = asString(data.currency);
    if (!currency) {
      throw new BillingError("PROVIDER_ERROR", "Paystack returned a transaction with no currency.");
    }

    const status = toPaymentStatus(data.status);
    const customer = asRecord(data.customer);
    const method = toTokenizedMethod(data.authorization, asString(customer.customer_code) ?? null);

    return {
      reference: asString(data.reference) ?? reference,
      providerReference: asString(data.reference) ?? reference,
      status,
      // Read back from Paystack, never taken from the request. The engine
      // compares this against the invoice before marking anything paid.
      amount: fromPaystackAmount(data.amount, currency),
      ...(parsePaidAt(data.paid_at) ? { paidAt: parsePaidAt(data.paid_at) } : {}),
      ...(status === "FAILED"
        ? {
            failureCode: "PAYSTACK_DECLINED",
            failureReason: asString(data.gateway_response) ?? "The payment was declined.",
          }
        : {}),
      // A payment method is only ever kept off a successful transaction: an
      // authorization from a failed charge is not reusable.
      ...(status === "SUCCEEDED" && method ? { paymentMethod: method } : {}),
      raw: data,
    };
  }
}
