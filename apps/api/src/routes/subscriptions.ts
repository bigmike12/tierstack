import type { PrismaClient } from "@tierbase/database";
import {
  attemptInvoicePayment,
  cancelSubscription,
  changePlan,
  changeQuantity,
  createSubscription,
  pauseSubscription,
  renewSubscription,
  resumeSubscription,
  loadBillingSettings,
} from "@tierbase/billing";
import { BillingError, success } from "@tierbase/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { environmentOf, requireOrganization, requireSecretKeyOrUser } from "../context";
import type { AppConfig } from "../env";
import { recordAudit } from "../lib/audit";
import type { RedisClient } from "../lib/redis";
import { releaseIdempotency, withIdempotency } from "../plugins/idempotency";

const inlineCustomer = z.object({
  externalId: z.string().min(1).max(255).optional(),
  email: z.string().email(),
  name: z.string().max(200).optional(),
  phone: z.string().max(32).optional(),
  currency: z.string().length(3).optional(),
  country: z.string().length(2).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const createSchema = z
  .object({
    customerId: z.string().min(1).optional(),
    customer: inlineCustomer.optional(),
    priceId: z.string().min(1),
    quantity: z.number().int().min(1).default(1),
    trialDays: z.number().int().min(0).max(365).optional(),
    paymentMethodId: z.string().optional(),
    /** Skip the automatic first collection and hand back the open invoice. */
    collectPayment: z.boolean().optional(),
    callbackUrl: z.string().url().optional(),
    metadata: z.record(z.unknown()).default({}),
  })
  .refine((value) => Boolean(value.customerId || value.customer), {
    message: "Provide either customerId or an inline customer object.",
    path: ["customer"],
  });

export function registerSubscriptionRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  config: AppConfig,
  redis: RedisClient
): void {
  const providerDeps = { redis, checkoutBaseUrl: config.API_URL, encryptionKey: config.ENCRYPTION_KEY };

  /**
   * The one call a developer usually needs. It resolves (or creates) the
   * customer, opens the subscription, issues the first invoice and — unless
   * told otherwise — starts collection, all under one idempotency key.
   */
  app.post("/v1/subscriptions", async (request, reply) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    const body = createSchema.parse(request.body);

    const idem = await withIdempotency(
      request,
      reply,
      { prisma, ttlHours: config.IDEMPOTENCY_TTL_HOURS },
      organizationId
    );
    if (idem.replay) return reply.status(idem.status).send(idem.body);

    try {
      const created = await createSubscription(prisma, {
        organizationId,
        customerId: body.customerId ?? null,
        customer: body.customer ?? null,
        priceId: body.priceId,
        quantity: body.quantity,
        trialDays: body.trialDays ?? null,
        paymentMethodId: body.paymentMethodId ?? null,
        metadata: body.metadata,
      });

      const settings = await loadBillingSettings(prisma, organizationId);
      const shouldCollect =
        (body.collectPayment ?? settings.autoCollect) && created.invoiceId !== null && created.amountDue > 0;

      let payment = null;
      if (shouldCollect) {
        payment = await attemptInvoicePayment(prisma, providerDeps, {
          organizationId,
          invoiceId: created.invoiceId!,
          environment: environmentOf(request),
          paymentMethodId: body.paymentMethodId ?? null,
          callbackUrl: body.callbackUrl ?? null,
          metadata: body.metadata,
        }).catch((error) => {
          // A declined first payment is a documented outcome, not a 500: the
          // subscription exists, the invoice is open, and the caller is told.
          if (error instanceof BillingError && error.code === "PAYMENT_FAILED") return null;
          throw error;
        });
      }

      const subscription = await loadSubscription(prisma, organizationId, created.subscriptionId);

      await recordAudit(prisma, {
        organizationId,
        actorType: "API_KEY",
        action: "subscription.created",
        resource: "subscription",
        resourceId: created.subscriptionId,
        metadata: { priceId: body.priceId, quantity: body.quantity },
        ipAddress: request.ip,
      });

      const payload = success(
        {
          subscription,
          invoiceId: created.invoiceId,
          amountDue: created.amountDue,
          currency: created.currency,
          payment,
        },
        request.requestId
      );
      await idem.complete(201, payload);
      return reply.status(201).send(payload);
    } catch (error) {
      await releaseIdempotency(prisma, organizationId, request);
      throw error;
    }
  });

  app.get("/v1/subscriptions", async (request) => {
    const organizationId = requireOrganization(request);
    const query = request.query as { customerId?: string; status?: string; limit?: string };
    const limit = Math.min(Number(query.limit ?? 50), 100);

    const subscriptions = await prisma.subscription.findMany({
      where: {
        organizationId,
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.status ? { status: query.status as never } : {}),
      },
      include: {
        price: { include: { plan: true } },
        customer: { select: { id: true, externalId: true, email: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return success(subscriptions, request.requestId);
  });

  app.get("/v1/subscriptions/:subscriptionId", async (request) => {
    const organizationId = requireOrganization(request);
    const { subscriptionId } = request.params as { subscriptionId: string };
    return success(await loadSubscription(prisma, organizationId, subscriptionId), request.requestId);
  });

  app.post("/v1/subscriptions/:subscriptionId/change-plan", async (request, reply) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    const { subscriptionId } = request.params as { subscriptionId: string };
    const body = z
      .object({
        priceId: z.string().min(1),
        quantity: z.number().int().min(1).optional(),
        timing: z.enum(["IMMEDIATE", "NEXT_PERIOD"]).optional(),
        collectPayment: z.boolean().default(true),
      })
      .parse(request.body);

    const idem = await withIdempotency(
      request,
      reply,
      { prisma, ttlHours: config.IDEMPOTENCY_TTL_HOURS },
      organizationId
    );
    if (idem.replay) return reply.status(idem.status).send(idem.body);

    try {
      const result = await changePlan(prisma, {
        organizationId,
        subscriptionId,
        newPriceId: body.priceId,
        quantity: body.quantity,
        timing: body.timing,
      });

      let payment = null;
      if (result.applied && result.invoiceId && result.netAmount > 0 && body.collectPayment) {
        payment = await attemptInvoicePayment(prisma, providerDeps, {
          organizationId,
          invoiceId: result.invoiceId,
          environment: environmentOf(request),
        }).catch(() => null);
      }

      await recordAudit(prisma, {
        organizationId,
        actorType: "API_KEY",
        action: "subscription.plan_changed",
        resource: "subscription",
        resourceId: subscriptionId,
        metadata: { priceId: body.priceId, timing: body.timing, netAmount: result.netAmount },
        ipAddress: request.ip,
      });

      const payload = success(
        {
          ...result,
          payment,
          subscription: await loadSubscription(prisma, organizationId, subscriptionId),
        },
        request.requestId
      );
      await idem.complete(200, payload);
      return reply.send(payload);
    } catch (error) {
      await releaseIdempotency(prisma, organizationId, request);
      throw error;
    }
  });

  app.post("/v1/subscriptions/:subscriptionId/quantity", async (request) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    const { subscriptionId } = request.params as { subscriptionId: string };
    const body = z.object({ quantity: z.number().int().min(1) }).parse(request.body);

    const result = await changeQuantity(prisma, {
      organizationId,
      subscriptionId,
      quantity: body.quantity,
    });
    return success(
      { ...result, subscription: await loadSubscription(prisma, organizationId, subscriptionId) },
      request.requestId
    );
  });

  app.post("/v1/subscriptions/:subscriptionId/cancel", async (request) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    const { subscriptionId } = request.params as { subscriptionId: string };
    const body = z.object({ atPeriodEnd: z.boolean().default(false) }).parse(request.body ?? {});

    const subscription = await cancelSubscription(prisma, {
      organizationId,
      subscriptionId,
      atPeriodEnd: body.atPeriodEnd,
    });

    await recordAudit(prisma, {
      organizationId,
      actorType: "API_KEY",
      action: body.atPeriodEnd ? "subscription.cancel_scheduled" : "subscription.canceled",
      resource: "subscription",
      resourceId: subscriptionId,
      ipAddress: request.ip,
    });

    return success(subscription, request.requestId);
  });

  app.post("/v1/subscriptions/:subscriptionId/resume", async (request) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    const { subscriptionId } = request.params as { subscriptionId: string };
    return success(await resumeSubscription(prisma, { organizationId, subscriptionId }), request.requestId);
  });

  app.post("/v1/subscriptions/:subscriptionId/pause", async (request) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    const { subscriptionId } = request.params as { subscriptionId: string };
    return success(await pauseSubscription(prisma, { organizationId, subscriptionId }), request.requestId);
  });

  /**
   * Advances the subscription into its next period and issues that invoice.
   * The renewal worker calls the same function on a schedule; exposing it makes
   * the cycle testable without waiting a month.
   */
  app.post("/v1/subscriptions/:subscriptionId/renew", async (request) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    const { subscriptionId } = request.params as { subscriptionId: string };
    const body = z
      .object({
        collectPayment: z.boolean().default(true),
        metadata: z.record(z.unknown()).optional(),
      })
      .parse(request.body ?? {});

    const owned = await prisma.subscription.findFirst({
      where: { id: subscriptionId, organizationId },
      select: { id: true },
    });
    if (!owned) throw BillingError.notFound("SUBSCRIPTION_NOT_FOUND", "Subscription");

    const result = await renewSubscription(prisma, subscriptionId);

    let payment = null;
    if (result.renewed && result.invoiceId && body.collectPayment) {
      payment = await attemptInvoicePayment(prisma, providerDeps, {
        organizationId,
        invoiceId: result.invoiceId,
        environment: environmentOf(request),
        metadata: body.metadata,
      }).catch((error) => {
        if (error instanceof BillingError) {
          return { failed: true, code: error.code, message: error.message };
        }
        throw error;
      });
    }

    return success(
      { ...result, payment, subscription: await loadSubscription(prisma, organizationId, subscriptionId) },
      request.requestId
    );
  });

  app.get("/v1/subscriptions/:subscriptionId/transitions", async (request) => {
    const organizationId = requireOrganization(request);
    const { subscriptionId } = request.params as { subscriptionId: string };
    const owned = await prisma.subscription.findFirst({
      where: { id: subscriptionId, organizationId },
      select: { id: true },
    });
    if (!owned) throw BillingError.notFound("SUBSCRIPTION_NOT_FOUND", "Subscription");

    const transitions = await prisma.subscriptionTransition.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: "asc" },
    });
    return success(transitions, request.requestId);
  });
}

async function loadSubscription(prisma: PrismaClient, organizationId: string, subscriptionId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: { id: subscriptionId, organizationId },
    include: {
      price: { include: { plan: true } },
      customer: { select: { id: true, externalId: true, email: true, name: true } },
      paymentMethod: {
        select: { id: true, type: true, provider: true, brand: true, last4: true, expMonth: true, expYear: true },
      },
    },
  });
  if (!subscription) throw BillingError.notFound("SUBSCRIPTION_NOT_FOUND", "Subscription");
  return subscription;
}
