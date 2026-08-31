import { loadBillingSettings } from "@tierstack/billing";
import type { PrismaClient } from "@tierstack/database";
import { memberInvited, sendOnce, type EmailTransport } from "@tierstack/notifications";
import { BillingError, loadBranding, newId, success } from "@tierstack/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireActor, requireOrganization, requireRole, type MemberRole } from "../context";
import { recordAudit } from "../lib/audit";
import { generateSessionToken } from "../lib/api-keys";
import { PLACEHOLDER_PASSWORD_HASH } from "../lib/password";

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

const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function registerOrganizationRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  emailTransport: EmailTransport
): void {
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
   * gets a placeholder credential they cannot sign in with until they accept
   * the invite and set a real password — an invite never creates a usable
   * account on its own. The accept link is single-use and expires in 7 days.
   */
  app.post("/v1/organizations/current/members", async (request, reply) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const body = inviteSchema.parse(request.body);
    const actor = requireActor(request);

    const { token, tokenHash } = generateSessionToken();
    const inviteTokenExpiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS);

    const { member, organization, isNewUser } = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email: body.email } });
      const isNewUser = !user;
      if (!user) {
        user = await tx.user.create({
          data: {
            id: newId("user"),
            email: body.email,
            name: body.name ?? body.email.split("@")[0]!,
            passwordHash: PLACEHOLDER_PASSWORD_HASH,
          },
        });
      }

      const existing = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: user.id } },
      });
      if (existing && !existing.removedAt) {
        throw new BillingError("ALREADY_EXISTS", "That person is already a member of this organization.");
      }
      const memberData = {
        removedAt: null,
        role: body.role,
        invitedAt: new Date(),
        acceptedAt: null,
        inviteTokenHash: tokenHash,
        inviteTokenExpiresAt,
      };
      const member = existing
        ? await tx.organizationMember.update({ where: { id: existing.id }, data: memberData })
        : await tx.organizationMember.create({
            data: { id: newId("member"), organizationId, userId: user.id, ...memberData },
          });

      const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
      return { member, organization, isNewUser };
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

    const settings = await loadBillingSettings(prisma, organizationId);
    const branding = loadBranding();
    const acceptUrl = `${branding.appUrl.replace(/\/$/, "")}/invite/${token}`;

    await sendOnce(
      prisma,
      emailTransport,
      {
        organizationId,
        dedupeKey: `invite:${member.id}:${tokenHash.slice(0, 16)}`,
        type: "member_invited",
        toEmail: body.email,
        from: settings.emailSender ?? branding.emailSender,
        fromName: settings.senderName ?? organization.name,
        replyTo: settings.supportEmail ?? null,
        email: memberInvited({
          merchantName: organization.name,
          customerName: body.name ?? null,
          supportEmail: settings.supportEmail ?? null,
          role: body.role,
          acceptUrl,
          hasExistingAccount: !isNewUser,
        }),
        enabled: true,
      }
    ).catch((error: unknown) => {
      // The membership and token are already committed — worth surfacing that
      // the invite exists even if the email did not go out, not losing the
      // whole operation over a provider hiccup.
      request.log.error({ err: error }, "invite email failed to send");
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
