import type { PrismaClient } from "@tierstack/database";
import { BillingError } from "@tierstack/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../env";
import { hashApiKey, hashToken, parseApiKey } from "../lib/api-keys";
import type { MemberRole } from "../context";

export const SESSION_COOKIE = "tb_session";

/** Routes that must be reachable without credentials. */
const PUBLIC_PREFIXES = [
  "/health",
  "/v1/auth/register",
  "/v1/auth/login",
  "/webhooks/",
  "/mock/checkout",
];

export function registerAuth(app: FastifyInstance, prisma: PrismaClient, config: AppConfig): void {
  app.addHook("preHandler", async (request) => {
    if (PUBLIC_PREFIXES.some((prefix) => request.url.startsWith(prefix))) return;

    const apiKeySecret = readBearer(request);
    if (apiKeySecret) {
      await authenticateApiKey(request, prisma, apiKeySecret);
      return;
    }

    const sessionToken = request.cookies[SESSION_COOKIE];
    if (sessionToken) {
      await authenticateSession(request, prisma, sessionToken, config);
      return;
    }

    throw new BillingError(
      "UNAUTHENTICATED",
      "Send an API key as `Authorization: Bearer sk_...`, or sign in to the dashboard."
    );
  });
}

function readBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header || Array.isArray(header)) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

async function authenticateApiKey(
  request: FastifyRequest,
  prisma: PrismaClient,
  secret: string
): Promise<void> {
  const parsed = parseApiKey(secret);
  if (!parsed) {
    throw new BillingError("INVALID_API_KEY", "That does not look like a valid API key.");
  }

  const record = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(secret) } });
  if (!record) {
    throw new BillingError("INVALID_API_KEY", "This API key is not recognised.");
  }
  if (record.revokedAt) {
    throw new BillingError("API_KEY_REVOKED", "This API key has been revoked.");
  }

  request.actor = {
    kind: "API_KEY",
    apiKeyId: record.id,
    organizationId: record.organizationId,
    environment: record.environment as "TEST" | "LIVE",
    type: record.type as "PUBLIC" | "SECRET",
  };
  // Tenancy comes from the key itself — a body or header value can never
  // redirect an API-key request at another organization.
  request.organizationId = record.organizationId;
  request.environment = record.environment as "TEST" | "LIVE";

  // Touch lastUsedAt without blocking the request.
  void prisma.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
}

async function authenticateSession(
  request: FastifyRequest,
  prisma: PrismaClient,
  token: string,
  config: AppConfig
): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    throw new BillingError("UNAUTHENTICATED", "Your session has expired. Sign in again.");
  }

  request.actor = {
    kind: "USER",
    userId: session.userId,
    email: session.user.email,
    sessionId: session.id,
  };
  request.environment = config.BILLING_ENV === "live" ? "LIVE" : "TEST";

  const requested = request.headers["x-organization-id"];
  const requestedId = Array.isArray(requested) ? requested[0] : requested;

  const memberships = await prisma.organizationMember.findMany({
    where: { userId: session.userId, removedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) return;

  // The header only selects among organizations the user already belongs to.
  const membership = requestedId
    ? memberships.find((m) => m.organizationId === requestedId)
    : memberships[0];

  if (requestedId && !membership) {
    throw new BillingError(
      "CROSS_TENANT_ACCESS",
      "You are not a member of the requested organization."
    );
  }
  if (!membership) return;

  request.organizationId = membership.organizationId;
  request.memberRole = membership.role as MemberRole;
}
