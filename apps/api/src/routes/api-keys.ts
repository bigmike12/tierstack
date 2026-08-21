import type { PrismaClient } from "@billing-platform/database";
import { BillingError, newId, success } from "@billing-platform/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireActor, requireOrganization, requireRole } from "../context";
import { generateApiKey } from "../lib/api-keys";
import { recordAudit } from "../lib/audit";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(["PUBLIC", "SECRET"]).default("SECRET"),
  environment: z.enum(["TEST", "LIVE"]).default("TEST"),
  permissions: z.array(z.string()).default([]),
});

export function registerApiKeyRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  /**
   * Returns the raw secret exactly once. Only its SHA-256 hash and a short
   * display prefix are persisted, so a lost key can never be recovered — only
   * revoked and replaced.
   */
  app.post("/v1/api-keys", async (request, reply) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const actor = requireActor(request);
    const body = createSchema.parse(request.body);

    const generated = generateApiKey(body.type, body.environment);
    const record = await prisma.apiKey.create({
      data: {
        id: newId("apiKey"),
        organizationId,
        name: body.name,
        type: body.type,
        environment: body.environment,
        prefix: generated.prefix,
        keyHash: generated.keyHash,
        permissions: body.permissions,
        createdBy: actor.kind === "USER" ? actor.userId : actor.apiKeyId,
      },
    });

    await recordAudit(prisma, {
      organizationId,
      actorType: actor.kind,
      userId: actor.kind === "USER" ? actor.userId : null,
      action: "api_key.created",
      resource: "api_key",
      resourceId: record.id,
      metadata: { type: body.type, environment: body.environment, prefix: generated.prefix },
      ipAddress: request.ip,
    });

    return reply.status(201).send(
      success(
        {
          id: record.id,
          name: record.name,
          type: record.type,
          environment: record.environment,
          prefix: record.prefix,
          createdAt: record.createdAt,
          secret: generated.secret,
          warning: "This is the only time the full key is shown. Store it somewhere safe.",
        },
        request.requestId
      )
    );
  });

  app.get("/v1/api-keys", async (request) => {
    const organizationId = requireOrganization(request);
    const keys = await prisma.apiKey.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        type: true,
        environment: true,
        prefix: true,
        permissions: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    return success(keys, request.requestId);
  });

  app.delete("/v1/api-keys/:keyId", async (request) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const actor = requireActor(request);
    const { keyId } = request.params as { keyId: string };

    const key = await prisma.apiKey.findFirst({ where: { id: keyId, organizationId } });
    if (!key) throw BillingError.notFound("API_KEY_NOT_FOUND", "API key");
    if (key.revokedAt) return success({ revoked: true, revokedAt: key.revokedAt }, request.requestId);

    const updated = await prisma.apiKey.update({
      where: { id: key.id },
      data: { revokedAt: new Date() },
    });

    await recordAudit(prisma, {
      organizationId,
      actorType: actor.kind,
      userId: actor.kind === "USER" ? actor.userId : null,
      action: "api_key.revoked",
      resource: "api_key",
      resourceId: key.id,
      metadata: { prefix: key.prefix },
      ipAddress: request.ip,
    });

    return success({ revoked: true, revokedAt: updated.revokedAt }, request.requestId);
  });
}
