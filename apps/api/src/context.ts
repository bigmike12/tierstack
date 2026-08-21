import type { PrismaClient } from "@tierbase/database";
import { BillingError } from "@tierbase/shared";
import type { FastifyRequest } from "fastify";

export type MemberRole = "OWNER" | "ADMIN" | "MEMBER";

export interface ApiKeyActor {
  kind: "API_KEY";
  apiKeyId: string;
  organizationId: string;
  environment: "TEST" | "LIVE";
  type: "PUBLIC" | "SECRET";
}

export interface UserActor {
  kind: "USER";
  userId: string;
  email: string;
  sessionId: string;
}

export type Actor = ApiKeyActor | UserActor;

declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
    actor?: Actor;
    /** Resolved tenant. Never read from the request body. */
    organizationId?: string;
    memberRole?: MemberRole;
    environment?: "TEST" | "LIVE";
  }
}

const ROLE_RANK: Record<MemberRole, number> = { MEMBER: 1, ADMIN: 2, OWNER: 3 };

export function requireActor(request: FastifyRequest): Actor {
  if (!request.actor) {
    throw new BillingError("UNAUTHENTICATED", "Authentication is required for this endpoint.");
  }
  return request.actor;
}

/**
 * The tenant for this request. Resolved from the API key, or — for dashboard
 * sessions — from a membership lookup. A client-supplied organization id is
 * only ever used to *select* among the caller's own memberships, never trusted
 * on its own.
 */
export function requireOrganization(request: FastifyRequest): string {
  if (!request.organizationId) {
    throw new BillingError(
      "FORBIDDEN",
      "No organization is in scope for this request. Send an API key, or set the x-organization-id header."
    );
  }
  return request.organizationId;
}

export function requireSecretKeyOrUser(request: FastifyRequest): Actor {
  const actor = requireActor(request);
  if (actor.kind === "API_KEY" && actor.type === "PUBLIC") {
    throw new BillingError(
      "INSUFFICIENT_PERMISSIONS",
      "This endpoint requires a secret key. Publishable keys are read-only and safe for browsers."
    );
  }
  return actor;
}

export function requireRole(request: FastifyRequest, minimum: MemberRole): void {
  const actor = requireActor(request);
  // A secret API key acts with the organization's full authority by design;
  // per-key permission scopes narrow it further where configured.
  if (actor.kind === "API_KEY") return;
  const role = request.memberRole;
  if (!role || ROLE_RANK[role] < ROLE_RANK[minimum]) {
    throw new BillingError(
      "INSUFFICIENT_PERMISSIONS",
      `This action requires the ${minimum} role or higher.`
    );
  }
}

export function environmentOf(request: FastifyRequest): "TEST" | "LIVE" {
  return request.environment ?? "TEST";
}

/** Belt-and-braces check for handlers that load a row by id first. */
export function assertSameTenant(
  resource: { organizationId: string } | null,
  organizationId: string,
  notFoundCode: Parameters<typeof BillingError.notFound>[0],
  label: string
): void {
  if (!resource) throw BillingError.notFound(notFoundCode, label);
  if (resource.organizationId !== organizationId) {
    // Reported as "not found" so the API never confirms the existence of
    // another tenant's resource.
    throw BillingError.notFound(notFoundCode, label);
  }
}

export interface AppServices {
  prisma: PrismaClient;
}
