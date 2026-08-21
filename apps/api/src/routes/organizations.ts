import type { PrismaClient } from "@tierbase/database";
import { BillingError, newId, success } from "@tierbase/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireActor, requireOrganization, requireRole, type MemberRole } from "../context";
import { recordAudit } from "../lib/audit";

const createOrgSchema = z.object({ name: z.string().min(1).max(120) });
const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).optional(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]).default("MEMBER"),
});
const roleSchema = z.object({ role: z.enum(["OWNER", "ADMIN", "MEMBER"]) });

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

export function registerOrganizationRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.post("/v1/organizations", async (request, reply) => {
    const actor = requireActor(request);
    if (actor.kind !== "USER") {
      throw new BillingError(
        "INSUFFICIENT_PERMISSIONS",
        "Organizations are created by signed-in users, not API keys."
      );
    }
    const body = createOrgSchema.parse(request.body);
    const base = slugify(body.name) || "org";

    const organization = await prisma.$transaction(async (tx) => {
      let slug = base;
      for (let i = 1; await tx.organization.findUnique({ where: { slug } }); i += 1) slug = `${base}-${i}`;

      const org = await tx.organization.create({
        data: { id: newId("organization"), name: body.name, slug },
      });
      await tx.organizationMember.create({
        data: {
          id: newId("member"),
          organizationId: org.id,
          userId: actor.userId,
          role: "OWNER",
          acceptedAt: new Date(),
        },
      });
      await tx.billingSettings.create({ data: { id: newId("organization"), organizationId: org.id } });
      return org;
    });

    await recordAudit(prisma, {
      organizationId: organization.id,
      actorType: "USER",
      userId: actor.userId,
      action: "organization.created",
      resource: "organization",
      resourceId: organization.id,
      ipAddress: request.ip,
    });

    return reply.status(201).send(success(organization, request.requestId));
  });

  app.get("/v1/organizations", async (request) => {
    const actor = requireActor(request);
    if (actor.kind === "API_KEY") {
      const org = await prisma.organization.findUnique({ where: { id: actor.organizationId } });
      return success([org], request.requestId);
    }
    const memberships = await prisma.organizationMember.findMany({
      where: { userId: actor.userId, removedAt: null },
      include: { organization: true },
    });
    return success(
      memberships.map((m) => ({ ...m.organization, role: m.role })),
      request.requestId
    );
  });

  app.get("/v1/organizations/current", async (request) => {
    const organizationId = requireOrganization(request);
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: { billingSettings: true },
    });
    return success(organization, request.requestId);
  });

  app.get("/v1/organizations/current/members", async (request) => {
    const organizationId = requireOrganization(request);
    const members = await prisma.organizationMember.findMany({
      where: { organizationId, removedAt: null },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return success(
      members.map((m) => ({
        id: m.id,
        role: m.role,
        invitedAt: m.invitedAt,
        acceptedAt: m.acceptedAt,
        user: m.user,
      })),
      request.requestId
    );
  });

  /**
   * Invites an existing or new user into the organization. A brand-new invitee
   * gets a placeholder credential they cannot sign in with until a password is
   * set, so an invite never creates a usable account on its own.
   */
  app.post("/v1/organizations/current/members", async (request, reply) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const body = inviteSchema.parse(request.body);
    const actor = requireActor(request);

    const member = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email: body.email } });
      if (!user) {
        user = await tx.user.create({
          data: {
            id: newId("user"),
            email: body.email,
            name: body.name ?? body.email.split("@")[0]!,
            passwordHash: "invited$$",
          },
        });
      }

      const existing = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: user.id } },
      });
      if (existing && !existing.removedAt) {
        throw new BillingError("ALREADY_EXISTS", "That person is already a member of this organization.");
      }
      if (existing) {
        return tx.organizationMember.update({
          where: { id: existing.id },
          data: { removedAt: null, role: body.role, invitedAt: new Date(), acceptedAt: null },
        });
      }
      return tx.organizationMember.create({
        data: {
          id: newId("member"),
          organizationId,
          userId: user.id,
          role: body.role,
        },
      });
    });

    await recordAudit(prisma, {
      organizationId,
      actorType: actor.kind,
      userId: actor.kind === "USER" ? actor.userId : null,
      action: "member.invited",
      resource: "organization_member",
      resourceId: member.id,
      metadata: { email: body.email, role: body.role },
      ipAddress: request.ip,
    });

    return reply.status(201).send(success(member, request.requestId));
  });

  app.patch("/v1/organizations/current/members/:memberId", async (request) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const { memberId } = request.params as { memberId: string };
    const body = roleSchema.parse(request.body);
    const actor = requireActor(request);

    const member = await prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId, removedAt: null },
    });
    if (!member) throw BillingError.notFound("MEMBER_NOT_FOUND", "Member");

    // Only an owner may hand out or take away ownership.
    if (member.role === "OWNER" || body.role === "OWNER") requireRole(request, "OWNER");
    await assertNotLastOwner(prisma, organizationId, member.id, member.role as MemberRole, body.role);

    const updated = await prisma.organizationMember.update({
      where: { id: member.id },
      data: { role: body.role },
    });

    await recordAudit(prisma, {
      organizationId,
      actorType: actor.kind,
      userId: actor.kind === "USER" ? actor.userId : null,
      action: "member.role_changed",
      resource: "organization_member",
      resourceId: member.id,
      metadata: { from: member.role, to: body.role },
      ipAddress: request.ip,
    });

    return success(updated, request.requestId);
  });

  app.delete("/v1/organizations/current/members/:memberId", async (request) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const { memberId } = request.params as { memberId: string };
    const actor = requireActor(request);

    const member = await prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId, removedAt: null },
    });
    if (!member) throw BillingError.notFound("MEMBER_NOT_FOUND", "Member");
    if (member.role === "OWNER") requireRole(request, "OWNER");
    await assertNotLastOwner(prisma, organizationId, member.id, member.role as MemberRole, null);

    await prisma.organizationMember.update({
      where: { id: member.id },
      data: { removedAt: new Date() },
    });
    // Revoking membership must also end any live dashboard session.
    await prisma.session.updateMany({
      where: { userId: member.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await recordAudit(prisma, {
      organizationId,
      actorType: actor.kind,
      userId: actor.kind === "USER" ? actor.userId : null,
      action: "member.removed",
      resource: "organization_member",
      resourceId: member.id,
      ipAddress: request.ip,
    });

    return success({ removed: true }, request.requestId);
  });
}

/** An organization must always retain at least one owner. */
async function assertNotLastOwner(
  prisma: PrismaClient,
  organizationId: string,
  memberId: string,
  currentRole: MemberRole,
  nextRole: MemberRole | null
): Promise<void> {
  if (currentRole !== "OWNER") return;
  if (nextRole === "OWNER") return;
  const owners = await prisma.organizationMember.count({
    where: { organizationId, role: "OWNER", removedAt: null, id: { not: memberId } },
  });
  if (owners === 0) {
    throw new BillingError(
      "FORBIDDEN",
      "This is the only owner of the organization. Promote another member to owner first."
    );
  }
}
