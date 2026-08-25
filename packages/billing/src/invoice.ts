import type { TransactionClient } from "@tierstack/database";
import {
  BillingError,
  addDays,
  assertCurrency,
  newId,
  type CurrencyCode,
} from "@tierstack/shared";
import type { ComputedLine } from "./pricing";

export interface CreateInvoiceParams {
  organizationId: string;
  customerId: string;
  subscriptionId?: string | null;
  currency: CurrencyCode;
  lines: ComputedLine[];
  billingPeriodStart?: Date | null;
  billingPeriodEnd?: Date | null;
  /** Days after finalization the invoice falls due. 0 means immediately. */
  invoiceDueDays: number;
  invoiceNumberPrefix: string;
  metadata?: Record<string, unknown>;
}

/**
 * Per-organization, per-year sequential numbering. The counter row is locked by
 * the update itself, so two concurrent invoice generations cannot collide.
 */
export async function nextInvoiceNumber(
  tx: TransactionClient,
  organizationId: string,
  prefix: string,
  when = new Date()
): Promise<string> {
  const year = when.getUTCFullYear();
  const counter = await tx.invoiceCounter.upsert({
    where: { organizationId_year: { organizationId, year } },
    create: { organizationId, year, lastSequence: 1 },
    update: { lastSequence: { increment: 1 } },
    select: { lastSequence: true },
  });
  return `${prefix}-${year}-${String(counter.lastSequence).padStart(5, "0")}`;
}

export interface InvoiceTotals {
  subtotal: number;
  discountAmount: number;
  creditAmount: number;
  taxAmount: number;
  total: number;
  amountDue: number;
}

/**
 * Totals are derived from the line items, never accumulated independently.
 * Discounts and credits are stored as negative line amounts, so the subtotal is
 * the sum of the positive charge lines and the reductions are reported
 * separately for display.
 */
export function computeTotals(lines: readonly ComputedLine[], amountPaid = 0): InvoiceTotals {
  let subtotal = 0;
  let discountAmount = 0;
  let creditAmount = 0;
  let taxAmount = 0;

  for (const line of lines) {
    switch (line.type) {
      case "COUPON":
        discountAmount += -line.amount;
        break;
      case "CREDIT":
        creditAmount += -line.amount;
        break;
      case "TAX":
        taxAmount += line.amount;
        break;
      default:
        subtotal += line.amount;
    }
  }

  const total = subtotal - discountAmount - creditAmount + taxAmount;
  return {
    subtotal,
    discountAmount,
    creditAmount,
    taxAmount,
    total,
    amountDue: Math.max(total - amountPaid, 0),
  };
}

/** Creates a DRAFT invoice with its line items. Must run inside a transaction. */
export async function createInvoice(tx: TransactionClient, params: CreateInvoiceParams) {
  const currency = assertCurrency(params.currency);
  for (const line of params.lines) {
    if (line.currency !== currency) {
      throw new BillingError(
        "CURRENCY_MISMATCH",
        `Invoice is in ${currency} but a line item is in ${line.currency}.`
      );
    }
  }

  const totals = computeTotals(params.lines);
  const invoiceNumber = await nextInvoiceNumber(tx, params.organizationId, params.invoiceNumberPrefix);

  const invoice = await tx.invoice.create({
    data: {
      id: newId("invoice"),
      organizationId: params.organizationId,
      customerId: params.customerId,
      subscriptionId: params.subscriptionId ?? null,
      invoiceNumber,
      status: "DRAFT",
      currency,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      creditAmount: totals.creditAmount,
      taxAmount: totals.taxAmount,
      total: totals.total,
      amountPaid: 0,
      amountDue: totals.amountDue,
      billingPeriodStart: params.billingPeriodStart ?? null,
      billingPeriodEnd: params.billingPeriodEnd ?? null,
      metadata: (params.metadata ?? {}) as never,
    },
  });

  if (params.lines.length > 0) {
    await tx.invoiceLineItem.createMany({
      data: params.lines.map((line) => ({
        id: newId("lineItem"),
        organizationId: params.organizationId,
        invoiceId: invoice.id,
        type: line.type,
        description: line.description,
        quantity: line.quantity,
        unitAmount: line.unitAmount,
        amount: line.amount,
        currency,
        periodStart: line.periodStart ?? null,
        periodEnd: line.periodEnd ?? null,
        metadata: (line.metadata ?? {}) as never,
      })),
    });
  }

  return invoice;
}

/**
 * DRAFT → OPEN, or straight to PAID when the invoice nets to nothing (a full
 * credit or a 100% coupon). Finalization is what makes an invoice collectable.
 */
export async function finalizeInvoice(
  tx: TransactionClient,
  invoiceId: string,
  invoiceDueDays: number,
  now = new Date()
) {
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw BillingError.notFound("INVOICE_NOT_FOUND", "Invoice");
  if (invoice.status !== "DRAFT") return invoice;

  const settled = invoice.total <= 0;
  return tx.invoice.update({
    where: { id: invoiceId },
    data: {
      status: settled ? "PAID" : "OPEN",
      finalizedAt: now,
      dueDate: addDays(now, invoiceDueDays),
      amountDue: settled ? 0 : invoice.total,
      paidAt: settled ? now : null,
    },
  });
}

/**
 * Records money received against an invoice. Only ever called inside the same
 * transaction that closes out the payment attempt.
 */
export async function applyPaymentToInvoice(
  tx: TransactionClient,
  invoiceId: string,
  amount: number,
  paidAt = new Date()
) {
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw BillingError.notFound("INVOICE_NOT_FOUND", "Invoice");
  if (invoice.status === "VOID") {
    throw new BillingError("INVOICE_NOT_PAYABLE", "A voided invoice cannot receive payment.");
  }

  const amountPaid = invoice.amountPaid + amount;
  const amountDue = Math.max(invoice.total - amountPaid, 0);
  const fullySettled = amountDue === 0;

  return tx.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid,
      amountDue,
      status: fullySettled ? "PAID" : invoice.status === "DRAFT" ? "OPEN" : invoice.status,
      paidAt: fullySettled ? paidAt : invoice.paidAt,
      nextRetryAt: fullySettled ? null : invoice.nextRetryAt,
    },
  });
}

export async function voidInvoice(tx: TransactionClient, invoiceId: string, now = new Date()) {
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw BillingError.notFound("INVOICE_NOT_FOUND", "Invoice");
  if (invoice.status === "PAID") {
    throw new BillingError("INVOICE_ALREADY_PAID", "A paid invoice cannot be voided; issue a refund instead.");
  }
  return tx.invoice.update({
    where: { id: invoiceId },
    data: { status: "VOID", voidedAt: now, amountDue: 0, nextRetryAt: null },
  });
}

export function assertPayable(invoice: { status: string; amountDue: number }): void {
  if (invoice.status === "PAID") {
    throw new BillingError("INVOICE_ALREADY_PAID", "This invoice has already been paid.");
  }
  if (invoice.status === "VOID" || invoice.status === "UNCOLLECTIBLE") {
    throw new BillingError("INVOICE_NOT_PAYABLE", `An invoice in ${invoice.status} state cannot be paid.`);
  }
  if (invoice.amountDue <= 0) {
    throw new BillingError("INVOICE_NOT_PAYABLE", "This invoice has nothing left to pay.");
  }
}
