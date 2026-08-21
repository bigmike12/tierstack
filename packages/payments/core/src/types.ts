import type { CurrencyCode, Money } from "@tierbase/shared";

export type ProviderKind = "PAYSTACK" | "MONNIFY" | "FLUTTERWAVE" | "MOCK";

export type ProviderPaymentMethodType =
  | "CARD"
  | "BANK_ACCOUNT"
  | "BANK_TRANSFER"
  | "DIRECT_DEBIT"
  | "MOBILE_MONEY"
  | "USSD";

/**
 * What a provider can actually do. The billing engine consults this before
 * every operation; an adapter that reports `false` is never asked, and if it is
 * asked anyway it must throw UnsupportedCapabilityError rather than pretend.
 */
export interface PaymentProviderCapabilities {
  recurringCard: boolean;
  directDebit: boolean;
  bankTransfer: boolean;
  mobileMoney: boolean;
  refunds: boolean;
  paymentLinks: boolean;
  tokenization: boolean;
  /** Payment-method types the adapter can collect with. */
  supportedMethods: ProviderPaymentMethodType[];
  /** Currencies the adapter can settle. Empty means "no restriction declared". */
  supportedCurrencies: CurrencyCode[];
}

export interface ProviderCustomerRef {
  /** Platform customer id — always sent so provider dashboards stay traceable. */
  customerId: string;
  email: string;
  name?: string | null;
  phone?: string | null;
  /** Provider-side customer handle, when one was previously created. */
  providerCustomerRef?: string | null;
}

export interface CreateCheckoutInput {
  /** Idempotent reference owned by the platform, echoed back by the provider. */
  reference: string;
  amount: Money;
  customer: ProviderCustomerRef;
  description?: string;
  callbackUrl?: string;
  /** Ask the provider to retain a reusable payment method for later charges. */
  savePaymentMethod?: boolean;
  allowedMethods?: ProviderPaymentMethodType[];
  metadata?: Record<string, unknown>;
}

export interface CheckoutResult {
  reference: string;
  providerReference: string;
  checkoutUrl: string;
  status: PaymentStatus;
  expiresAt?: Date;
  raw?: unknown;
}

export type PaymentStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELED";

export interface PaymentResult {
  reference: string;
  providerReference: string;
  status: PaymentStatus;
  /**
   * The amount the provider says it actually collected. The engine compares
   * this against the invoice before marking anything paid.
   */
  amount: Money;
  paidAt?: Date;
  failureCode?: string;
  failureReason?: string;
  /** Present when the provider retained a reusable payment instrument. */
  paymentMethod?: TokenizedPaymentMethod;
  raw?: unknown;
}

/** Safe metadata only. No PAN, no CVV, no bank credentials — ever. */
export interface TokenizedPaymentMethod {
  type: ProviderPaymentMethodType;
  providerPaymentMethodRef: string;
  providerCustomerRef?: string | null;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
  bankName?: string;
}

export interface ChargePaymentMethodInput {
  reference: string;
  amount: Money;
  customer: ProviderCustomerRef;
  paymentMethod: {
    type: ProviderPaymentMethodType;
    providerPaymentMethodRef: string;
    providerCustomerRef?: string | null;
  };
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface CreatePaymentLinkInput {
  reference: string;
  amount: Money;
  customer?: ProviderCustomerRef;
  description?: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface PaymentLinkResult {
  reference: string;
  providerReference: string;
  url: string;
  expiresAt?: Date;
  raw?: unknown;
}

export interface CreateProviderCustomerInput {
  customerId: string;
  email: string;
  name?: string | null;
  phone?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ProviderCustomerResult {
  providerCustomerRef: string;
  raw?: unknown;
}

export interface RefundPaymentInput {
  providerReference: string;
  amount: Money;
  reason?: string;
}

export interface RefundResult {
  providerRefundRef: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  amount: Money;
  raw?: unknown;
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  /** Exact bytes as received. Signature checks must not use a re-serialized body. */
  rawBody: Buffer;
}

export interface WebhookVerificationResult {
  verified: boolean;
  reason?: string;
  payload?: unknown;
}

export type NormalizedEventType =
  | "PAYMENT_SUCCEEDED"
  | "PAYMENT_FAILED"
  | "PAYMENT_PENDING"
  | "REFUND_SUCCEEDED"
  | "PAYMENT_METHOD_ATTACHED"
  | "UNKNOWN";

/** Provider events are flattened into this shape before touching billing state. */
export interface NormalizedPaymentEvent {
  /** Stable id used for webhook de-duplication. */
  providerEventId: string;
  type: NormalizedEventType;
  rawEventType: string;
  /** The platform-owned reference the payment was initiated with, when present. */
  reference?: string;
  providerReference?: string;
  amount?: Money;
  paidAt?: Date;
  failureCode?: string;
  failureReason?: string;
  paymentMethod?: TokenizedPaymentMethod;
  raw: unknown;
}
