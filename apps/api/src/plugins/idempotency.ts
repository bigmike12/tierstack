import { createHash } from "node:crypto";
import type { PrismaClient } from "@billing-platform/database";
import { BillingError, newId } from "@billing-platform/shared";
import type { FastifyReply, FastifyRequest } from "fastify";

export interface IdempotencyOptions {
  prisma: PrismaClient;
  ttlHours: number;
}

function canonicalise(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(",")}}`;
}

export function requestHash(method: string, url: string, body: unknown): string {
  return createHash("sha256").update(`${method} ${url} ${canonicalise(body)}`).digest("hex");
}

export interface IdempotencyHit {
  replay: true;
  status: number;
  body: unknown;
}

export interface IdempotencyMiss {
  replay: false;
  /** Call once the handler has produced its response. */
  complete: (status: number, body: unknown) => Promise<void>;
}

/**
 * Idempotency for money-moving endpoints.
 *
 * A repeat of the same key with the same body replays the stored response. A
 * repeat with a *different* body is rejected with IDEMPOTENCY_KEY_REUSE rather
 * than being answered from cache — silently returning the first response for a
 * different request is how double charges happen.
 */
export async function withIdempotency(
  request: FastifyRequest,
  reply: FastifyReply,
  options: IdempotencyOptions,
  organizationId: string
): Promise<IdempotencyHit | IdempotencyMiss> {
  const header = request.headers["idempotency-key"];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key) return { replay: false, complete: async () => undefined };

  if (key.length > 255) {
    throw new BillingError("VALIDATION_ERROR", "Idempotency-Key must be at most 255 characters.");
  }

  const endpoint = `${request.method} ${request.routeOptions?.url ?? request.url}`;
  const hash = requestHash(request.method, endpoint, request.body);
  const expiresAt = new Date(Date.now() + options.ttlHours * 3_600_000);

  const existing = await options.prisma.idempotencyKey.findUnique({
    where: { organizationId_key_endpoint: { organizationId, key, endpoint } },
  });

  if (existing) {
    if (existing.requestHash !== hash) {
      throw new BillingError(
        "IDEMPOTENCY_KEY_REUSE",
        "This Idempotency-Key was already used with a different request body."
      );
    }
    if (existing.status === "COMPLETED") {
      reply.header("idempotent-replay", "true");
      return { replay: true, status: existing.responseStatus ?? 200, body: existing.response };
    }
    throw new BillingError(
      "IDEMPOTENCY_REQUEST_IN_PROGRESS",
      "A request with this Idempotency-Key is still in flight. Retry shortly."
    );
  }

  try {
    await options.prisma.idempotencyKey.create({
      data: {
        id: newId("idempotency"),
        organizationId,
        key,
        endpoint,
        requestHash: hash,
        status: "IN_PROGRESS",
        expiresAt,
      },
    });
  } catch (error) {
    // Lost a race with a concurrent identical request.
    if ((error as { code?: string }).code === "P2002") {
      throw new BillingError(
        "IDEMPOTENCY_REQUEST_IN_PROGRESS",
        "A request with this Idempotency-Key is already being processed."
      );
    }
    throw error;
  }

  return {
    replay: false,
    complete: async (status: number, body: unknown) => {
      await options.prisma.idempotencyKey
        .update({
          where: { organizationId_key_endpoint: { organizationId, key, endpoint } },
          data: { status: "COMPLETED", responseStatus: status, response: body as never },
        })
        .catch(() => undefined);
    },
  };
}

/** Removes an in-progress record so a failed call can be retried with the same key. */
export async function releaseIdempotency(
  prisma: PrismaClient,
  organizationId: string,
  request: FastifyRequest
): Promise<void> {
  const header = request.headers["idempotency-key"];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key) return;
  const endpoint = `${request.method} ${request.routeOptions?.url ?? request.url}`;
  await prisma.idempotencyKey
    .deleteMany({ where: { organizationId, key, endpoint, status: "IN_PROGRESS" } })
    .catch(() => undefined);
}
