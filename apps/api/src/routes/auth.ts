import type { PrismaClient } from "@tierstack/database";
import { BillingError, newId, success } from "@tierstack/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireActor } from "../context";
import type { AppConfig } from "../env";
import { generateSessionToken, hashToken } from "../lib/api-keys";
import { hashPassword, PLACEHOLDER_PASSWORD_HASH, verifyPassword } from "../lib/password";
import { recordAudit } from "../lib/audit";
import { SESSION_COOKIE } from "../plugins/auth";

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(12, "Use at least 12 characters."),
  organizationName: z.string().min(1).max(120),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(120),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, "Use at least 12 characters."),
});

const acceptInviteSchema = z.object({
  password: z.string().min(12, "Use at least 12 characters.").optional(),
});

/** A pending invite: not removed, not yet accepted, token not expired. */
function findPendingInvite(prisma: PrismaClient, token: string) {
  return prisma.organizationMember.findFirst({
    where: {
      inviteTokenHash: hashToken(token),
      removedAt: null,
      acceptedAt: null,
      inviteTokenExpiresAt: { gt: new Date() },
    },
    include: { organization: true, user: true },
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function registerAuthRoutes(app: FastifyInstance, prisma: PrismaClient, config: AppConfig): void {
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.NODE_ENV === "production",
    path: "/",
  };

  /** Creates the first user, their organization, and the default billing policy. */
  app.post("/v1/auth/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      throw new BillingError("EMAIL_ALREADY_REGISTERED", "That email address is already registered.");
    }

    const passwordHash = await hashPassword(body.password);
    const baseSlug = slugify(body.organizationName) || "org";

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { id: newId("user"), email: body.email, name: body.name, passwordHash },
      });

      let slug = baseSlug;
      for (let attempt = 1; await tx.organization.findUnique({ where: { slug } }); attempt += 1) {
        slug = `${baseSlug}-${attempt}`;
      }

      const organization = await tx.organization.create({
        data: { id: newId("organization"), name: body.organizationName, slug },
      });
      await tx.organizationMember.create({
        data: {
          id: newId("member"),
          organizationId: organization.id,
          userId: user.id,
          role: "OWNER",
          acceptedAt: new Date(),
        },
      });
      await tx.billingSettings.create({
        data: { id: newId("organization"), organizationId: organization.id },
      });
      return { user, organization };
    });

    const { token, tokenHash } = generateSessionToken();
    await prisma.session.create({
      data: {
        id: newId("session"),
        userId: result.user.id,
        tokenHash,
        userAgent: request.headers["user-agent"]?.slice(0, 255) ?? null,
        ipAddress: request.ip,
        expiresAt: new Date(Date.now() + config.SESSION_TTL_HOURS * 3_600_000),
      },
    });

    await recordAudit(prisma, {
      organizationId: result.organization.id,
      actorType: "USER",
      userId: result.user.id,
      action: "organization.created",
      resource: "organization",
      resourceId: result.organization.id,
      ipAddress: request.ip,
    });

    reply.setCookie(SESSION_COOKIE, token, cookieOptions);
    return reply.status(201).send(
      success(
        {
          user: { id: result.user.id, email: result.user.email, name: result.user.name },
          organization: {
            id: result.organization.id,
            name: result.organization.name,
            slug: result.organization.slug,
          },
        },
        request.requestId
      )
    );
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });

    // Same error either way, so the endpoint cannot be used to enumerate accounts.
    const invalid = new BillingError("INVALID_CREDENTIALS", "Email or password is incorrect.");
    if (!user) throw invalid;
    if (!(await verifyPassword(body.password, user.passwordHash))) throw invalid;

    const { token, tokenHash } = generateSessionToken();
    await prisma.session.create({
      data: {
        id: newId("session"),
        userId: user.id,
        tokenHash,
        userAgent: request.headers["user-agent"]?.slice(0, 255) ?? null,
        ipAddress: request.ip,
        expiresAt: new Date(Date.now() + config.SESSION_TTL_HOURS * 3_600_000),
      },
    });

    const memberships = await prisma.organizationMember.findMany({
      where: { userId: user.id, removedAt: null },
      include: { organization: true },
    });

    reply.setCookie(SESSION_COOKIE, token, cookieOptions);
    return success(
      {
        user: { id: user.id, email: user.email, name: user.name },
        organizations: memberships.map((m) => ({
          id: m.organizationId,
          name: m.organization.name,
          slug: m.organization.slug,
          role: m.role,
        })),
      },
      request.requestId
    );
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const actor = requireActor(request);
    if (actor.kind === "USER") {
      await prisma.session.update({
        where: { id: actor.sessionId },
        data: { revokedAt: new Date() },
      });
    }
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return success({ ok: true }, request.requestId);
  });

  app.get("/v1/auth/me", async (request) => {
    const actor = requireActor(request);
    if (actor.kind === "API_KEY") {
      return success(
        {
          actor: "api_key",
          organizationId: actor.organizationId,
          environment: actor.environment,
          keyType: actor.type,
        },
        request.requestId
      );
    }
    const [memberships, user] = await Promise.all([
      prisma.organizationMember.findMany({
        where: { userId: actor.userId, removedAt: null },
        include: { organization: true },
      }),
      prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { id: true, email: true, name: true } }),
    ]);
    return success(
      {
        actor: "user",
        user,
        // Resolved by the auth plugin from the `x-organization-id` the
        // request actually carried (falling back to the first membership
        // when none was sent) — the org a client should treat as "current"
        // is this, never array position, since `organizations` below is in
        // plain membership order and carries no signal about selection.
        currentOrganizationId: request.organizationId ?? memberships[0]?.organizationId ?? null,
        organizations: memberships.map((m) => ({
          id: m.organizationId,
          name: m.organization.name,
          slug: m.organization.slug,
          role: m.role,
        })),
      },
      request.requestId
    );
  });

  /** Updates the caller's own display name. Email is the login identity and is not changed here. */
  app.patch("/v1/auth/me", async (request) => {
    const actor = requireActor(request);
    if (actor.kind !== "USER") {
      throw new BillingError("FORBIDDEN", "Only a signed-in user can update a profile.");
    }
    const body = updateProfileSchema.parse(request.body);

    const user = await prisma.user.update({
      where: { id: actor.userId },
      data: { name: body.name },
      select: { id: true, email: true, name: true },
    });

    return success({ user }, request.requestId);
  });

  /**
   * Requires the current password so a hijacked, still-logged-in session
   * cannot be used to lock the real owner out by silently changing it.
   */
  app.post("/v1/auth/password", async (request) => {
    const actor = requireActor(request);
    if (actor.kind !== "USER") {
      throw new BillingError("FORBIDDEN", "Only a signed-in user can change a password.");
    }
    const body = changePasswordSchema.parse(request.body);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw new BillingError("INVALID_CREDENTIALS", "Current password is incorrect.");
    }

    const passwordHash = await hashPassword(body.newPassword);
    await prisma.user.update({ where: { id: actor.userId }, data: { passwordHash } });

    // Every other session for this user is revoked, so a stolen session
    // cannot outlive the password that was just changed to get rid of it.
    await prisma.session.updateMany({
      where: { userId: actor.userId, revokedAt: null, id: { not: actor.sessionId } },
      data: { revokedAt: new Date() },
    });

    // A password change is account-wide, not scoped to one organization, but
    // every audit log row requires one — recorded against each org the user
    // belongs to, so any of their teams can see it happened.
    const memberships = await prisma.organizationMember.findMany({
      where: { userId: actor.userId, removedAt: null },
      select: { organizationId: true },
    });
    await Promise.all(
      memberships.map((m) =>
        recordAudit(prisma, {
          organizationId: m.organizationId,
          actorType: "USER",
          userId: actor.userId,
          action: "user.password_changed",
          resource: "user",
          resourceId: actor.userId,
          ipAddress: request.ip,
        })
      )
    );

    return success({ ok: true }, request.requestId);
  });

  /**
   * Public: no session or organization required, only a valid, unexpired
   * token. Tells the accept page whether to ask for a password — an invitee
   * who already has an account keeps their existing one.
   */
  app.get("/v1/invites/:token", async (request) => {
    const { token } = request.params as { token: string };
    const member = await findPendingInvite(prisma, token);
    if (!member) throw new BillingError("INVITE_NOT_FOUND", "This invite link is invalid or has expired.");

    return success(
      {
        organizationName: member.organization.name,
        email: member.user.email,
        role: member.role,
        requiresPassword: member.user.passwordHash === PLACEHOLDER_PASSWORD_HASH,
      },
      request.requestId
    );
  });

  /**
   * Consumes the invite token exactly once — the lookup itself excludes any
   * membership that already has `acceptedAt` set, so a replayed link finds
   * nothing the second time regardless of whether the hash was also cleared.
   */
  app.post("/v1/invites/:token/accept", async (request, reply) => {
    const { token } = request.params as { token: string };
    const body = acceptInviteSchema.parse(request.body);

    const member = await findPendingInvite(prisma, token);
    if (!member) throw new BillingError("INVITE_NOT_FOUND", "This invite link is invalid or has expired.");

    const needsPassword = member.user.passwordHash === PLACEHOLDER_PASSWORD_HASH;
    if (needsPassword && !body.password) {
      throw new BillingError("VALIDATION_ERROR", "A password is required to accept this invite.");
    }
    const passwordHash = needsPassword && body.password ? await hashPassword(body.password) : null;

    await prisma.$transaction(async (tx) => {
      if (passwordHash) {
        await tx.user.update({ where: { id: member.user.id }, data: { passwordHash } });
      }
      await tx.organizationMember.update({
        where: { id: member.id },
        data: { acceptedAt: new Date(), inviteTokenHash: null, inviteTokenExpiresAt: null },
      });
    });

    const { token: sessionToken, tokenHash } = generateSessionToken();
    await prisma.session.create({
      data: {
        id: newId("session"),
        userId: member.user.id,
        tokenHash,
        userAgent: request.headers["user-agent"]?.slice(0, 255) ?? null,
        ipAddress: request.ip,
        expiresAt: new Date(Date.now() + config.SESSION_TTL_HOURS * 3_600_000),
      },
    });

    await recordAudit(prisma, {
      organizationId: member.organizationId,
      actorType: "USER",
      userId: member.user.id,
      action: "member.invite_accepted",
      resource: "organization_member",
      resourceId: member.id,
      ipAddress: request.ip,
    });

    reply.setCookie(SESSION_COOKIE, sessionToken, cookieOptions);
    return success(
      {
        user: { id: member.user.id, email: member.user.email, name: member.user.name },
        organization: { id: member.organization.id, name: member.organization.name, slug: member.organization.slug },
      },
      request.requestId
    );
  });

  app.get("/health", async (request) => {
    await prisma.$queryRaw`SELECT 1`;
    return success({ status: "ok", environment: config.BILLING_ENV }, request.requestId);
  });
}
