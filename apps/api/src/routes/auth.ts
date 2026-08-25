import type { PrismaClient } from "@tierstack/database";
import { BillingError, newId, success } from "@tierstack/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireActor } from "../context";
import type { AppConfig } from "../env";
import { generateSessionToken, hashToken } from "../lib/api-keys";
import { hashPassword, verifyPassword } from "../lib/password";
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
    const memberships = await prisma.organizationMember.findMany({
      where: { userId: actor.userId, removedAt: null },
      include: { organization: true },
    });
    return success(
      {
        actor: "user",
        user: { id: actor.userId, email: actor.email },
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

  app.get("/health", async (request) => {
    await prisma.$queryRaw`SELECT 1`;
    return success({ status: "ok", environment: config.BILLING_ENV }, request.requestId);
  });
}
