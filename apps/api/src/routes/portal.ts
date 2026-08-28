import type { PrismaClient } from "@tierstack/database";
import {
  attemptInvoicePayment,
  cancelSubscription,
  createPortalSession,
  resumeSubscription,
} from "@tierstack/billing";
import { BillingError, success } from "@tierstack/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { environmentOf, requireCustomer, requireOrganization, requireSecretKeyOrUser } from "../context";
import type { AppConfig } from "../env";
import { recordAudit } from "../lib/audit";
import type { RedisClient } from "../lib/redis";

/**
 * The customer-facing billing portal.
 *
 * Two halves that never touch. The merchant mints a link with their secret key;
 * the customer follows it and lands on `/portal/*`, where the only thing in
 * scope is their own subscription. There is no route here that takes a customer
 * id — it comes from the token, which is the only way a portal can be safe.
 */
export function registerPortalRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  config: AppConfig,
  redis: RedisClient
): void {
  const providerDeps = {
    redis,
    checkoutBaseUrl: config.API_URL,
    encryptionKey: config.ENCRYPTION_KEY,
  };

  // -- the merchant mints a link ---------------------------------------------

  app.post("/v1/portal-sessions", async (request, reply) => {
    const organizationId = requireOrganization(request);
    const actor = requireSecretKeyOrUser(request);
    const body = z
      .object({
        customerId: z.string().min(1),
        returnUrl: z.string().url().optional(),
        /** How long the link stays usable. Short by default: it lives in email. */
        expiresInMinutes: z.number().int().min(5).max(60 * 24 * 7).default(60),
      })
      .parse(request.body);

    const session = await createPortalSession(prisma, {
      organizationId,
      customerId: body.customerId,
      environment: environmentOf(request),
      returnUrl: body.returnUrl ?? null,
      expiresInMinutes: body.expiresInMinutes,
    });

    await recordAudit(prisma, {
      organizationId,
      actorType: actor.kind === "USER" ? "USER" : "API_KEY",
      userId: actor.kind === "USER" ? actor.userId : null,
      action: "portal_session.created",
      resource: "portal_session",
      resourceId: session.id,
      metadata: { customerId: body.customerId, expiresAt: session.expiresAt },
      ipAddress: request.ip,
    });

    return reply.status(201).send(
      success(
        {
          id: session.id,
          // The token appears here once. Only its hash is stored, so a leaked
          // database gives nobody a working link.
          url: session.url,
          expiresAt: session.expiresAt,
        },
        request.requestId
      )
    );
  });

  app.post("/v1/portal-sessions/:sessionId/revoke", async (request) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    const { sessionId } = request.params as { sessionId: string };

    const session = await prisma.portalSession.findFirst({ where: { id: sessionId, organizationId } });
    if (!session) throw BillingError.notFound("PORTAL_SESSION_NOT_FOUND", "Portal session");

    const revoked = await prisma.portalSession.update({
      where: { id: session.id },
      data: { revokedAt: session.revokedAt ?? new Date() },
    });
    return success({ id: revoked.id, revokedAt: revoked.revokedAt }, request.requestId);
  });

  // -- what the customer sees ------------------------------------------------

  app.get("/portal/v1/overview", async (request) => {
    const { customerId, organizationId } = requireCustomer(request);

    const [customer, subscriptions, invoices, methods, settings, organization] = await Promise.all([
      prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, externalId: true, email: true, name: true, country: true },
      }),
      prisma.subscription.findMany({
        where: { organizationId, customerId, status: { notIn: ["EXPIRED"] } },
        include: { price: { include: { plan: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.invoice.findMany({
        where: { organizationId, customerId },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          currency: true,
          total: true,
          amountDue: true,
          billingPeriodStart: true,
          billingPeriodEnd: true,
          finalizedAt: true,
          paidAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 24,
      }),
      prisma.paymentMethod.findMany({
        where: { organizationId, customerId, status: "ACTIVE" },
        select: { id: true, type: true, brand: true, last4: true, expMonth: true, expYear: true, isDefault: true },
      }),
      prisma.billingSettings.findUnique({
        where: { organizationId },
        select: { supportEmail: true, accessDuringGracePeriod: true },
      }),
      prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    ]);

    const session = await prisma.portalSession.findUnique({
      where: { id: requireCustomer(request).portalSessionId },
      select: { returnUrl: true, expiresAt: true },
    });

    return success(
      {
        merchant: { name: organization?.name ?? "", supportEmail: settings?.supportEmail ?? null },
        customer,
        subscriptions,
        invoices,
        paymentMethods: methods,
        returnUrl: session?.returnUrl ?? null,
        expiresAt: session?.expiresAt ?? null,
      },
      request.requestId
    );
  });

  // -- what the customer can do ----------------------------------------------

  /**
   * Pay an outstanding invoice.
   *
   * Always a hosted checkout, never a charge against the card already on file.
   * The stored card is what has just been failing, and a customer who has come
   * here to fix it needs to be able to use a different one.
   */
  app.post("/portal/v1/invoices/:invoiceId/pay", async (request) => {
    const { customerId, organizationId } = requireCustomer(request);
    const { invoiceId } = request.params as { invoiceId: string };

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId, customerId },
      select: { id: true, status: true, amountDue: true },
    });
    if (!invoice) throw BillingError.notFound("INVOICE_NOT_FOUND", "Invoice");
    if (invoice.status === "PAID" || invoice.amountDue === 0) {
      throw new BillingError("INVOICE_ALREADY_PAID", "This invoice has already been paid.");
    }

    const result = await attemptInvoicePayment(prisma, providerDeps, {
      organizationId,
      invoiceId: invoice.id,
      environment: environmentOf(request),
      forceCheckout: true,
    });

    return success(
      { checkoutUrl: result.checkoutUrl, status: result.status, reference: result.reference },
      request.requestId
    );
  });

  app.post("/portal/v1/subscriptions/:subscriptionId/cancel", async (request) => {
    const { customerId, organizationId } = requireCustomer(request);
    const { subscriptionId } = request.params as { subscriptionId: string };
    const body = z.object({ atPeriodEnd: z.boolean().default(true) }).parse(request.body ?? {});

    // Ownership first: a portal token must not be able to cancel a
    // subscription belonging to somebody else in the same organization.
    const owned = await prisma.subscription.findFirst({
      where: { id: subscriptionId, organizationId, customerId },
      select: { id: true },
    });
    if (!owned) throw BillingError.notFound("SUBSCRIPTION_NOT_FOUND", "Subscription");

    const subscription = await cancelSubscription(prisma, {
      organizationId,
      subscriptionId: owned.id,
      atPeriodEnd: body.atPeriodEnd,
    });

    await recordAudit(prisma, {
      organizationId,
      actorType: "CUSTOMER",
      action: body.atPeriodEnd ? "subscription.cancel_scheduled" : "subscription.canceled",
      resource: "subscription",
      resourceId: owned.id,
      metadata: { via: "portal" },
      ipAddress: request.ip,
    });

    return success(subscription, request.requestId);
  });

  app.post("/portal/v1/subscriptions/:subscriptionId/resume", async (request) => {
    const { customerId, organizationId } = requireCustomer(request);
    const { subscriptionId } = request.params as { subscriptionId: string };

    const owned = await prisma.subscription.findFirst({
      where: { id: subscriptionId, organizationId, customerId },
      select: { id: true },
    });
    if (!owned) throw BillingError.notFound("SUBSCRIPTION_NOT_FOUND", "Subscription");

    const subscription = await resumeSubscription(prisma, {
      organizationId,
      subscriptionId: owned.id,
    });

    await recordAudit(prisma, {
      organizationId,
      actorType: "CUSTOMER",
      action: "subscription.cancel_revoked",
      resource: "subscription",
      resourceId: owned.id,
      metadata: { via: "portal" },
      ipAddress: request.ip,
    });

    return success(subscription, request.requestId);
  });
}
