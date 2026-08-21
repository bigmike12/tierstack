export interface Organization {
  id: string;
  name: string;
  slug: string;
  role?: "OWNER" | "ADMIN" | "MEMBER";
}

export interface Session {
  actor: "user" | "api_key";
  user?: { id: string; email: string };
  organizations: Organization[];
}

export interface BillingSettings {
  id: string;
  gracePeriodDays: number;
  maxRetryAttempts: number;
  retryIntervals: number[];
  accessDuringGracePeriod: "FULL_ACCESS" | "RESTRICTED_ACCESS" | "NO_ACCESS";
  failureAction: "MARK_UNPAID" | "CANCEL" | "PAUSE";
  invoiceDueDays: number;
  incompleteExpiryHours: number;
  defaultCurrency: string;
  autoCollect: boolean;
}

export interface OverviewMetrics {
  windowDays: number;
  mrr: { currency: string; amount: number }[];
  subscriptions: {
    active: number;
    trialing: number;
    gracePeriod: number;
    incomplete: number;
    canceledInWindow: number;
  };
  customers: { total: number; new: number };
  revenue: { currency: string; amount: number; invoices: number }[];
  outstanding: { currency: string; amount: number; invoices: number }[];
  failedPayments: number;
  paymentSuccessRate: number | null;
  churnRate: number | null;
}

export interface Customer {
  id: string;
  externalId: string | null;
  email: string;
  name: string | null;
  phone: string | null;
  currency: string | null;
  country: string | null;
  createdAt: string;
  subscriptions?: Subscription[];
  invoices?: Invoice[];
  paymentMethods?: PaymentMethod[];
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  features: Record<string, unknown>;
  prices?: Price[];
}

export interface Price {
  id: string;
  code: string;
  nickname: string | null;
  model: "FLAT_RECURRING" | "PER_SEAT" | "USAGE_METERED" | "HYBRID";
  currency: string;
  unitAmount: number | null;
  intervalUnit: "DAY" | "WEEK" | "MONTH" | "YEAR";
  intervalCount: number;
  trialDays: number | null;
  active: boolean;
  plan?: { id: string; code: string; name: string };
}

export type SubscriptionStatus =
  | "INCOMPLETE"
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "GRACE_PERIOD"
  | "PAUSED"
  | "UNPAID"
  | "CANCELED"
  | "EXPIRED";

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  quantity: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  gracePeriodStart: string | null;
  gracePeriodEnd: string | null;
  gracePolicy: { gracePeriodDays?: number; failureAction?: string; accessDuringGracePeriod?: string } | null;
  createdAt: string;
  price: Price & { plan: Plan };
  customer?: { id: string; externalId: string | null; email: string; name: string | null };
  paymentMethod?: PaymentMethod | null;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  status: "DRAFT" | "OPEN" | "PAID" | "VOID" | "UNCOLLECTIBLE";
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
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string;
  lineItems?: InvoiceLineItem[];
  attempts?: PaymentAttempt[];
  customer?: { id: string; externalId: string | null; email: string; name: string | null };
  subscription?: { id: string; status: string } | null;
}

export interface InvoiceLineItem {
  id: string;
  type: string;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface PaymentAttempt {
  id: string;
  invoiceId: string;
  customerId: string;
  provider: string;
  amount: number;
  currency: string;
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  attemptNumber: number;
  failureCode: string | null;
  failureReason: string | null;
  providerReference: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface PaymentMethod {
  id: string;
  type: string;
  provider: string;
  status?: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  bankName: string | null;
  isDefault: boolean;
  createdAt?: string;
}

export interface ProviderConfig {
  id: string;
  provider: "PAYSTACK" | "MONNIFY" | "FLUTTERWAVE" | "MOCK";
  environment: "TEST" | "LIVE";
  enabled: boolean;
  isDefault: boolean;
  priority: number;
  routingRules: unknown;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  capabilities: Record<string, unknown> | null;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  type: "PUBLIC" | "SECRET";
  environment: "TEST" | "LIVE";
  prefix: string;
  permissions: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface Member {
  id: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  invitedAt: string;
  acceptedAt: string | null;
  user: { id: string; email: string; name: string };
}

export interface SubscriptionTransition {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
