import type { TransactionClient } from "@tierbase/database";
import { BillingError, assertCurrency, newId } from "@tierbase/shared";

export interface CustomerInput {
  /** The developer's own user id. Optional, but strongly recommended. */
  externalId?: string | null;
  email: string;
  name?: string | null;
  phone?: string | null;
  currency?: string | null;
  country?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ResolveCustomerParams {
  organizationId: string;
  /** Either an existing platform customer id, or an inline customer to resolve. */
  customerId?: string | null;
  customer?: CustomerInput | null;
}

/**
 * Find-or-create, keyed on (organizationId, externalId).
 *
 * This is what lets a developer call `subscriptions.create({ customer: { externalId } })`
 * and never think about platform customer ids. The operation is idempotent:
 * calling it twice with the same externalId returns the same customer and
 * refreshes any details that changed, rather than creating a duplicate.
 */
export async function resolveCustomer(tx: TransactionClient, params: ResolveCustomerParams) {
  if (params.customerId) {
    const existing = await tx.customer.findFirst({
      where: { id: params.customerId, organizationId: params.organizationId, deletedAt: null },
    });
    if (!existing) throw BillingError.notFound("CUSTOMER_NOT_FOUND", "Customer");
    return existing;
  }

  const input = params.customer;
  if (!input) {
    throw new BillingError(
      "INVALID_REQUEST",
      "Provide either `customerId` or a `customer` object with at least an email."
    );
  }
  if (!input.email) {
    throw new BillingError("VALIDATION_ERROR", "A customer requires an email address.");
  }
  if (input.currency) assertCurrency(input.currency);

  if (input.externalId) {
    const existing = await tx.customer.findUnique({
      where: {
        organizationId_externalId: {
          organizationId: params.organizationId,
          externalId: input.externalId,
        },
      },
    });
    if (existing) {
      // Refresh the mutable contact details, but never silently move a customer
      // to another organization or clear fields the caller did not send.
      return tx.customer.update({
        where: { id: existing.id },
        data: {
          email: input.email,
          name: input.name ?? existing.name,
          phone: input.phone ?? existing.phone,
          currency: input.currency ?? existing.currency,
          country: input.country ?? existing.country,
          deletedAt: null,
        },
      });
    }
  }

  return tx.customer.create({
    data: {
      id: newId("customer"),
      organizationId: params.organizationId,
      externalId: input.externalId ?? null,
      email: input.email,
      name: input.name ?? null,
      phone: input.phone ?? null,
      currency: input.currency ?? null,
      country: input.country ?? null,
      metadata: (input.metadata ?? {}) as never,
    },
  });
}

export async function findCustomerByExternalId(
  tx: TransactionClient,
  organizationId: string,
  externalId: string
) {
  return tx.customer.findUnique({
    where: { organizationId_externalId: { organizationId, externalId } },
  });
}

/**
 * Accepts either a platform id (`cus_...`) or the developer's own external id,
 * so API paths like `/v1/customers/user_83921` work without a lookup table on
 * the developer's side.
 */
export async function lookupCustomer(
  tx: TransactionClient,
  organizationId: string,
  idOrExternalId: string
) {
  const customer = await tx.customer.findFirst({
    where: {
      organizationId,
      deletedAt: null,
      OR: [{ id: idOrExternalId }, { externalId: idOrExternalId }],
    },
  });
  if (!customer) throw BillingError.notFound("CUSTOMER_NOT_FOUND", "Customer");
  return customer;
}
