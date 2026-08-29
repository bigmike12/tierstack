import { createWebhookEndpoint } from "@tierstack/billing";
import type { PrismaClient } from "@tierstack/database";
import { BillingError, paginated, parsePageQuery, success } from "@tierstack/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireActor, requireOrganization, requireRole } from "../context";
import { recordAudit } from "../lib/audit";

const createSchema = z.object({
  url: z.string().url(),
});

/**
 * Endpoint registration and the delivery log for outbound webhooks — the
 * platform telling a developer's own application that something happened.
 * See `webhooks.ts` for the reverse direction: a provider telling this
 * platform something happened.
 */
export function registerWebhookEndpointRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.post("/v1/webhook-endpoints", async (request, reply) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const actor = requireActor(request);
    const body = createSchema.parse(request.body);

    const endpoint = await createWebhookEndpoint(prisma, { organizationId, url: body.url });

    await recordAudit(prisma, {
      organizationId,
      actorType: actor.kind,
      userId: actor.kind === "USER" ? actor.userId : null,
      action: "webhook_endpoint.created",
      resource: "webhook_endpoint",
      resourceId: endpoint.id,
      metadata: { url: endpoint.url },
      ipAddress: request.ip,
    });

    return reply.status(201).send(
      success(
        {
          id: endpoint.id,
          url: endpoint.url,
          // Shown exactly once. Only its ciphertext is ever stored — losing
          // this response means generating a new endpoint, the same way a
          // lost API key secret does.
          secret: endpoint.secret,
          enabled: endpoint.enabled,
          createdAt: endpoint.createdAt,
        },
        request.requestId
      )
    );
  });

  /** Never returns the secret — not even in encrypted form. */
  app.get("/v1/webhook-endpoints", async (request) => {
    const organizationId = requireOrganization(request);
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      select: { id: true, url: true, enabled: true, createdAt: true, disabledAt: true },
    });
    return success(endpoints, request.requestId);
  });

  app.patch("/v1/webhook-endpoints/:endpointId", async (request) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const { endpointId } = request.params as { endpointId: string };
    const body = z.object({ enabled: z.boolean().optional(), url: z.string().url().optional() }).parse(
      request.body ?? {}
    );

    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { id: endpointId, organizationId },
    });
    if (!endpoint) throw BillingError.notFound("WEBHOOK_ENDPOINT_NOT_FOUND", "Webhook endpoint");

    const updated = await prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        ...(body.url !== undefined ? { url: body.url } : {}),
        ...(body.enabled !== undefined
          ? { enabled: body.enabled, disabledAt: body.enabled ? null : new Date() }
          : {}),
      },
      select: { id: true, url: true, enabled: true, createdAt: true, disabledAt: true },
    });
    return success(updated, request.requestId);
  });

  app.delete("/v1/webhook-endpoints/:endpointId", async (request) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const { endpointId } = request.params as { endpointId: string };

    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { id: endpointId, organizationId },
    });
    if (!endpoint) throw BillingError.notFound("WEBHOOK_ENDPOINT_NOT_FOUND", "Webhook endpoint");

    await prisma.webhookEndpoint.delete({ where: { id: endpoint.id } });
    return success({ deleted: true }, request.requestId);
  });

  // -- Deliveries --------------------------------------------------------------

  /** Paginated. `endpointId` and `status` narrow the log; nothing here is generated on demand. */
  app.get("/v1/webhook-deliveries", async (request) => {
    const organizationId = requireOrganization(request);
    const query = request.query as Record<string, unknown> & {
      endpointId?: string;
      status?: string;
    };
    const page = parsePageQuery(query, { defaultLimit: 25 });

    const where = {
      organizationId,
      ...(query.endpointId ? { endpointId: query.endpointId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: page.limit,
        skip: page.skip,
        select: {
          id: true,
          endpointId: true,
          eventType: true,
          status: true,
          attempts: true,
          nextAttemptAt: true,
          lastAttemptAt: true,
          responseStatus: true,
          createdAt: true,
        },
      }),
      prisma.webhookDelivery.count({ where }),
    ]);

    return success(paginated(items, page, total), request.requestId);
  });

  /**
   * Retries a delivery right now rather than waiting for its scheduled
   * attempt — the same delivery worker code path, just triggered on demand.
   * Works on a `FAILED` delivery too: giving up is not permanent.
   */
  app.post("/v1/webhook-deliveries/:deliveryId/resend", async (request) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const { deliveryId } = request.params as { deliveryId: string };

    const delivery = await prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, organizationId },
    });
    if (!delivery) throw BillingError.notFound("WEBHOOK_DELIVERY_NOT_FOUND", "Webhook delivery");

    const updated = await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "PENDING", nextAttemptAt: new Date() },
    });
    return success(updated, request.requestId);
  });
}
