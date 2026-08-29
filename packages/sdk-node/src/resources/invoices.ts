import type { TierstackHttpClient } from "../client";
import type { ListParams, Page, RequestOptions } from "../types";
import type { PaymentAttemptSummary } from "./subscriptions";

export type InvoiceStatus = "DRAFT" | "OPEN" | "PAID" | "VOID" | "UNCOLLECTIBLE";

export interface InvoiceLineItem {
  id: string;
  type: string;
  description: string;
  quantity: number;
  /** Minor units. Negative for credits and discounts. */
  unitAmount: number;
  amount: number;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface Invoice {
  id: string;
  organizationId: string;
  customerId: string;
  subscriptionId: string | null;
  invoiceNumber: string;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  discountAmount: number;
  creditAmount: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  finalizedAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  dunningAttempts: number;
  nextRetryAt: string | null;
  createdAt: string;
  /** Present only on `retrieve` — the list endpoint omits both for row size. */
  lineItems?: InvoiceLineItem[];
  attempts?: PaymentAttempt[];
}

export interface PaymentAttempt {
  id: string;
  invoiceId: string;
  customerId: string;
  provider: string;
  amount: number;
  currency: string;
  status: string;
  attemptNumber: number;
  failureCode: string | null;
  failureReason: string | null;
  providerReference: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ListInvoicesParams extends ListParams {
  customerId?: string;
  subscriptionId?: string;
  status?: InvoiceStatus;
}

export interface PayInvoiceParams {
  /** Charge a specific stored method rather than the customer's default. */
  paymentMethodId?: string;
  /** Where the customer returns after a hosted checkout, if one is opened. */
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export class InvoicesResource {
  constructor(private readonly http: TierstackHttpClient) {}

  list(params: ListInvoicesParams = {}): Promise<Page<Invoice>> {
    return this.http.request("GET", "/v1/invoices", { query: params });
  }

  /** Includes line items and every payment attempt made against it. */
  retrieve(invoiceId: string): Promise<Invoice> {
    return this.http.request("GET", `/v1/invoices/${encodeURIComponent(invoiceId)}`);
  }

  /** Collect, or retry collecting, an open invoice. Every call creates a new attempt — previous ones are never overwritten. */
  pay(
    invoiceId: string,
    params: PayInvoiceParams = {},
    options?: RequestOptions
  ): Promise<PaymentAttemptSummary> {
    return this.http.request("POST", `/v1/invoices/${encodeURIComponent(invoiceId)}/pay`, {
      body: params,
      options,
    });
  }

  void(invoiceId: string): Promise<Invoice> {
    return this.http.request("POST", `/v1/invoices/${encodeURIComponent(invoiceId)}/void`);
  }
}
