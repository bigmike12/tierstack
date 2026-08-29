import type { TierstackHttpClient } from "../client";
import type { ListParams, Page, RequestOptions } from "../types";

export interface Customer {
  id: string;
  organizationId: string;
  externalId: string | null;
  email: string;
  name: string | null;
  phone: string | null;
  currency: string | null;
  country: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateCustomerParams {
  /** Your own user id. Optional, but strongly recommended — it's how you'll look this customer up again. */
  externalId?: string;
  email: string;
  name?: string;
  phone?: string;
  currency?: string;
  country?: string;
  metadata?: Record<string, unknown>;
}

export type UpdateCustomerParams = Partial<Omit<CreateCustomerParams, "externalId">>;

export interface ListCustomersParams extends ListParams {
  email?: string;
  externalId?: string;
}

export class CustomersResource {
  constructor(private readonly http: TierstackHttpClient) {}

  /** Idempotent on `externalId`: calling this again with the same one updates the contact details rather than creating a duplicate. */
  create(params: CreateCustomerParams, options?: RequestOptions): Promise<Customer> {
    return this.http.request("POST", "/v1/customers", { body: params, options });
  }

  list(params: ListCustomersParams = {}): Promise<Page<Customer>> {
    return this.http.request("GET", "/v1/customers", { query: params });
  }

  /** Accepts either the platform id (`cus_...`) or your own `externalId`. */
  retrieve(customerId: string): Promise<Customer> {
    return this.http.request("GET", `/v1/customers/${encodeURIComponent(customerId)}`);
  }

  update(customerId: string, params: UpdateCustomerParams): Promise<Customer> {
    return this.http.request("PATCH", `/v1/customers/${encodeURIComponent(customerId)}`, { body: params });
  }

  /** Soft delete. Refuses if the customer has a live subscription. */
  delete(customerId: string): Promise<{ deleted: true }> {
    return this.http.request("DELETE", `/v1/customers/${encodeURIComponent(customerId)}`);
  }
}
