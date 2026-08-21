import type { PrismaClient } from "@billing-platform/database";
import { assertCurrency, success } from "@billing-platform/shared";
import { loadBillingSettings } from "@billing-platform/billing";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireActor, requireOrganization, requireRole } from "../context";
import { recordAudit } from "../lib/audit";

const updateSchema = z
  .object({
    /** Any non-negative number of days. There is no enforced ceiling or default. */
    gracePeriodDays: z.number().int().min(0).max(365).optional(),
    maxRetryAttempts: z.number().int().min(0).max(20).optional(),
    retryIntervals: z.array(z.number().int().min(0).max(365)).max(20).optional(),
    accessDuringGracePeriod: z.enum(["FULL_ACCESS", "RESTRICTED_ACCESS", "NO_ACCESS"]).optional(),
    failureAction: z.enum(["MARK_UNPAID", "CANCEL", "PAUSE"]).optional(),
    invoiceDueDays: z.number().int().min(0).max(365).optional(),
    /** 0 disables automatic expiry of abandoned first checkouts. */
    incompleteExpiryHours: z.number().int().min(0).max(24 * 30).optional(),
    defaultCurrency: z.string().length(3).optional(),
    autoCollect: z.boolean().optional(),
  })
  .strict();

export function registerBillingSettingsRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get("/v1/billing-settings", async (request) => {
    const organizationId = requireOrganization(request);
    return success(await loadBillingSettings(prisma, organizationId), request.requestId);
  });

  app.put("/v1/billing-settings", async (request) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const actor = requireActor(request);
    const body = updateSchema.parse(request.body);
    if (body.defaultCurrency) assertCurrency(body.defaultCurrency);

    const before = await loadBillingSettings(prisma, organizationId);
    const updated = await prisma.billingSettings.update({
      where: { organizationId },
      data: body,
    });

    await recordAudit(prisma, {
      organizationId,
      actorType: actor.kind,
      userId: actor.kind === "USER" ? actor.userId : null,
      action: "billing_settings.updated",
      resource: "billing_settings",
      resourceId: updated.id,
      metadata: { before, after: updated },
      ipAddress: request.ip,
    });

    return success(updated, request.requestId);
  });
}
