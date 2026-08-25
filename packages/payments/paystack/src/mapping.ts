import {
  BillingError,
  assertCurrency,
  minorUnits,
  money,
  type CurrencyCode,
  type Money,
} from "@tierstack/shared";
import type {
  NormalizedEventType,
  PaymentStatus,
  ProviderPaymentMethodType,
  TokenizedPaymentMethod,
} from "@tierstack/payments-core";

/**
 * Paystack quotes amounts in the currency's subunit — kobo for NGN, pesewas for
 * GHS, cents for USD/ZAR/KES — which is the same integer this platform stores.
 * That equivalence is asserted rather than assumed: if a currency with a
 * different number of decimal places is ever enabled, this throws instead of
 * silently sending an amount that is off by a factor of ten.
 */
export function toPaystackAmount(amount: Money): number {
  if (minorUnits(amount.currency) !== 2) {
    throw new BillingError(
      "UNSUPPORTED_CURRENCY",
      `Paystack subunit handling is only verified for two-decimal currencies; ${amount.currency} has ${minorUnits(
        amount.currency
      )}.`
    );
  }
  return amount.amount;
}

export function fromPaystackAmount(raw: unknown, currency: string): Money {
  const code = assertCurrency(currency);
  const value = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isInteger(value)) {
    throw new BillingError("PROVIDER_ERROR", `Paystack returned a non-integer amount: ${String(raw)}.`);
  }
  return money(value, code);
}

/**
 * Paystack transaction states, mapped onto the platform's own.
 *
 * `abandoned` is deliberately PENDING, not FAILED: the customer opened a
 * checkout and walked away, which is a different fact from a declined card and
 * leads to a different subscription state.
 */
export function toPaymentStatus(raw: unknown): PaymentStatus {
  switch (String(raw ?? "").toLowerCase()) {
    case "success":
      return "SUCCEEDED";
    case "failed":
    case "reversed":
      return "FAILED";
    case "abandoned":
    case "ongoing":
    case "pending":
    case "processing":
    case "queued":
    case "send_otp":
    case "send_pin":
    case "open_url":
    case "pay_offline":
      return "PENDING";
    default:
      // An unrecognised state must never be read as success.
      return "PENDING";
  }
}

const CHANNEL_TO_METHOD: Record<string, ProviderPaymentMethodType> = {
  card: "CARD",
  bank: "BANK_ACCOUNT",
  bank_transfer: "BANK_TRANSFER",
  dedicated_nuban: "BANK_TRANSFER",
  ussd: "USSD",
  mobile_money: "MOBILE_MONEY",
  qr: "BANK_TRANSFER",
  eft: "BANK_TRANSFER",
};

export function toPaymentMethodType(channel: unknown): ProviderPaymentMethodType {
  return CHANNEL_TO_METHOD[String(channel ?? "").toLowerCase()] ?? "CARD";
}

const METHOD_TO_CHANNEL: Partial<Record<ProviderPaymentMethodType, string>> = {
  CARD: "card",
  BANK_ACCOUNT: "bank",
  BANK_TRANSFER: "bank_transfer",
  USSD: "ussd",
  MOBILE_MONEY: "mobile_money",
};

/** Only methods Paystack actually offers as a channel are passed through. */
export function toChannels(methods: ProviderPaymentMethodType[] | undefined): string[] | undefined {
  if (!methods || methods.length === 0) return undefined;
  const channels = methods.map((method) => METHOD_TO_CHANNEL[method]).filter((c): c is string => Boolean(c));
  return channels.length > 0 ? channels : undefined;
}

/**
 * The authorization block, reduced to what may be stored.
 *
 * Paystack's `authorization_code` is the reusable handle — the thing that lets a
 * renewal charge without the customer present. Everything else kept here (brand,
 * last four, expiry, bank) is display metadata. No PAN, no CVV, no full bank
 * credentials pass through this function, because none of them may be stored.
 */
export function toTokenizedMethod(
  authorization: unknown,
  customerCode: string | null
): TokenizedPaymentMethod | undefined {
  if (!authorization || typeof authorization !== "object") return undefined;
  const auth = authorization as Record<string, unknown>;

  const code = typeof auth.authorization_code === "string" ? auth.authorization_code : null;
  if (!code) return undefined;

  // `reusable: false` means Paystack will not let this handle be charged again.
  // Storing it would produce a payment method that fails on every renewal.
  if (auth.reusable === false) return undefined;

  const expMonth = Number.parseInt(String(auth.exp_month ?? ""), 10);
  const expYear = Number.parseInt(String(auth.exp_year ?? ""), 10);

  return {
    type: toPaymentMethodType(auth.channel),
    providerPaymentMethodRef: code,
    providerCustomerRef: customerCode,
    ...(typeof auth.card_type === "string" && auth.card_type ? { brand: auth.card_type } : {}),
    ...(typeof auth.last4 === "string" && auth.last4 ? { last4: auth.last4 } : {}),
    ...(Number.isInteger(expMonth) ? { expMonth } : {}),
    ...(Number.isInteger(expYear) ? { expYear } : {}),
    ...(typeof auth.bank === "string" && auth.bank ? { bankName: auth.bank } : {}),
  };
}

/**
 * Paystack event names, mapped onto the normalized set.
 *
 * Anything unrecognised becomes UNKNOWN and is acknowledged without touching
 * billing state — an event this platform does not understand must not be
 * guessed at, and must not be retried forever by the provider either.
 */
export function toEventType(event: unknown): NormalizedEventType {
  switch (String(event ?? "")) {
    case "charge.success":
      return "PAYMENT_SUCCEEDED";
    case "charge.failed":
    case "invoice.payment_failed":
      return "PAYMENT_FAILED";
    case "charge.pending":
    case "paymentrequest.pending":
      return "PAYMENT_PENDING";
    case "refund.processed":
      return "REFUND_SUCCEEDED";
    default:
      return "UNKNOWN";
  }
}

export function parsePaidAt(raw: unknown): Date | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export const PAYSTACK_CURRENCIES: CurrencyCode[] = ["NGN", "GHS", "ZAR", "USD", "KES"];

/**
 * Paystack restricts a transaction reference to alphanumerics plus `-`, `.`
 * and `=`. This platform's ids are `prefix_random`, and that underscore is
 * rejected outright — `POST /transaction/initialize` fails before a customer
 * ever sees a checkout page.
 *
 * The id alphabet is strictly alphanumeric and the prefix separator is the only
 * underscore, so swapping it for a dash is a clean bijection: `pay_a1b2` becomes
 * `pay-a1b2` on the way out and converts straight back on the way in. Nothing
 * outside this adapter ever sees the Paystack form — `PaymentResult.reference`
 * and `NormalizedPaymentEvent.reference` are always the platform id, because a
 * reference the rest of the engine cannot look up is worse than no reference.
 */
export function toProviderReference(platformReference: string): string {
  return platformReference.replace("_", "-");
}

export function fromProviderReference(providerReference: string): string {
  return providerReference.replace("-", "_");
}
