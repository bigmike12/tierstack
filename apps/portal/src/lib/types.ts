export interface PortalPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
}

export interface PortalPrice {
  id: string;
  code: string;
  nickname: string | null;
  model: string;
  currency: string;
  unitAmount: number | null;
  intervalUnit: "DAY" | "WEEK" | "MONTH" | "YEAR";
  intervalCount: number;
  plan: PortalPlan;
}

export interface PortalSubscription {
  id: string;
  status:
    | "INCOMPLETE"
    | "TRIALING"
    | "ACTIVE"
    | "PAST_DUE"
    | "GRACE_PERIOD"
    | "PAUSED"
    | "UNPAID"
    | "CANCELED"
    | "EXPIRED";
  quantity: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  gracePeriodEnd: string | null;
  price: PortalPrice;
}

export interface PortalInvoice {
  id: string;
  invoiceNumber: string;
  status: "DRAFT" | "OPEN" | "PAID" | "VOID" | "UNCOLLECTIBLE";
  currency: string;
  total: number;
  amountDue: number;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  finalizedAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface PortalPaymentMethod {
  id: string;
  type: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
}

export interface PortalOverview {
  merchant: { name: string; supportEmail: string | null };
  customer: { id: string; externalId: string | null; email: string; name: string | null; country: string | null } | null;
  subscriptions: PortalSubscription[];
  invoices: PortalInvoice[];
  paymentMethods: PortalPaymentMethod[];
  returnUrl: string | null;
  expiresAt: string | null;
}
