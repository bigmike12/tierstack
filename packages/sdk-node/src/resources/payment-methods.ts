import type { TierstackHttpClient } from "../client";

export interface PaymentMethod {
  id: string;
  type: string;
  provider: string;
  status: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  bankName: string | null;
  isDefault: boolean;
  createdAt: string;
}

export class PaymentMethodsResource {
  constructor(private readonly http: TierstackHttpClient) {}

  list(params: { customerId: string }): Promise<PaymentMethod[]> {
    return this.http.request("GET", "/v1/payment-methods", { query: params });
  }

  /** Detaches the method. Any subscription pointed at it falls back to selecting one at charge time. */
  delete(paymentMethodId: string): Promise<{ detached: true }> {
    return this.http.request("DELETE", `/v1/payment-methods/${encodeURIComponent(paymentMethodId)}`);
  }
}
