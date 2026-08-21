import { createHash } from "node:crypto";
import { applyPaymentResult, instantiateProvider } from "@billing-platform/billing";
import type { PrismaClient } from "@billing-platform/database";
import { BillingError, newId, success } from "@billing-platform/shared";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../env";
import type { RedisClient } from "../lib/redis";

type ProviderKind = "PAYSTACK" | "MONNIFY" | "FLUTTERWAVE" | "MOCK";

/**
 * Provider webhook intake.
 *
 * The handler does the minimum: verify the signature, de-duplicate, persist the
 * raw event, then apply the outcome. Verification never trusts the payload's
 * claim of success — it asks the provider what actually happened before any
 * billing state moves.
 */
export function registerWebhookRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  config: AppConfig,
  redis: RedisClient
): void {
  const deps = { redis, checkoutBaseUrl: config.API_URL, encryptionKey: config.ENCRYPTION_KEY };

  for (const kind of ["mock", "paystack", "monnify", "flutterwave"] as const) {
    app.post(`/webhooks/${kind}`, { config: { rawBody: true } }, async (request, reply) => {
      const provider = kind.toUpperCase() as ProviderKind;
      const rawBody = Buffer.isBuffer(request.body)
        ? request.body
        : Buffer.from(typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {}));

      // The organization is identified by the reference inside the payload, so
      // one endpoint per provider serves every tenant.
      const organizationId = await resolveOrganization(prisma, rawBody);
      if (!organizationId) {
        await prisma.webhookEvent.create({
          data: {
            id: newId("webhookEvent"),
            organizationId: null,
            provider,
            providerEventId: `unmatched_${createHash("sha256").update(rawBody).digest("hex").slice(0, 32)}`,
            eventType: "unmatched",
            rawPayload: safeJson(rawBody) as never,
            signatureVerified: false,
            status: "IGNORED",
            errorMessage: "No payment attempt in this deployment matches the event reference.",
          },
        }).catch(() => undefined);
        return reply.status(202).send(success({ received: true, matched: false }, request.requestId));
      }

      const stored = await prisma.paymentProviderConfig.findFirst({
        where: { organizationId, provider },
      });
      if (!stored) {
        throw new BillingError(
          "PROVIDER_CONFIG_NOT_FOUND",
          `No ${provider} configuration for the organization this event belongs to.`
        );
      }

      const adapter = instantiateProvider(
        {
          id: stored.id,
          organizationId,
          provider,
          environment: stored.environment as "TEST" | "LIVE",
          encryptedCredentials: stored.encryptedCredentials,
          enabled: stored.enabled,
          isDefault: stored.isDefault,
          priority: stored.priority,
          routingRules: stored.routingRules,
        },
        deps
      );

      const verification = await adapter.verifyWebhook({ headers: request.headers, rawBody });
      if (!verification.verified) {
        await prisma.webhookEvent.create({
          data: {
            id: newId("webhookEvent"),
            organizationId,
            provider,
            providerEventId: `unverified_${createHash("sha256").update(rawBody).digest("hex").slice(0, 32)}`,
            eventType: "unverified",
            rawPayload: safeJson(rawBody) as never,
            signatureVerified: false,
            status: "FAILED",
            errorMessage: verification.reason ?? "Signature verification failed.",
          },
        }).catch(() => undefined);
        throw new BillingError("FORBIDDEN", verification.reason ?? "Webhook signature verification failed.");
      }

      const event = await adapter.normalizeWebhook(verification.payload);

      // Unique on (organizationId, provider, providerEventId): a replayed
      // delivery collides here and is acknowledged without reprocessing.
      const existing = await prisma.webhookEvent.findUnique({
        where: {
          organizationId_provider_providerEventId: {
            organizationId,
            provider,
            providerEventId: event.providerEventId,
          },
        },
      });
      if (existing) {
        return reply.send(
          success({ received: true, duplicate: true, status: existing.status }, request.requestId)
        );
      }

      const record = await prisma.webhookEvent.create({
        data: {
          id: newId("webhookEvent"),
          organizationId,
          provider,
          providerEventId: event.providerEventId,
          eventType: event.rawEventType,
          rawPayload: safeJson(rawBody) as never,
          signatureVerified: true,
          status: "PROCESSING",
          processingAttempts: 1,
        },
      });

      try {
        if (event.reference && event.type !== "UNKNOWN") {
          // Ask the provider directly instead of believing the payload.
          const verified = await adapter.verifyPayment(event.reference);
          await applyPaymentResult(prisma, {
            organizationId,
            attemptId: event.reference,
            result: verified,
          });
        }
        await prisma.webhookEvent.update({
          where: { id: record.id },
          data: { status: "PROCESSED", processedAt: new Date() },
        });
      } catch (error) {
        await prisma.webhookEvent.update({
          where: { id: record.id },
          data: {
            status: "FAILED",
            errorMessage: error instanceof Error ? error.message : "Processing failed.",
          },
        });
        throw error;
      }

      return success({ received: true, duplicate: false, eventId: record.id }, request.requestId);
    });
  }
}

/**
 * The payment reference is this platform's own PaymentAttempt id, so the
 * owning organization is a single lookup away.
 */
async function resolveOrganization(prisma: PrismaClient, rawBody: Buffer): Promise<string | null> {
  const payload = safeJson(rawBody) as { data?: { reference?: unknown } ; reference?: unknown } | null;
  const reference =
    typeof payload?.data?.reference === "string"
      ? payload.data.reference
      : typeof payload?.reference === "string"
        ? payload.reference
        : null;
  if (!reference) return null;

  const attempt = await prisma.paymentAttempt.findUnique({
    where: { id: reference },
    select: { organizationId: true },
  });
  return attempt?.organizationId ?? null;
}

function safeJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return { unparsed: raw.toString("utf8").slice(0, 2000) };
  }
}
