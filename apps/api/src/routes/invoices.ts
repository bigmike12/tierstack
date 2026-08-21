import type { PrismaClient } from "@billing-platform/database";
import { attemptInvoicePayment, voidInvoice } from "@billing-platform/billing";
import { BillingError, success } from "@billing-platform/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { environmentOf, requireOrganization, requireSecretKeyOrUser } from "../context";
import type { AppConfig } from "../env";
import { recordAudit } from "../lib/audit";
import type { RedisClient } from "../lib/redis";
import { releaseIdempotency, withIdempotency } from "../plugins/idempotency";

export function registerInvoiceRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  config: AppConfig,
  redis: RedisClient
): void {
  const providerDeps = { redis, checkoutBaseUrl: config.API_URL, encryptionKey: config.ENCRYPTION_KEY };

  app.get("/v1/invoices", async (request) => {
    const organizationId = requireOrganization(request);
    const query = request.query as {
      customerId?: string;
      subscriptionId?: string;
      status?: string;
      limit?: string;
    };
    const limit = Math.min(Number(query.limit ?? 50), 100);

    const invoices = await prisma.invoice.findMany({
      where: {
        organizationId,
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.subscriptionId ? { subscriptionId: query.subscriptionId } : {}),
        ...(query.status ? { status: query.status as never } : {}),
      },
      include: { lineItems: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return success(invoices, request.requestId);
  });

  app.get("/v1/invoices/:invoiceId", async (request) => {
    const organizationId = requireOrganization(request);
    const { invoiceId } = request.params as { invoiceId: string };

    const invoice = await prisma.invoice.findFirst({
      where: {
        organizationId,
        OR: [{ id: invoiceId }, { invoiceNumber: invoiceId }],
      },
      include: {
        lineItems: { orderBy: { createdAt: "asc" } },
        attempts: { orderBy: { attemptNumber: "asc" } },
        customer: { select: { id: true, externalId: true, email: true, name: true } },
        subscription: { select: { id: true, status: true } },
      },
    });
    if (!invoice) throw BillingError.notFound("INVOICE_NOT_FOUND", "Invoice");
    return success(invoice, request.requestId);
  });

  /**
   * Collect, or retry collecting, an open invoice. Every call creates a new
   * PaymentAttempt — previous attempts are never overwritten, so the invoice
   * carries its own complete payment history.
   */
  app.post("/v1/invoices/:invoiceId/pay", async (request, reply) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    const { invoiceId } = request.params as { invoiceId: string };
    const body = z
      .object({
        paymentMethodId: z.string().optional(),
        callbackUrl: z.string().url().optional(),
        metadata: z.record(z.unknown()).optional(),
      })
      .parse(request.body ?? {});

    const idem = await withIdempotency(
      request,
      reply,
      { prisma, ttlHours: config.IDEMPOTENCY_TTL_HOURS },
      organizationId
    );
    if (idem.replay) return reply.status(idem.status).send(idem.body);

    try {
      const result = await attemptInvoicePayment(prisma, providerDeps, {
        organizationId,
        invoiceId,
        environment: environmentOf(request),
        paymentMethodId: body.paymentMethodId ?? null,
        callbackUrl: body.callbackUrl ?? null,
        metadata: body.metadata,
      });

      const payload = success(result, request.requestId);
      await idem.complete(200, payload);
      return reply.send(payload);
    } catch (error) {
      await releaseIdempotency(prisma, organizationId, request);
      throw error;
    }
  });

  app.post("/v1/invoices/:invoiceId/void", async (request) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    const { invoiceId } = request.params as { invoiceId: string };

    const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, organizationId } });
    if (!invoice) throw BillingError.notFound("INVOICE_NOT_FOUND", "Invoice");

    const voided = await prisma.$transaction((tx) => voidInvoice(tx, invoice.id));

    await recordAudit(prisma, {
      organizationId,
      actorType: "API_KEY",
      action: "invoice.voided",
      resource: "invoice",
      resourceId: invoice.id,
      metadata: { invoiceNumber: invoice.invoiceNumber },
      ipAddress: request.ip,
    });

    return success(voided, request.requestId);
  });

  app.get("/v1/payment-attempts", async (request) => {
    const organizationId = requireOrganization(request);
    const query = request.query as { invoiceId?: string; customerId?: string; limit?: string };
    const attempts = await prisma.paymentAttempt.findMany({
      where: {
        organizationId,
        ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(query.limit ?? 50), 100),
      select: {
        id: true,
        invoiceId: true,
        customerId: true,
        provider: true,
        amount: true,
        currency: true,
        status: true,
        attemptNumber: true,
        failureCode: true,
        failureReason: true,
        providerReference: true,
        createdAt: true,
        completedAt: true,
      },
    });
    return success(attempts, request.requestId);
  });
}
