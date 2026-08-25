import { UnsupportedCapabilityError } from "@tierstack/shared";
import type {
  ChargePaymentMethodInput,
  CheckoutResult,
  CreateCheckoutInput,
  CreatePaymentLinkInput,
  CreateProviderCustomerInput,
  NormalizedPaymentEvent,
  PaymentLinkResult,
  PaymentProviderCapabilities,
  PaymentResult,
  ProviderCustomerResult,
  ProviderKind,
  RefundPaymentInput,
  RefundResult,
  WebhookRequest,
  WebhookVerificationResult,
} from "./types";

/**
 * The only surface the billing engine knows about. Adding a payment rail means
 * writing one of these; it must never mean editing the billing engine.
 */
export interface PaymentProvider {
  readonly kind: ProviderKind;

  createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult>;
  verifyPayment(reference: string): Promise<PaymentResult>;
  chargePaymentMethod(input: ChargePaymentMethodInput): Promise<PaymentResult>;
  createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLinkResult>;
  createCustomer(input: CreateProviderCustomerInput): Promise<ProviderCustomerResult>;
  refundPayment(input: RefundPaymentInput): Promise<RefundResult>;
  verifyWebhook(request: WebhookRequest): Promise<WebhookVerificationResult>;
  normalizeWebhook(payload: unknown): Promise<NormalizedPaymentEvent>;
  getCapabilities(): PaymentProviderCapabilities;

  /** Cheap credential round-trip, used by the dashboard's "test credentials". */
  testCredentials(): Promise<{ ok: boolean; message: string }>;
}

/**
 * Base class that turns every unimplemented capability into an explicit
 * UNSUPPORTED_PROVIDER_CAPABILITY error. An adapter that has not implemented a
 * method cannot accidentally appear to work.
 */
export abstract class BasePaymentProvider implements PaymentProvider {
  abstract readonly kind: ProviderKind;
  abstract getCapabilities(): PaymentProviderCapabilities;

  protected unsupported(capability: string): never {
    throw new UnsupportedCapabilityError(this.kind, capability);
  }

  // Each of these is async so an unimplemented capability surfaces as a
  // rejected promise on the same code path a real provider error would take.
  async createCheckout(_input: CreateCheckoutInput): Promise<CheckoutResult> {
    return this.unsupported("createCheckout");
  }
  async verifyPayment(_reference: string): Promise<PaymentResult> {
    return this.unsupported("verifyPayment");
  }
  async chargePaymentMethod(_input: ChargePaymentMethodInput): Promise<PaymentResult> {
    return this.unsupported("recurringCard");
  }
  async createPaymentLink(_input: CreatePaymentLinkInput): Promise<PaymentLinkResult> {
    return this.unsupported("paymentLinks");
  }
  async createCustomer(_input: CreateProviderCustomerInput): Promise<ProviderCustomerResult> {
    return this.unsupported("createCustomer");
  }
  async refundPayment(_input: RefundPaymentInput): Promise<RefundResult> {
    return this.unsupported("refunds");
  }
  async verifyWebhook(_request: WebhookRequest): Promise<WebhookVerificationResult> {
    return this.unsupported("verifyWebhook");
  }
  async normalizeWebhook(_payload: unknown): Promise<NormalizedPaymentEvent> {
    return this.unsupported("normalizeWebhook");
  }
  async testCredentials(): Promise<{ ok: boolean; message: string }> {
    return this.unsupported("testCredentials");
  }
}

/**
 * Capability guard used by the billing engine. Call this before invoking an
 * operation so the failure is a clear 400 rather than an adapter-level throw.
 */
export function requireCapability(
  provider: PaymentProvider,
  capability: keyof PaymentProviderCapabilities
): void {
  const capabilities = provider.getCapabilities();
  const value = capabilities[capability];
  const supported = Array.isArray(value) ? value.length > 0 : Boolean(value);
  if (!supported) {
    throw new UnsupportedCapabilityError(provider.kind, String(capability));
  }
}

export function supportsMethod(
  provider: PaymentProvider,
  method: import("./types").ProviderPaymentMethodType
): boolean {
  return provider.getCapabilities().supportedMethods.includes(method);
}
