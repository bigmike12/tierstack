import type { PrismaClient, TransactionClient } from "@tierbase/database";
import {
  requireCapability,
  type PaymentProvider,
  type PaymentResult,
  type ProviderKind,
  type ProviderPaymentMethodType,
  type TokenizedPaymentMethod,
} from "@tierbase/payments-core";
import {
  BillingError,
  assertCurrency,
  money,
  newId,
  type CurrencyCode,
} from "@tierbase/shared";
import { applyPaymentToInvoice, assertPayable } from "./invoice";
import { openGracePeriod } from "./grace";
import { resolveProviders, type ProviderFactoryDeps } from "./providers";
import { loadDunningPolicy } from "./settings";
import { applyTransition } from "./transitions";
import type { SubscriptionStatus } from "./state-machine";

export interface AttemptPaymentParams {
  organizationId: string;
  invoiceId: string;
  environment: "TEST" | "LIVE";
  /** Force a specific stored payment method rather than the customer default. */
  paymentMethodId?: string | null;
  /** Where the customer is sent back to after a hosted checkout. */
  callbackUrl?: string | null;
  /** Passed through to the provider; the mock rail reads `mockOutcome` from it. */
  metadata?: Record<string, unknown>;
}

export interface AttemptPaymentResult {
  attemptId: string;
  status: PaymentResult["status"];
  provider: ProviderKind;
  reference: string;
  providerReference: string | null;
  /** Present when the customer must complete payment on a hosted page. */
  checkoutUrl?: string | null;
  amount: number;
  currency: CurrencyCode;
  invoiceStatus: string;
  subscriptionStatus?: SubscriptionStatus;
  failureCode?: string;
  failureReason?: string;
}

/**
 * Collects an open invoice.
 *
 * If the customer has a reusable payment method the engine charges it directly
 * — routing is pinned to the provider that issued the token, because failing
 * over would present a meaningless token to a different rail. Otherwise it
 * opens a hosted checkout on the highest-priority eligible provider.
 */
export async function attemptInvoicePayment(
  prisma: PrismaClient,
  deps: ProviderFactoryDeps,
  params: AttemptPaymentParams
): Promise<AttemptPaymentResult> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, organizationId: params.organizationId },
    include: { customer: true, subscription: true },
  });
  if (!invoice) throw BillingError.notFound("INVOICE_NOT_FOUND", "Invoice");
  assertPayable(invoice);

  const currency = assertCurrency(invoice.currency);
  const amount = money(invoice.amountDue, currency);

  const paymentMethod = await selectPaymentMethod(prisma, {
    organizationId: params.organizationId,
    customerId: invoice.customerId,
    paymentMethodId: params.paymentMethodId ?? invoice.subscription?.paymentMethodId ?? null,
  });

  const lastSuccessful = await prisma.paymentAttempt.findFirst({
    where: { organizationId: params.organizationId, customerId: invoice.customerId, status: "SUCCEEDED" },
    orderBy: { createdAt: "desc" },
    select: { provider: true },
  });

  const candidates = await resolveProviders(
    prisma,
    {
      organizationId: params.organizationId,
      environment: params.environment,
      currency,
      country: invoice.customer.country,
      method: (paymentMethod?.type ?? "CARD") as ProviderPaymentMethodType,
      pinnedProvider: (paymentMethod?.provider as ProviderKind | undefined) ?? null,
      lastSuccessfulProvider: (lastSuccessful?.provider as ProviderKind | undefined) ?? null,
    },
    deps
  );

  const attemptNumber =
    (await prisma.paymentAttempt.count({ where: { invoiceId: invoice.id } })) + 1;

  let lastError: BillingError | null = null;

  for (const candidate of candidates) {
    // The attempt id *is* the payment reference. That makes a provider webhook
    // resolvable back to exactly one attempt with no extra lookup table.
    const attemptId = newId("paymentAttempt");
    const reference = attemptId;

    // The attempt row is written before the provider is called, so a crash
    // mid-flight still leaves a record to reconcile against.
    const attempt = await prisma.paymentAttempt.create({
      data: {
        id: attemptId,
        organizationId: params.organizationId,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        provider: candidate.config.provider,
        paymentMethodId: paymentMethod?.id ?? null,
        amount: amount.amount,
        currency,
        status: "PROCESSING",
        attemptNumber,
        metadata: (params.metadata ?? {}) as never,
      },
    });

    try {
      const result = paymentMethod
        ? await chargeStoredMethod(candidate.provider, {
            reference,
            amount,
            invoice,
            paymentMethod,
            metadata: params.metadata,
          })
        : await openCheckout(candidate.provider, {
            reference,
            amount,
            invoice,
            callbackUrl: params.callbackUrl,
            metadata: params.metadata,
          });

      const applied = await applyPaymentResult(prisma, {
        organizationId: params.organizationId,
        attemptId: attempt.id,
        result: result.payment,
        checkoutUrl: result.checkoutUrl,
      });

      return {
        attemptId: attempt.id,
        status: result.payment.status,
        provider: candidate.config.provider,
        reference,
        providerReference: result.payment.providerReference,
        checkoutUrl: result.checkoutUrl ?? null,
        amount: amount.amount,
        currency,
        invoiceStatus: applied.invoiceStatus,
        subscriptionStatus: applied.subscriptionStatus,
        failureCode: result.payment.failureCode,
        failureReason: result.payment.failureReason,
      };
    } catch (error) {
      const billingError =
        error instanceof BillingError
          ? error
          : new BillingError(
              "PROVIDER_ERROR",
              error instanceof Error ? error.message : "The payment provider returned an error."
            );
      lastError = billingError;

      await prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "FAILED",
          failureCode: billingError.code,
          failureReason: billingError.message,
          completedAt: new Date(),
        },
      });

      // A pinned attempt must not fall through to another rail.
      if (paymentMethod) break;
    }
  }

  await handlePaymentFailure(prisma, {
    organizationId: params.organizationId,
    invoiceId: invoice.id,
    reason: lastError?.message ?? "No provider could collect this payment.",
  });

  throw lastError ?? new BillingError("PAYMENT_FAILED", "No provider could collect this payment.");
}

