import { createHmac, randomBytes } from "node:crypto";
import type { PrismaClient, TransactionClient } from "@tierstack/database";
import { decryptCredentials, encryptCredentials } from "@tierstack/payments-core";
import { BillingError, newId } from "@tierstack/shared";

/**
 * Outbound webhooks: the platform telling a developer's own application that
 * something happened, rather than the reverse (a provider telling this
 * platform something happened, which is `webhooks.ts`/`WebhookEvent`).
 *
 * A small, curated event catalogue on purpose — the handful of moments almost
 * every integration needs to react to, not a 1:1 mirror of every internal
 * state transition. The dot-notation `type` string is what actually goes out
 * on the wire; the Prisma enum is the internal name for the same thing.
 */
export const OUTBOUND_EVENT_TYPES = {
  SUBSCRIPTION_CREATED: "subscription.created",
  SUBSCRIPTION_ACTIVATED: "subscription.activated",
  SUBSCRIPTION_CANCELED: "subscription.canceled",
  INVOICE_PAID: "invoice.paid",
  INVOICE_PAYMENT_FAILED: "invoice.payment_failed",
} as const;

export type OutboundWebhookEventType = keyof typeof OUTBOUND_EVENT_TYPES;

/**
 * Retries taper off rather than hammering a dead endpoint: 1 min, 5 min,
 * 30 min, 2 hours, then 6 hours apart until the attempt cap. A merchant's
 * endpoint being down for a deploy should not cost it the event; being down
 * for a week should stop costing this platform the delivery attempts.
 */
export const RETRY_SCHEDULE_MINUTES = [1, 5, 30, 120, 360];
export const MAX_DELIVERY_ATTEMPTS = RETRY_SCHEDULE_MINUTES.length + 1;

function nextAttemptDelayMinutes(attemptsSoFar: number): number | null {
  const index = attemptsSoFar - 1;
  return index >= 0 && index < RETRY_SCHEDULE_MINUTES.length
    ? RETRY_SCHEDULE_MINUTES[index]!
    : null;
}

export interface CreateWebhookEndpointResult {
  id: string;
  url: string;
  /** Shown once. Only its ciphertext is ever stored — a database leak on its own signs nothing. */
  secret: string;
  enabled: boolean;
  createdAt: Date;
}

export async function createWebhookEndpoint(
  prisma: PrismaClient,
  params: { organizationId: string; url: string }
): Promise<CreateWebhookEndpointResult> {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      id: newId("webhookEndpoint"),
      organizationId: params.organizationId,
      url: params.url,
      encryptedSecret: encryptCredentials({ secret }, params.organizationId, process.env.ENCRYPTION_KEY),
    },
  });
  return {
    id: endpoint.id,
    url: endpoint.url,
    secret,
    enabled: endpoint.enabled,
    createdAt: endpoint.createdAt,
  };
}

/**
 * Records that an event happened, for every enabled endpoint the organization
 * has. Delivery itself happens later, out of band — this only ever does a
 * fast, transactional write, so a slow or unreachable endpoint can never make
 * the billing operation that triggered the event any slower.
 */
export async function dispatchWebhookEvent(
  tx: TransactionClient,
  params: {
    organizationId: string;
    eventType: OutboundWebhookEventType;
    data: Record<string, unknown>;
    now?: Date;
  }
): Promise<void> {
  const endpoints = await tx.webhookEndpoint.findMany({
    where: { organizationId: params.organizationId, enabled: true },
    select: { id: true },
  });
  if (endpoints.length === 0) return;

  const now = params.now ?? new Date();
  const eventId = newId("webhookDelivery");
  const payload = {
    id: eventId,
    type: OUTBOUND_EVENT_TYPES[params.eventType],
    createdAt: now.toISOString(),
    data: params.data,
  };

  await tx.webhookDelivery.createMany({
    data: endpoints.map((endpoint) => ({
      id: newId("webhookDelivery"),
      organizationId: params.organizationId,
      endpointId: endpoint.id,
      eventType: params.eventType,
      payload: payload as never,
      nextAttemptAt: now,
    })),
  });
}

/** HMAC-SHA256 over `${timestamp}.${rawBody}`, matching the header a receiver is told to verify against. */
export function signOutboundWebhook(secret: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export async function decryptEndpointSecret(
  encryptedSecret: string,
  organizationId: string
): Promise<string> {
  const { secret } = decryptCredentials<{ secret: string }>(
    encryptedSecret,
    organizationId,
    process.env.ENCRYPTION_KEY
  );
  return secret;
}

export interface RecordDeliveryAttemptParams {
  deliveryId: string;
  ok: boolean;
  responseStatus: number | null;
  responseBody: string | null;
  now?: Date;
}

/**
 * Applies the outcome of one delivery attempt: success closes it out,
 * failure schedules the next attempt per the backoff schedule or gives up
 * once `MAX_DELIVERY_ATTEMPTS` is reached.
 */
export async function recordDeliveryAttempt(
  prisma: PrismaClient,
  params: RecordDeliveryAttemptParams
): Promise<void> {
  const now = params.now ?? new Date();
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: params.deliveryId } });
  if (!delivery) throw BillingError.notFound("WEBHOOK_DELIVERY_NOT_FOUND", "Webhook delivery");

  const attempts = delivery.attempts + 1;

  if (params.ok) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "DELIVERED",
        attempts,
        lastAttemptAt: now,
        responseStatus: params.responseStatus,
        responseBody: params.responseBody?.slice(0, 2000) ?? null,
      },
    });
    return;
  }

  const delayMinutes = nextAttemptDelayMinutes(attempts);
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: delayMinutes === null ? "FAILED" : "PENDING",
      attempts,
      lastAttemptAt: now,
      nextAttemptAt:
        delayMinutes === null ? delivery.nextAttemptAt : new Date(now.getTime() + delayMinutes * 60_000),
      responseStatus: params.responseStatus,
      responseBody: params.responseBody?.slice(0, 2000) ?? null,
    },
  });
}
