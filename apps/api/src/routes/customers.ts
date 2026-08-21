import type { PrismaClient } from "@billing-platform/database";
import { lookupCustomer, resolveCustomer } from "@billing-platform/billing";
import { BillingError, success } from "@billing-platform/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireActor, requireOrganization, requireSecretKeyOrUser } from "../context";
import { recordAudit } from "../lib/audit";

const customerSchema = z.object({
  externalId: z.string().min(1).max(255).optional(),
  email: z.string().email(),
  name: z.string().max(200).optional(),
  phone: z.string().max(32).optional(),
  currency: z.string().length(3).optional(),
  country: z.string().length(2).optional(),
  metadata: z.record(z.unknown()).default({}),
});

export function registerCustomerRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  /**
   * Explicit creation. Idempotent on (organizationId, externalId): calling it
   * again with the same externalId updates the contact details rather than
   * creating a second customer.
   */
  app.post("/v1/customers", async (request, reply) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    const actor = requireActor(request);
    const body = customerSchema.parse(request.body);

    const customer = await prisma.$transaction((tx) =>
      resolveCustomer(tx, { organizationId, customer: body })
    );

    await recordAudit(prisma, {
      organizationId,
      actorType: actor.kind,
      userId: actor.kind === "USER" ? actor.userId : null,
      action: "customer.created",
      resource: "customer",
      resourceId: customer.id,
      metadata: { externalId: body.externalId },
      ipAddress: request.ip,
    });

    return reply.status(201).send(success(customer, request.requestId));
  });

  app.get("/v1/customers", async (request) => {
    const organizationId = requireOrganization(request);
    const query = request.query as { email?: string; externalId?: string; limit?: string; cursor?: string };
    const limit = Math.min(Number(query.limit ?? 50), 100);

    const customers = await prisma.customer.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(query.email ? { email: query.email } : {}),
        ...(query.externalId ? { externalId: query.externalId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
    });

    return success(
      { items: customers, nextCursor: customers.length === limit ? customers.at(-1)?.id ?? null : null },
      request.requestId
    );
  });

  /** Accepts either the platform id (`cus_...`) or the developer's own id. */
  app.get("/v1/customers/:customerId", async (request) => {
    const organizationId = requireOrganization(request);
    const { customerId } = request.params as { customerId: string };
    const customer = await lookupCustomer(prisma, organizationId, customerId);

    const [subscriptions, invoices, paymentMethods] = await Promise.all([
      prisma.subscription.findMany({
        where: { customerId: customer.id },
        include: { price: { include: { plan: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.invoice.findMany({
        where: { customerId: customer.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.paymentMethod.findMany({
        where: { customerId: customer.id, status: "ACTIVE" },
        select: {
          id: true,
          type: true,
          provider: true,
          brand: true,
          last4: true,
          expMonth: true,
          expYear: true,
          bankName: true,
          isDefault: true,
        },
      }),
    ]);

    return success({ ...customer, subscriptions, invoices, paymentMethods }, request.requestId);
  });

  app.patch("/v1/customers/:customerId", async (request) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    const { customerId } = request.params as { customerId: string };
    const body = customerSchema.partial().omit({ externalId: true }).parse(request.body);

    const customer = await lookupCustomer(prisma, organizationId, customerId);
    const updated = await prisma.customer.update({ where: { id: customer.id }, data: body as never });
    return success(updated, request.requestId);
  });

  /**
   * Soft delete. Financial history — invoices, payment attempts, ledger entries
   * — is never removed, so the record is marked and hidden rather than dropped.
   */
  app.delete("/v1/customers/:customerId", async (request) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    const { customerId } = request.params as { customerId: string };
    const customer = await lookupCustomer(prisma, organizationId, customerId);

    const live = await prisma.subscription.count({
      where: {
        customerId: customer.id,
        status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] },
      },
    });
    if (live > 0) {
      throw new BillingError(
        "INVALID_REQUEST",
        "Cancel this customer's live subscriptions before deleting them."
      );
    }

    await prisma.customer.update({ where: { id: customer.id }, data: { deletedAt: new Date() } });
    return success({ deleted: true }, request.requestId);
  });

  // -- Payment methods -------------------------------------------------------

  app.get("/v1/payment-methods", async (request) => {
    const organizationId = requireOrganization(request);
    const query = request.query as { customerId?: string };
    if (!query.customerId) {
      throw new BillingError("INVALID_REQUEST", "customerId is required.");
    }
    const customer = await lookupCustomer(prisma, organizationId, query.customerId);
    const methods = await prisma.paymentMethod.findMany({
      where: { customerId: customer.id },
      select: {
        id: true,
        type: true,
        provider: true,
        status: true,
        brand: true,
        last4: true,
        expMonth: true,
        expYear: true,
        bankName: true,
        isDefault: true,
        createdAt: true,
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    return success(methods, request.requestId);
  });

  app.delete("/v1/payment-methods/:paymentMethodId", async (request) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    const { paymentMethodId } = request.params as { paymentMethodId: string };

    const method = await prisma.paymentMethod.findFirst({
      where: { id: paymentMethodId, organizationId },
    });
    if (!method) throw BillingError.notFound("PAYMENT_METHOD_NOT_FOUND", "Payment method");

    await prisma.$transaction(async (tx) => {
      await tx.subscription.updateMany({
        where: { paymentMethodId: method.id },
        data: { paymentMethodId: null },
      });
      await tx.paymentMethod.update({
        where: { id: method.id },
        data: { status: "DETACHED", detachedAt: new Date(), isDefault: false },
      });
    });

    return success({ detached: true }, request.requestId);
  });
}