interface ApplyResultParams {
  organizationId: string;
  attemptId: string;
  result: PaymentResult;
  checkoutUrl?: string | null;
}

/**
 * Writes a provider outcome into billing state. Everything that must agree —
 * attempt, invoice, subscription, stored payment method — moves inside one
 * database transaction or not at all.
 */
export async function applyPaymentResult(
  prisma: PrismaClient,
  params: ApplyResultParams
): Promise<{ invoiceStatus: string; subscriptionStatus?: SubscriptionStatus }> {
  return prisma.$transaction(async (tx) => {
    const attempt = await tx.paymentAttempt.findFirst({
      where: { id: params.attemptId, organizationId: params.organizationId },
      include: { invoice: { include: { subscription: true } } },
    });
    if (!attempt) throw BillingError.notFound("PAYMENT_ATTEMPT_NOT_FOUND", "Payment attempt");

    const invoice = attempt.invoice;
    const result = params.result;

    if (result.status === "SUCCEEDED") {
      // Never trust the amount implied by a redirect. Compare what the provider
      // says it actually collected against what the invoice asked for.
      if (result.amount.currency !== invoice.currency) {
        throw new BillingError(
          "CURRENCY_MISMATCH",
          `Provider settled in ${result.amount.currency} but invoice ${invoice.invoiceNumber} is in ${invoice.currency}.`
        );
      }
      if (result.amount.amount < attempt.amount) {
        throw new BillingError(
          "PAYMENT_FAILED",
          `Provider collected ${result.amount.amount} but ${attempt.amount} was due on ${invoice.invoiceNumber}.`
        );
      }
    }

    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: result.status,
        providerReference: result.providerReference,
        failureCode: result.failureCode ?? null,
        failureReason: result.failureReason ?? null,
        checkoutUrl: params.checkoutUrl ?? null,
        rawProviderResponse: (result.raw ?? null) as never,
        completedAt: ["SUCCEEDED", "FAILED", "CANCELED"].includes(result.status) ? new Date() : null,
      },
    });

    if (result.status !== "SUCCEEDED") {
      if (result.status === "FAILED" || result.status === "CANCELED") {
        const subscriptionStatus = await failInvoiceInTransaction(tx, {
          organizationId: params.organizationId,
          invoiceId: invoice.id,
        });
        return { invoiceStatus: invoice.status, subscriptionStatus };
      }
      return { invoiceStatus: invoice.status };
    }

    if (result.paymentMethod) {
      await upsertPaymentMethod(tx, {
        organizationId: params.organizationId,
        customerId: attempt.customerId,
        provider: attempt.provider as ProviderKind,
        token: result.paymentMethod,
        subscriptionId: invoice.subscriptionId,
      });
    }

    const paidInvoice = await applyPaymentToInvoice(
      tx,
      invoice.id,
      result.amount.amount,
      result.paidAt ?? new Date()
    );

    let subscriptionStatus: SubscriptionStatus | undefined;
    if (invoice.subscription && paidInvoice.status === "PAID") {
      const current = invoice.subscription.status as SubscriptionStatus;
      if (["INCOMPLETE", "PAST_DUE", "GRACE_PERIOD", "UNPAID", "TRIALING"].includes(current)) {
        await applyTransition(tx, invoice.subscription.id, current, "ACTIVE", "payment_succeeded", {
          gracePeriodStart: null,
          gracePeriodEnd: null,
          gracePolicy: null,
        });
        subscriptionStatus = "ACTIVE";
      } else {
        subscriptionStatus = current;
      }
    }

    return { invoiceStatus: paidInvoice.status, subscriptionStatus };
  });
}

