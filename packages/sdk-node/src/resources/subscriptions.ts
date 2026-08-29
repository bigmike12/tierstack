import type { TierstackHttpClient } from "../client";
import type { ListParams, Page, RequestOptions } from "../types";
import type { CreateCustomerParams } from "./customers";

export type SubscriptionStatus =
  | "INCOMPLETE"
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "GRACE_PERIOD"
  | "UNPAID"
  | "PAUSED"
  | "CANCELED"
  | "EXPIRED";

export interface Subscription {
  id: string;
  organizationId: string;
  customerId: string;
  priceId: string;
  status: SubscriptionStatus;
  quantity: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  billingAnchorDay: number | null;
  trialStart: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  endedAt: string | null;
  pausedAt: string | null;
  gracePeriodStart: string | null;
  gracePeriodEnd: string | null;
  paymentMethodId: string | null;
  pricePinned: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSubscriptionParams {
  /** Either this or `customer` — not both. */
  customerId?: string;
  /** Resolved find-or-create by `externalId`, same as calling `customers.create` first. */
  customer?: CreateCustomerParams;
  priceId: string;
  quantity?: number;
  trialDays?: number;
  paymentMethodId?: string;
  /** Defaults to the organization's `autoCollect` setting. */
  collectPayment?: boolean;
  /** Where the customer returns after a hosted checkout. */
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export type PaymentAttemptStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELED";

/** What collecting a payment actually did — returned from any call that may trigger a charge. */
export interface PaymentAttemptSummary {
  attemptId: string;
  status: PaymentAttemptStatus;
  provider: string;
  reference: string;
  providerReference: string | null;
  /** Present when the customer must complete payment on a hosted page. */
  checkoutUrl?: string | null;
  amount: number;
  currency: string;
  invoiceStatus: string;
  subscriptionStatus?: SubscriptionStatus;
  failureCode?: string;
  failureReason?: string;
}

export interface CreateSubscriptionResult {
  subscription: Subscription;
  invoiceId: string | null;
  amountDue: number;
  currency: string;
  payment: PaymentAttemptSummary | null;
}

export interface ListSubscriptionsParams extends ListParams {
  customerId?: string;
  status?: SubscriptionStatus;
  priceId?: string;
}

export interface ChangePlanParams {
  priceId: string;
  quantity?: number;
  /** Defaults to the plan-change policy configured for the organization. */
  timing?: "IMMEDIATE" | "NEXT_PERIOD";
  /** Collect the prorated difference immediately, if any is owed. Defaults to true. */
  collectPayment?: boolean;
}

export interface ChangePlanResult {
  applied: boolean;
  invoiceId: string | null;
  netAmount: number;
  payment: unknown | null;
  subscription: Subscription;
}

export interface RenewParams {
  /** Attempt collection on the new invoice immediately. Defaults to true. */
  collectPayment?: boolean;
  metadata?: Record<string, unknown>;
}

export interface RenewResult {
  renewed: boolean;
  invoiceId: string | null;
  payment: unknown | null;
  subscription: Subscription;
}

export interface SubscriptionTransition {
  id: string;
  subscriptionId: string;
  /** `null` on a subscription's very first transition — there is no "from" yet. */
  fromStatus: SubscriptionStatus | null;
  toStatus: SubscriptionStatus;
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export class SubscriptionsResource {
  constructor(private readonly http: TierstackHttpClient) {}

  /** The one call most integrations need: resolves the customer, opens the subscription, issues the first invoice and — unless told otherwise — starts collection. */
  create(params: CreateSubscriptionParams, options?: RequestOptions): Promise<CreateSubscriptionResult> {
    return this.http.request("POST", "/v1/subscriptions", { body: params, options });
  }

  list(params: ListSubscriptionsParams = {}): Promise<Page<Subscription>> {
    return this.http.request("GET", "/v1/subscriptions", { query: params });
  }

  retrieve(subscriptionId: string): Promise<Subscription> {
    return this.http.request("GET", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
  }

  changePlan(
    subscriptionId: string,
    params: ChangePlanParams,
    options?: RequestOptions
  ): Promise<ChangePlanResult> {
    return this.http.request("POST", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/change-plan`, {
      body: params,
      options,
    });
  }

  changeQuantity(
    subscriptionId: string,
    params: { quantity: number }
  ): Promise<{ subscription: Subscription }> {
    return this.http.request("POST", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/quantity`, {
      body: params,
    });
  }

  /** Hold the subscription on its current price version, or release it back to following the plan's current price. */
  pinPrice(subscriptionId: string, params: { pinned: boolean }): Promise<Subscription> {
    return this.http.request("POST", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/pin-price`, {
      body: params,
    });
  }

  cancel(subscriptionId: string, params: { atPeriodEnd?: boolean } = {}): Promise<Subscription> {
    return this.http.request("POST", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
      body: params,
    });
  }

  /** Reverses a cancellation scheduled with `atPeriodEnd: true`, before the period actually ends. */
  resume(subscriptionId: string): Promise<Subscription> {
    return this.http.request("POST", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/resume`);
  }

  pause(subscriptionId: string): Promise<Subscription> {
    return this.http.request("POST", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/pause`);
  }

  /** Advances the subscription into its next billing period and issues that invoice — the same call the renewal schedule makes automatically. */
  renew(subscriptionId: string, params: RenewParams = {}, options?: RequestOptions): Promise<RenewResult> {
    return this.http.request("POST", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/renew`, {
      body: params,
      options,
    });
  }

  listTransitions(subscriptionId: string): Promise<SubscriptionTransition[]> {
    return this.http.request("GET", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/transitions`);
  }
}
