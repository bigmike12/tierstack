export interface Organization {
  id: string;
  name: string;
  slug: string;
  role?: "OWNER" | "ADMIN" | "MEMBER";
}

export interface Session {
  actor: "user" | "api_key";
  user?: { id: string; email: string; name: string };
  organizations: Organization[];
  /** The org the request was actually scoped to — never assume array position. */
  currentOrganizationId?: string | null;
}

/**
 * The org a page should treat as "current". `organizations[0]` is plain
 * membership order and does not track which org the org switcher has
 * selected — this does, via `currentOrganizationId`, which the API resolves
 * from the same cookie every other request is scoped by.
 */
export function currentOrganization(session: Session): Organization | undefined {
  return (
    session.organizations.find((org) => org.id === session.currentOrganizationId) ??
    session.organizations[0]
  );
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
  notificationsEnabled: boolean;
  priceChangeNoticeDays: number;
  trialEndingNoticeDays: number;
  supportEmail: string | null;
  senderName: string | null;
  emailSender: string | null;
  invoiceNumberPrefix: string | null;
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

/**
 * The daily series behind the overview charts. Every array in here is exactly
 * `days.length` long and gap-filled with zeroes, so a chart can index straight
 * into it without checking whether a quiet day produced a row.
 */
export interface TimeseriesMetrics {
  windowDays: number;
  /** UTC dates, ascending, one per bucket: "2026-08-05". */
  days: string[];
  revenue: { currency: string; points: number[]; total: number; invoices: number }[];
  subscriptions: { created: number[]; canceled: number[] };
  customers: { created: number[] };
  payments: { succeeded: number[]; failed: number[] };
  /** The live book, one row per plan and currency. */
  plans: { planId: string; plan: string; currency: string; subscriptions: number; mrr: number }[];
  invoices: { status: string; count: number }[];
  topCustomers: { id: string; name: string | null; email: string; currency: string; amount: number }[];
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
  /** Position in a code lineage; 1 unless the price has been superseded. */
  version?: number;
  supersedesPriceId?: string | null;
  /** Set on USAGE_METERED and HYBRID prices only. */
  usageMeterId?: string | null;
  usageUnitAmount?: number | null;
  usageUnitSize?: number | null;
  includedUnits?: number | null;
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
  /** Held on its current price while others roll forward at renewal. */
  pricePinned?: boolean;
  customer?: { id: string; externalId: string | null; email: string; name: string | null };
  paymentMethod?: PaymentMethod | null;
}

export interface EmailMessage {
  id: string;
  type: string;
  toEmail: string;
  subject: string;
  status: "PENDING" | "SENT" | "FAILED" | "SUPPRESSED";
  provider: string | null;
  failureReason: string | null;
  attempts: number;
  sentAt: string | null;
  createdAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  /** How many collection attempts have failed on this invoice. */
  dunningAttempts?: number;
  /** When the ladder will try again. Null once it is paid or exhausted. */
  nextRetryAt?: string | null;
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

export interface UsageMeter {
  id: string;
  code: string;
  name: string;
  unitLabel: string | null;
  aggregation: "SUM" | "MAX" | "LAST" | "UNIQUE_COUNT";
  active: boolean;
  createdAt: string;
}

export interface UsageSnapshot {
  meterId: string;
  meterCode: string;
  meterName: string;
  unitLabel: string | null;
  aggregation: "SUM" | "MAX" | "LAST" | "UNIQUE_COUNT";
  used: number;
  included: number;
  remaining: number;
  overage: number;
  exhausted: boolean;
  overageBlocks: number;
  overageAmount: number | null;
  period: { start: string; end: string };
}

export interface UsageResponse {
  customerId: string;
  externalId: string | null;
  period: { start: string; end: string };
  /** Currency of the subscription the meters are priced in, when there is one. */
  currency?: string;
  meters: UsageSnapshot[];
}

export interface ResolvedFeature {
  featureKey: string;
  access: boolean;
  remainingQuota: number | null;
  reason: string;
  limit?: number | null;
  used?: number | null;
  restricted?: boolean;
}

export interface CustomerEntitlements {
  customerId: string;
  externalId: string | null;
  context: {
    subscriptionId: string | null;
    status: SubscriptionStatus | null;
    planId: string | null;
    accessDuringGracePeriod: "FULL_ACCESS" | "RESTRICTED_ACCESS" | "NO_ACCESS";
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
  };
  features: ResolvedFeature[];
}

export interface EntitlementRow {
  id: string;
  featureKey: string;
  type: "BOOLEAN" | "LIMIT" | "UNLIMITED" | "USAGE";
  limitValue: number | null;
  booleanValue: boolean | null;
  meterCode: string | null;
  expiresAt: string | null;
  plan?: { id: string; code: string; name: string } | null;
  customer?: { id: string; externalId: string | null; email: string } | null;
}