/**
 * Applies the organization's dunning policy after a failed collection: the
 * subscription moves to PAST_DUE and then into a grace period whose length and
 * access rules come entirely from BillingSettings.
 */
export async function handlePaymentFailure(
  prisma: PrismaClient,
  params: { organizationId: string; invoiceId: string; reason: string }
): Promise<SubscriptionStatus | undefined> {
  return prisma.$transaction((tx) =>
    failInvoiceInTransaction(tx, { organizationId: params.organizationId, invoiceId: params.invoiceId })
  );
}

async function failInvoiceInTransaction(
  tx: TransactionClient,
  params: { organizationId: string; invoiceId: string }
): Promise<SubscriptionStatus | undefined> {
  const invoice = await tx.invoice.findFirst({
    where: { id: params.invoiceId, organizationId: params.organizationId },
    include: { subscription: true },
  });
  if (!invoice?.subscription) return undefined;

  const policy = await loadDunningPolicy(tx, params.organizationId);
  const now = new Date();
  const current = invoice.subscription.status as SubscriptionStatus;

  const failedAttempts = await tx.paymentAttempt.count({
    where: { invoiceId: invoice.id, status: "FAILED" },
  });

  await tx.invoice.update({
    where: { id: invoice.id },
    data: { dunningAttempts: failedAttempts },
  });

  if (["CANCELED", "EXPIRED", "PAUSED", "UNPAID", "GRACE_PERIOD"].includes(current)) {
    return current;
  }

  // A first payment that never settled is not a lapse. The subscription stays
  // INCOMPLETE — no grace period, no service, and no dunning ladder chasing a
  // customer who never had a payment method.
  if (current === "INCOMPLETE") {
    return "INCOMPLETE";
  }

  if (current !== "PAST_DUE") {
    await applyTransition(tx, invoice.subscription.id, current, "PAST_DUE", "payment_failed");
  }

  const window = openGracePeriod(policy, now);
  await applyTransition(
    tx,
    invoice.subscription.id,
    "PAST_DUE",
    "GRACE_PERIOD",
    "grace_period_started",
    {
      gracePeriodStart: window.gracePeriodStart,
      gracePeriodEnd: window.gracePeriodEnd,
      gracePolicy: window.snapshot as never,
    },
    { gracePeriodDays: policy.gracePeriodDays, failureAction: policy.failureAction }
  );

  return "GRACE_PERIOD";
}

// -- helpers -----------------------------------------------------------------

