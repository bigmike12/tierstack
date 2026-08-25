import type { PrismaClient } from "@tierstack/database";
import { instantiateProvider } from "@tierstack/billing";
import { encryptCredentials } from "@tierstack/payments-core";
import { BillingError, newId, success } from "@tierstack/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireActor, requireOrganization, requireRole } from "../context";
import type { AppConfig } from "../env";
import { recordAudit } from "../lib/audit";
import type { RedisClient } from "../lib/redis";

const createSchema = z.object({
  provider: z.enum(["PAYSTACK", "MONNIFY", "FLUTTERWAVE", "MOCK"]),
  environment: z.enum(["TEST", "LIVE"]).default("TEST"),
  /** Free-form per-provider credentials; encrypted before storage. */
  credentials: z.record(z.string()),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  priority: z.number().int().min(0).max(1000).default(100),
  routingRules: z
    .object({
      currencies: z.array(z.string().length(3)).optional(),
      countries: z.array(z.string().length(2)).optional(),
      methods: z.array(z.string()).optional(),
    })
    .optional(),
});

const updateSchema = createSchema.partial().omit({ provider: true, environment: true });

export function registerPaymentProviderRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  config: AppConfig,
  redis: RedisClient
): void {
  const deps = { redis, checkoutBaseUrl: config.API_URL, encryptionKey: config.ENCRYPTION_KEY };

  app.get("/v1/payment-providers", async (request) => {
    const organizationId = requireOrganization(request);
    const configs = await prisma.paymentProviderConfig.findMany({
      where: { organizationId },
      orderBy: [{ environment: "asc" }, { priority: "asc" }],
    });
    // Credentials are never returned, not even in encrypted form.
    return success(
      configs.map((c) => ({
        id: c.id,
        provider: c.provider,
        environment: c.environment,
        enabled: c.enabled,
        isDefault: c.isDefault,
        priority: c.priority,
        routingRules: c.routingRules,
        lastTestedAt: c.lastTestedAt,
        lastTestStatus: c.lastTestStatus,
        capabilities: safeCapabilities(c, deps),
        createdAt: c.createdAt,
      })),
      request.requestId
    );
  });

  app.post("/v1/payment-providers", async (request, reply) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const actor = requireActor(request);
    const body = createSchema.parse(request.body);

    const encrypted = encryptCredentials(body.credentials, organizationId, config.ENCRYPTION_KEY);

    const record = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.paymentProviderConfig.updateMany({
          where: { organizationId, environment: body.environment },
          data: { isDefault: false },
        });
      }
      return tx.paymentProviderConfig.upsert({
        where: {
          organizationId_provider_environment: {
            organizationId,
            provider: body.provider,
            environment: body.environment,
          },
        },
        create: {
          id: newId("providerConfig"),
          organizationId,
          provider: body.provider,
          environment: body.environment,
          encryptedCredentials: encrypted,
          enabled: body.enabled,
          isDefault: body.isDefault,
          priority: body.priority,
          routingRules: (body.routingRules ?? null) as never,
        },
        update: {
          encryptedCredentials: encrypted,
          enabled: body.enabled,
          isDefault: body.isDefault,
          priority: body.priority,
          routingRules: (body.routingRules ?? null) as never,
        },
      });
    });

    await recordAudit(prisma, {
      organizationId,
      actorType: actor.kind,
      userId: actor.kind === "USER" ? actor.userId : null,
      action: "payment_provider.configured",
      resource: "payment_provider_config",
      resourceId: record.id,
      // The credentials themselves are deliberately absent from the audit trail.
      metadata: { provider: body.provider, environment: body.environment },
      ipAddress: request.ip,
    });

    return reply.status(201).send(
      success(
        {
          id: record.id,
          provider: record.provider,
          environment: record.environment,
          enabled: record.enabled,
          isDefault: record.isDefault,
          priority: record.priority,
        },
        request.requestId
      )
    );
  });

  app.patch("/v1/payment-providers/:configId", async (request) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const { configId } = request.params as { configId: string };
    const body = updateSchema.parse(request.body);

    const existing = await prisma.paymentProviderConfig.findFirst({
      where: { id: configId, organizationId },
    });
    if (!existing) throw BillingError.notFound("PROVIDER_CONFIG_NOT_FOUND", "Payment provider configuration");

    const data: Record<string, unknown> = {};
    if (body.credentials) {
      data.encryptedCredentials = encryptCredentials(body.credentials, organizationId, config.ENCRYPTION_KEY);
    }
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.routingRules !== undefined) data.routingRules = body.routingRules;

    const updated = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.paymentProviderConfig.updateMany({
          where: { organizationId, environment: existing.environment },
          data: { isDefault: false },
        });
        data.isDefault = true;
      }
      return tx.paymentProviderConfig.update({ where: { id: existing.id }, data: data as never });
    });

    return success(
      {
        id: updated.id,
        provider: updated.provider,
        environment: updated.environment,
        enabled: updated.enabled,
        isDefault: updated.isDefault,
        priority: updated.priority,
        routingRules: updated.routingRules,
      },
      request.requestId
    );
  });

  /** Round-trips the stored credentials through the adapter's own health check. */
  app.post("/v1/payment-providers/:configId/test", async (request) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const { configId } = request.params as { configId: string };

    const stored = await prisma.paymentProviderConfig.findFirst({
      where: { id: configId, organizationId },
    });
    if (!stored) throw BillingError.notFound("PROVIDER_CONFIG_NOT_FOUND", "Payment provider configuration");

    let result: { ok: boolean; message: string };
    try {
      const provider = instantiateProvider(
        {
          id: stored.id,
          organizationId: stored.organizationId,
          provider: stored.provider as never,
          environment: stored.environment as "TEST" | "LIVE",
          encryptedCredentials: stored.encryptedCredentials,
          enabled: stored.enabled,
          isDefault: stored.isDefault,
          priority: stored.priority,
          routingRules: stored.routingRules,
        },
        deps
      );
      result = await provider.testCredentials();
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : "Adapter unavailable." };
    }

    await prisma.paymentProviderConfig.update({
      where: { id: stored.id },
      data: { lastTestedAt: new Date(), lastTestStatus: result.ok ? "OK" : "FAILED" },
    });

    return success(result, request.requestId);
  });

  app.delete("/v1/payment-providers/:configId", async (request) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const { configId } = request.params as { configId: string };
    const existing = await prisma.paymentProviderConfig.findFirst({
      where: { id: configId, organizationId },
    });
    if (!existing) throw BillingError.notFound("PROVIDER_CONFIG_NOT_FOUND", "Payment provider configuration");

    await prisma.paymentProviderConfig.delete({ where: { id: existing.id } });
    await recordAudit(prisma, {
      organizationId,
      actorType: "USER",
      action: "payment_provider.removed",
      resource: "payment_provider_config",
      resourceId: existing.id,
      metadata: { provider: existing.provider },
      ipAddress: request.ip,
    });
    return success({ deleted: true }, request.requestId);
  });
}

function safeCapabilities(
  stored: {
    id: string;
    organizationId: string;
    provider: string;
    environment: string;
    encryptedCredentials: string;
    enabled: boolean;
    isDefault: boolean;
    priority: number;
    routingRules: unknown;
  },
  deps: { redis: RedisClient; checkoutBaseUrl: string; encryptionKey: string }
): unknown {
  try {
    return instantiateProvider(
      {
        id: stored.id,
        organizationId: stored.organizationId,
        provider: stored.provider as never,
        environment: stored.environment as "TEST" | "LIVE",
        encryptedCredentials: stored.encryptedCredentials,
        enabled: stored.enabled,
        isDefault: stored.isDefault,
        priority: stored.priority,
        routingRules: stored.routingRules,
      },
      deps
    ).getCapabilities();
  } catch {
    // An adapter that is not implemented reports no capabilities rather than
    // a fabricated set.
    return null;
  }
}
