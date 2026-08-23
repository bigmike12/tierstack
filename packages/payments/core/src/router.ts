import { BillingError, type CurrencyCode } from "@tierbase/shared";
import type { PaymentProvider } from "./provider";
import type { ProviderKind, ProviderPaymentMethodType } from "./types";

export interface RoutableProvider {
  kind: ProviderKind;
  provider: PaymentProvider;
  enabled: boolean;
  isDefault: boolean;
  /** Lower sorts first. */
  priority: number;
  routingRules?: {
    currencies?: string[];
    countries?: string[];
    methods?: ProviderPaymentMethodType[];
  } | null;
  /** Rolling health signal maintained from recent payment attempts. */
  healthy?: boolean;
}

export interface RoutingRequest {
  currency: CurrencyCode;
  country?: string | null;
  method?: ProviderPaymentMethodType;
  /**
   * Set when charging an already-tokenized payment method. Routing is then
   * pinned: a stored Paystack authorization is meaningless to Flutterwave, so
   * failing over would silently invalidate the customer's payment method.
   */
  pinnedProvider?: ProviderKind | null;
  /** Provider that last succeeded for this customer, preferred when eligible. */
  lastSuccessfulProvider?: ProviderKind | null;
}

export interface RoutingDecision {
  /** Ordered candidates. The engine tries them in sequence. */
  candidates: RoutableProvider[];
  /** Why each excluded provider was excluded — surfaced in the dashboard. */
  rejected: { kind: ProviderKind; reason: string }[];
}

/**
 * Chooses which rails to attempt, in order. Routing never widens what a
 * provider can do: a candidate is only eligible if its declared capabilities
 * cover the requested payment method and currency.
 */
export function routePayment(
  providers: readonly RoutableProvider[],
  request: RoutingRequest
): RoutingDecision {
  const rejected: { kind: ProviderKind; reason: string }[] = [];
  const eligible: RoutableProvider[] = [];

  /**
   * Falling over from one real rail to another is the point of routing. Falling
   * over to the mock rail is not: it moves no money, so a Paystack outage would
   * "collect" the payment, mark the invoice PAID and grant the customer service
   * they never paid for. A real failure is always better than a fake success.
   *
   * So the mock rail is eligible only when it is the only rail there is — which
   * is exactly the local-development case it exists for.
   */
  const hasRealRail = providers.some((p) => p.enabled && p.kind !== "MOCK");

  for (const candidate of providers) {
    if (candidate.kind === "MOCK" && hasRealRail) {
      rejected.push({
        kind: candidate.kind,
        reason:
          "The mock rail is never used while a real provider is configured — it would " +
          "report a payment that never happened.",
      });
      continue;
    }

    const reason = ineligibilityReason(candidate, request);
    if (reason) {
      rejected.push({ kind: candidate.kind, reason });
      continue;
    }
    eligible.push(candidate);
  }

  eligible.sort((a, b) => {
    const score = (p: RoutableProvider) => {
      let value = p.priority;
      if (request.pinnedProvider && p.kind === request.pinnedProvider) value -= 10_000;
      if (request.lastSuccessfulProvider && p.kind === request.lastSuccessfulProvider) value -= 1_000;
      if (p.isDefault) value -= 100;
      if (p.healthy === false) value += 5_000;
      return value;
    };
    return score(a) - score(b);
  });

  return { candidates: eligible, rejected };
}

function ineligibilityReason(
  candidate: RoutableProvider,
  request: RoutingRequest
): string | null {
  if (!candidate.enabled) return "Provider is disabled for this organization.";

  if (request.pinnedProvider && candidate.kind !== request.pinnedProvider) {
    return `Payment method is held by ${request.pinnedProvider} and cannot be charged elsewhere.`;
  }

  const capabilities = candidate.provider.getCapabilities();

  if (
    capabilities.supportedCurrencies.length > 0 &&
    !capabilities.supportedCurrencies.includes(request.currency)
  ) {
    return `Provider does not settle ${request.currency}.`;
  }

  if (request.method && !capabilities.supportedMethods.includes(request.method)) {
    return `Provider does not support ${request.method} payments.`;
  }

  const rules = candidate.routingRules;
  if (rules?.currencies?.length && !rules.currencies.includes(request.currency)) {
    return `Organization routing rules exclude ${request.currency} for this provider.`;
  }
  if (rules?.countries?.length && request.country && !rules.countries.includes(request.country)) {
    return `Organization routing rules exclude country ${request.country} for this provider.`;
  }
  if (rules?.methods?.length && request.method && !rules.methods.includes(request.method)) {
    return `Organization routing rules exclude ${request.method} for this provider.`;
  }

  return null;
}

/** Throws a descriptive error when nothing can serve the request. */
export function requireRoute(decision: RoutingDecision, request: RoutingRequest): RoutableProvider {
  const first = decision.candidates[0];
  if (first) return first;
  throw new BillingError(
    "NO_ELIGIBLE_PAYMENT_PROVIDER",
    `No configured payment provider can collect ${request.method ?? "a payment"} in ${request.currency}.`,
    { rejected: decision.rejected }
  );
}
