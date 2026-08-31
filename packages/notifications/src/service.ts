import type { PrismaClient } from "@tierstack/database";
import { newId } from "@tierstack/shared";
import type { RenderedEmail } from "./templates";
import { EmailDeliveryError, type EmailTransport } from "./types";

/**
 * How long a claimed-but-unsent message is left alone before another run may
 * pick it up. A process that died between claiming the row and calling the
 * provider should not silence the message forever; a run that is merely slow
 * should not race it into a duplicate.
 */
const STALE_CLAIM_MS = 15 * 60 * 1000;

/**
 * A permanently broken sender — an unverified domain, a revoked API key —
 * fails identically every time. Without a ceiling, the job that finds it
 * every 5 minutes forever would retry it forever, indistinguishable in the
 * logs from a rail that is actually recovering.
 */
export const MAX_EMAIL_ATTEMPTS = 5;

export interface SendOnceParams {
  organizationId: string;
  /**
   * What makes this message unique. Not a random id: it must be derivable from
   * the same state next time the job runs, because that is what makes running
   * the job twice safe. `payment_failed:inv_123:2` is the second failure on one
   * invoice, and it can only ever be sent once.
   */
  dedupeKey: string;
  type: string;
  toEmail: string;
  from: string;
  fromName?: string | null;
  replyTo?: string | null;
  email: RenderedEmail;
  customerId?: string | null;
  subscriptionId?: string | null;
  invoiceId?: string | null;
  /** False records the decision without sending — the org has email switched off. */
  enabled: boolean;
}

export type SendOnceResult =
  | { sent: true; messageId: string; providerMessageId: string | null }
  | {
      sent: false;
      reason: "ALREADY_SENT" | "IN_FLIGHT" | "SUPPRESSED" | "FAILED" | "EXHAUSTED";
      messageId: string | null;
    };

/**
 * Sends a message at most once per decision.
 *
 * The row is claimed before the provider is called, not after. That ordering is
 * the whole point: if the process dies mid-send, the evidence is a PENDING row
 * naming the customer and the reason, rather than an inbox that never received
 * anything and a log that says nothing happened.
 */
export async function sendOnce(
  prisma: PrismaClient,
  transport: EmailTransport,
  params: SendOnceParams,
  now = new Date()
): Promise<SendOnceResult> {
  const existing = await prisma.emailMessage.findUnique({
    where: { organizationId_dedupeKey: { organizationId: params.organizationId, dedupeKey: params.dedupeKey } },
  });

  if (existing) {
    if (existing.status === "SENT") return { sent: false, reason: "ALREADY_SENT", messageId: existing.id };
    if (existing.status === "SUPPRESSED") return { sent: false, reason: "SUPPRESSED", messageId: existing.id };
    if (
      existing.status === "PENDING" &&
      now.getTime() - existing.updatedAt.getTime() < STALE_CLAIM_MS
    ) {
      return { sent: false, reason: "IN_FLIGHT", messageId: existing.id };
    }
    if (existing.status === "FAILED" && existing.attempts >= MAX_EMAIL_ATTEMPTS) {
      return { sent: false, reason: "EXHAUSTED", messageId: existing.id };
    }
    // PENDING and stale, or FAILED with attempts left: worth another attempt.
  }

  if (!params.enabled) {
    const suppressed = await upsertClaim(prisma, params, "SUPPRESSED", now, { countsAsAttempt: false });
    return { sent: false, reason: "SUPPRESSED", messageId: suppressed.id };
  }

  const claim = await upsertClaim(prisma, params, "PENDING", now, { countsAsAttempt: true });

  try {
    const result = await transport.send({
      to: params.toEmail,
      from: params.from,
      fromName: params.fromName ?? null,
      replyTo: params.replyTo ?? null,
      subject: params.email.subject,
      text: params.email.text,
      html: params.email.html,
    });

    await prisma.emailMessage.update({
      where: { id: claim.id },
      data: {
        status: "SENT",
        provider: transport.kind,
        providerMessageId: result.providerMessageId,
        failureReason: null,
        sentAt: new Date(),
      },
    });

    return { sent: true, messageId: claim.id, providerMessageId: result.providerMessageId };
  } catch (error) {
    await prisma.emailMessage.update({
      where: { id: claim.id },
      data: {
        status: "FAILED",
        provider: transport.kind,
        failureReason:
          error instanceof EmailDeliveryError || error instanceof Error
            ? error.message
            : "The email provider returned an error.",
      },
    });
    // Not rethrown: a message that could not be delivered must not abort the
    // job that was also collecting money. The row records what happened.
    return { sent: false, reason: "FAILED", messageId: claim.id };
  }
}

async function upsertClaim(
  prisma: PrismaClient,
  params: SendOnceParams,
  status: "PENDING" | "SUPPRESSED",
  now: Date,
  options: { countsAsAttempt: boolean }
) {
  return prisma.emailMessage.upsert({
    where: {
      organizationId_dedupeKey: { organizationId: params.organizationId, dedupeKey: params.dedupeKey },
    },
    create: {
      id: newId("emailMessage"),
      organizationId: params.organizationId,
      customerId: params.customerId ?? null,
      subscriptionId: params.subscriptionId ?? null,
      invoiceId: params.invoiceId ?? null,
      type: params.type,
      dedupeKey: params.dedupeKey,
      toEmail: params.toEmail,
      subject: params.email.subject,
      status,
      attempts: options.countsAsAttempt ? 1 : 0,
    },
    update: {
      status,
      subject: params.email.subject,
      updatedAt: now,
      ...(options.countsAsAttempt ? { attempts: { increment: 1 } } : {}),
    },
  });
}
