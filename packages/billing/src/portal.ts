import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient, TransactionClient } from "@tierstack/database";
import { BillingError, loadBranding, newId } from "@tierstack/shared";

/**
 * Billing portal sessions.
 *
 * Lives in the engine rather than in the API app because two callers need it:
 * the merchant minting a link on demand, and the notification job putting one
 * in a dunning email. A customer who cannot reach the portal from the email
 * telling them their payment failed has been told about a problem and handed
 * nothing to fix it with.
 */

/** SHA-256 hex, matching what the API's auth plugin looks a token up by. */
export function hashPortalToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface CreatePortalSessionParams {
  organizationId: string;
  customerId: string;
  /** From the API key that minted this link — a portal action must stay on the same rail the customer's subscription is actually on. */
  environment: "TEST" | "LIVE";
  returnUrl?: string | null;
  /** Short by default: the link travels by email and sits in an inbox. */
  expiresInMinutes?: number;
  now?: Date;
}

export interface CreatedPortalSession {
  id: string;
  /** Returned once. Only the hash is stored. */
  token: string;
  url: string;
  expiresAt: Date;
}

export async function createPortalSession(
  prisma: PrismaClient | TransactionClient,
  params: CreatePortalSessionParams
): Promise<CreatedPortalSession> {
  const customer = await prisma.customer.findFirst({
    where: {
      organizationId: params.organizationId,
      OR: [{ id: params.customerId }, { externalId: params.customerId }],
    },
    select: { id: true },
  });
  if (!customer) throw BillingError.notFound("CUSTOMER_NOT_FOUND", "Customer");

  const token = `${randomUUID().replace(/-/g, "")}${randomBytes(18).toString("base64url")}`;
  const now = params.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (params.expiresInMinutes ?? 60) * 60_000);

  const session = await prisma.portalSession.create({
    data: {
      id: newId("portalSession"),
      organizationId: params.organizationId,
      customerId: customer.id,
      environment: params.environment,
      tokenHash: hashPortalToken(token),
      returnUrl: params.returnUrl ?? null,
      expiresAt,
    },
  });

  const branding = loadBranding();
  return {
    id: session.id,
    token,
    url: `${branding.portalUrl.replace(/\/$/, "")}/s/${token}`,
    expiresAt,
  };
}