async function selectPaymentMethod(
  prisma: PrismaClient,
  params: { organizationId: string; customerId: string; paymentMethodId: string | null }
) {
  if (params.paymentMethodId) {
    const method = await prisma.paymentMethod.findFirst({
      where: {
        id: params.paymentMethodId,
        organizationId: params.organizationId,
        customerId: params.customerId,
        status: "ACTIVE",
      },
    });
    if (!method) throw BillingError.notFound("PAYMENT_METHOD_NOT_FOUND", "Payment method");
    return method;
  }
  return prisma.paymentMethod.findFirst({
    where: { organizationId: params.organizationId, customerId: params.customerId, status: "ACTIVE" },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
}

async function chargeStoredMethod(
  provider: PaymentProvider,
  params: {
    reference: string;
    amount: ReturnType<typeof money>;
    invoice: { customerId: string; customer: { email: string; name: string | null } };
    paymentMethod: { type: string; providerPaymentMethodRef: string; providerCustomerRef: string | null };
    metadata?: Record<string, unknown>;
  }
): Promise<{ payment: PaymentResult; checkoutUrl?: string | null }> {
  requireCapability(provider, "tokenization");
  const payment = await provider.chargePaymentMethod({
    reference: params.reference,
    amount: params.amount,
    customer: {
      customerId: params.invoice.customerId,
      email: params.invoice.customer.email,
      name: params.invoice.customer.name,
    },
    paymentMethod: {
      type: params.paymentMethod.type as ProviderPaymentMethodType,
      providerPaymentMethodRef: params.paymentMethod.providerPaymentMethodRef,
      providerCustomerRef: params.paymentMethod.providerCustomerRef,
    },
    metadata: params.metadata,
  });
  return { payment };
}

async function openCheckout(
  provider: PaymentProvider,
  params: {
    reference: string;
    amount: ReturnType<typeof money>;
    invoice: {
      customerId: string;
      invoiceNumber: string;
      customer: { email: string; name: string | null; phone: string | null };
    };
    callbackUrl?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<{ payment: PaymentResult; checkoutUrl?: string | null }> {
  const checkout = await provider.createCheckout({
    reference: params.reference,
    amount: params.amount,
    customer: {
      customerId: params.invoice.customerId,
      email: params.invoice.customer.email,
      name: params.invoice.customer.name,
      phone: params.invoice.customer.phone,
    },
    description: `Invoice ${params.invoice.invoiceNumber}`,
    callbackUrl: params.callbackUrl ?? undefined,
    savePaymentMethod: provider.getCapabilities().tokenization,
    metadata: params.metadata,
  });

  // A directive-driven checkout can resolve immediately; ask the provider what
  // actually happened rather than assuming PENDING.
  const payment = await provider.verifyPayment(params.reference);
  return { payment, checkoutUrl: checkout.checkoutUrl };
}

export async function upsertPaymentMethod(
  tx: TransactionClient,
  params: {
    organizationId: string;
    customerId: string;
    provider: ProviderKind;
    token: TokenizedPaymentMethod;
    subscriptionId?: string | null;
  }
) {
  const existing = await tx.paymentMethod.findUnique({
    where: {
      organizationId_provider_providerPaymentMethodRef: {
        organizationId: params.organizationId,
        provider: params.provider,
        providerPaymentMethodRef: params.token.providerPaymentMethodRef,
      },
    },
  });

  const data = {
    brand: params.token.brand ?? null,
    last4: params.token.last4 ?? null,
    expMonth: params.token.expMonth ?? null,
    expYear: params.token.expYear ?? null,
    bankName: params.token.bankName ?? null,
    providerCustomerRef: params.token.providerCustomerRef ?? null,
    status: "ACTIVE" as const,
    detachedAt: null,
  };

  const method = existing
    ? await tx.paymentMethod.update({ where: { id: existing.id }, data })
    : await tx.paymentMethod.create({
        data: {
          id: newId("paymentMethod"),
          organizationId: params.organizationId,
          customerId: params.customerId,
          provider: params.provider,
          type: params.token.type,
          providerPaymentMethodRef: params.token.providerPaymentMethodRef,
          isDefault: true,
          ...data,
        },
      });

  // Attach the freshly stored method to the subscription so the next renewal
  // charges it without another checkout.
  if (params.subscriptionId) {
    await tx.subscription.update({
      where: { id: params.subscriptionId },
      data: { paymentMethodId: method.id },
    });
  }

  return method;
}
