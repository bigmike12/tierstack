import type { TierstackHttpClient } from "../client";
import type { ListParams, Page } from "../types";
import type { PaymentAttempt } from "./invoices";

export interface ListPaymentAttemptsParams extends ListParams {
  invoiceId?: string;
  customerId?: string;
}

export class PaymentAttemptsResource {
  constructor(private readonly http: TierstackHttpClient) {}

  /** Every attempt, with whatever the provider actually said about the failure. */
  list(params: ListPaymentAttemptsParams = {}): Promise<Page<PaymentAttempt>> {
    return this.http.request("GET", "/v1/payment-attempts", { query: params });
  }

  /**
   * Asks the provider directly what happened, instead of waiting on a webhook
   * that may never arrive for some decline shapes. Safe to call on an attempt
   * that already settled — it's returned as-is, nothing is re-verified.
   */
  sync(attemptId: string): Promise<PaymentAttempt> {
    return this.http.request("POST", `/v1/payment-attempts/${encodeURIComponent(attemptId)}/sync`);
  }
}
