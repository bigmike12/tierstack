import type { TransactionClient } from "@tierstack/database";
import {
  decryptCredentials,
  routePayment,
  requireRoute,
  type PaymentProvider,
  type ProviderKind,
  type ProviderPaymentMethodType,
  type RoutableProvider,
  type RoutingRequest,
} from "@tierstack/payments-core";
import { MockPaymentProvider, RedisMockStore, type RedisLike } from "@tierstack/payments-mock";
import { PaystackPaymentProvider } from "@tierstack/payments-paystack";
import { BillingError, loadBranding, type CurrencyCode } from "@tierstack/shared";

export interface ProviderFactoryDeps {
  redis: RedisLike;
  /** Base URL the simulated hosted checkout is served from. */
  checkoutBaseUrl?: string;
  encryptionKey?: string;
}

export interface StoredProviderConfig {
  id: string;
  organizationId: string;
  provider: ProviderKind;
  environment: "TEST" | "LIVE";
  encryptedCredentials: string;
  enabled: boolean;
  isDefault: boolean;
  priority: number;
  routingRules: unknown;
}

/**
 * Turns a stored, encrypted provider configuration into a live adapter.
 *
 * Mock and Paystack are built. Monnify and Flutterwave are not written yet;
 * asking for one here fails with an explicit error rather than returning
 * something that pretends to work.
 */
export function instantiateProvider(
  config: StoredProviderConfig,
  deps: ProviderFactoryDeps
): PaymentProvider {
  const credentials = decryptCredentials<Record<string, string>>(
    config.encryptedCredentials,
    config.organizationId,
    deps.encryptionKey
  );

  switch (config.provider) {
    case "MOCK":
      return new MockPaymentProvider({
        store: new RedisMockStore(deps.redis),
        organizationId: config.organizationId,
        webhookSecret: credentials.webhookSecret ?? "whsec_mock",
        checkoutBaseUrl: deps.checkoutBaseUrl ?? loadBranding().apiUrl,
      });
    case "PAYSTACK": {
      const secretKey = credentials.secretKey ?? credentials.secret_key;
      if (!secretKey) {
        throw new BillingError(
          "PROVIDER_ERROR",
          "The Paystack configuration has no secretKey. Add it in the dashboard; " +
            "Paystack signs webhooks with the same key, so nothing can be verified without it."
        );
      }
      // Paystack has no separate test host: the key itself selects the mode, so
      // a sk_test_ key in a LIVE configuration is a misconfiguration worth
      // catching here rather than on the first real charge.
      if (config.environment === "LIVE" && secretKey.startsWith("sk_test_")) {
        throw new BillingError(
          "PROVIDER_ERROR",
          "A Paystack test key is configured against the LIVE environment."
        );
      }
      return new PaystackPaymentProvider({
        secretKey,
        ...(credentials.publicKey ? { publicKey: credentials.publicKey } : {}),
        ...(credentials.baseUrl ? { baseUrl: credentials.baseUrl } : {}),
      });
    }
    case "MONNIFY":
    case "FLUTTERWAVE":
      throw new BillingError(
        "NOT_IMPLEMENTED",
        `The ${config.provider} adapter is not written yet. ` +
          "Configure MOCK for local development, or PAYSTACK for a real rail."
      );
  }
}

export interface ResolveProviderParams {
  organizationId: string;
  environment: "TEST" | "LIVE";
  currency: CurrencyCode;
  country?: string | null;
  method?: ProviderPaymentMethodType;
  pinnedProvider?: ProviderKind | null;
  lastSuccessfulProvider?: ProviderKind | null;
}

export interface ResolvedProvider {
  config: StoredProviderConfig;
  provider: PaymentProvider;
}

/**
 * Loads the organization's configured rails, applies routing, and returns the
 * ordered list of adapters the engine may attempt.
 */
export async function resolveProviders(
  tx: TransactionClient,
  params: ResolveProviderParams,
  deps: ProviderFactoryDeps
): Promise<ResolvedProvider[]> {
  const configs = await tx.paymentProviderConfig.findMany({
    where: { organizationId: params.organizationId, environment: params.environment },
    orderBy: { priority: "asc" },
  });

  if (configs.length === 0) {
    throw new BillingError(
      "NO_PAYMENT_PROVIDER_CONFIGURED",
      "This organization has no payment provider configured for this environment. " +
        "Add one in the dashboard, or configure the MOCK provider for local development."
    );
  }

  const routable: RoutableProvider[] = [];
  const buildErrors: { kind: ProviderKind; reason: string }[] = [];

  for (const config of configs) {
    const stored: StoredProviderConfig = {
      id: config.id,
      organizationId: config.organizationId,
      provider: config.provider as ProviderKind,
      environment: config.environment as "TEST" | "LIVE",
      encryptedCredentials: config.encryptedCredentials,
      enabled: config.enabled,
      isDefault: config.isDefault,
      priority: config.priority,
      routingRules: config.routingRules,
    };
    try {
      routable.push({
        kind: stored.provider,
        provider: instantiateProvider(stored, deps),
        enabled: stored.enabled,
        isDefault: stored.isDefault,
        priority: stored.priority,
        routingRules: (stored.routingRules ?? null) as RoutableProvider["routingRules"],
      });
    } catch (error) {
      buildErrors.push({
        kind: stored.provider,
        reason: error instanceof Error ? error.message : "Adapter could not be constructed.",
      });
    }
  }

  const request: RoutingRequest = {
    currency: params.currency,
    country: params.country ?? null,
    method: params.method,
    pinnedProvider: params.pinnedProvider ?? null,
    lastSuccessfulProvider: params.lastSuccessfulProvider ?? null,
  };

  const decision = routePayment(routable, request);
  decision.rejected.push(...buildErrors);
  requireRoute(decision, request);

  const byKind = new Map(configs.map((c) => [c.provider as ProviderKind, c]));
  return decision.candidates.map((candidate) => {
    const config = byKind.get(candidate.kind)!;
    return {
      config: {
        id: config.id,
        organizationId: config.organizationId,
        provider: candidate.kind,
        environment: config.environment as "TEST" | "LIVE",
        encryptedCredentials: config.encryptedCredentials,
        enabled: config.enabled,
        isDefault: config.isDefault,
        priority: config.priority,
        routingRules: config.routingRules,
      },
      provider: candidate.provider,
    };
  });
}
