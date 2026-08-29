import { TierstackHttpClient, type TierstackClientOptions } from "./client";
import { CustomersResource } from "./resources/customers";
import { InvoicesResource } from "./resources/invoices";
import { PaymentAttemptsResource } from "./resources/payment-attempts";
import { PaymentMethodsResource } from "./resources/payment-methods";
import { PlansResource } from "./resources/plans";
import { PricesResource } from "./resources/prices";
import { SubscriptionsResource } from "./resources/subscriptions";

export { TierstackError } from "./errors";
export type { ListParams, Page, RequestOptions } from "./types";
export type { TierstackClientOptions } from "./client";

export * from "./resources/customers";
export * from "./resources/payment-methods";
export * from "./resources/plans";
export * from "./resources/prices";
export * from "./resources/subscriptions";
export * from "./resources/invoices";
export * from "./resources/payment-attempts";

/**
 * ```ts
 * const tierstack = new Tierstack({
 *   apiKey: process.env.TIERSTACK_API_KEY!,
 *   baseUrl: "https://api.gettierstack.com",
 * });
 *
 * const sub = await tierstack.subscriptions.create({
 *   customer: { email: "ada@example.com" },
 *   priceId: "price_starter_monthly",
 * });
 * ```
 *
 * Every method returns the response's `data` directly, or throws
 * `TierstackError` — there is no envelope to unwrap and no result to check
 * for an `error` field.
 */
export class Tierstack {
  readonly customers: CustomersResource;
  readonly paymentMethods: PaymentMethodsResource;
  readonly plans: PlansResource;
  readonly prices: PricesResource;
  readonly subscriptions: SubscriptionsResource;
  readonly invoices: InvoicesResource;
  readonly paymentAttempts: PaymentAttemptsResource;

  constructor(options: TierstackClientOptions) {
    const http = new TierstackHttpClient(options);
    this.customers = new CustomersResource(http);
    this.paymentMethods = new PaymentMethodsResource(http);
    this.plans = new PlansResource(http);
    this.prices = new PricesResource(http);
    this.subscriptions = new SubscriptionsResource(http);
    this.invoices = new InvoicesResource(http);
    this.paymentAttempts = new PaymentAttemptsResource(http);
  }
}
