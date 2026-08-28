import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { setEntitlementInvalidator } from "@tierstack/billing";
import { createPrismaClient, type PrismaClient } from "@tierstack/database";
import { EntitlementCache } from "@tierstack/entitlements";
import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig, type AppConfig } from "./env";
import { createRedis, type RedisClient } from "./lib/redis";
import { registerAuth } from "./plugins/auth";
import { registerErrorHandler } from "./plugins/error-handler";
import { registerRequestContext } from "./plugins/request-context";
import { registerApiKeyRoutes } from "./routes/api-keys";
import { registerAuthRoutes } from "./routes/auth";
import { registerBillingSettingsRoutes } from "./routes/billing-settings";
import { registerCatalogueRoutes } from "./routes/catalogue";
import { registerCustomerRoutes } from "./routes/customers";
import { registerEntitlementRoutes } from "./routes/entitlements";
import { registerInvoiceRoutes } from "./routes/invoices";
import { registerMetricsRoutes } from "./routes/metrics";
import { registerMockRoutes } from "./routes/mock";
import { registerOrganizationRoutes } from "./routes/organizations";
import { registerPaymentProviderRoutes } from "./routes/payment-providers";
import { registerPortalRoutes } from "./routes/portal";
import { registerSubscriptionRoutes } from "./routes/subscriptions";
import { registerUsageRoutes } from "./routes/usage";
import { registerWebhookEventRoutes, registerWebhookRoutes } from "./routes/webhooks";

export interface BuiltServer {
  app: FastifyInstance;
  prisma: PrismaClient;
  redis: RedisClient;
  config: AppConfig;
}

export async function buildServer(overrides?: Partial<AppConfig>): Promise<BuiltServer> {
  const config = { ...loadConfig(), ...overrides } as AppConfig;
  const prisma = createPrismaClient(config.DATABASE_URL);
  const redis = createRedis(config.REDIS_URL);

  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "test" ? "silent" : "info",
      // Anything that could carry a secret is stripped before it reaches a log.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers['x-mock-signature']",
          "req.body.password",
          "req.body.credentials",
          "res.headers['set-cookie']",
        ],
        censor: "[redacted]",
      },
    },
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    // A browser must never be able to send a secret key, so the header that
    // carries one is not in the allow-list for cross-origin requests.
    allowedHeaders: ["content-type", "x-request-id", "x-organization-id", "idempotency-key"],
  });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_SECONDS * 1000,
    redis,
    keyGenerator: (request) =>
      (request.headers.authorization as string | undefined)?.slice(-12) ?? request.ip,
  });

  // Webhook signatures are computed over the exact bytes received, so the raw
  // body must survive parsing untouched.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body: Buffer, done) => {
      if (request.url.startsWith("/webhooks/")) {
        done(null, body);
        return;
      }
      try {
        done(null, body.length === 0 ? {} : JSON.parse(body.toString("utf8")));
      } catch (error) {
        done(error as Error, undefined);
      }
    }
  );

  // Any subscription status change anywhere in the system invalidates that
  // customer's cached entitlements.
  const entitlementCache = new EntitlementCache(redis);
  setEntitlementInvalidator(async (organizationId, customerId) => {
    if (customerId) await entitlementCache.invalidateCustomer(organizationId, customerId);
    else await entitlementCache.invalidateOrganization(organizationId);
  });

  registerRequestContext(app);
  registerErrorHandler(app);
  registerAuth(app, prisma, config);

  registerAuthRoutes(app, prisma, config);
  registerOrganizationRoutes(app, prisma);
  registerApiKeyRoutes(app, prisma);
  registerBillingSettingsRoutes(app, prisma);
  registerPaymentProviderRoutes(app, prisma, config, redis);
  registerCatalogueRoutes(app, prisma);
  registerCustomerRoutes(app, prisma);
  registerSubscriptionRoutes(app, prisma, config, redis);
  registerInvoiceRoutes(app, prisma, config, redis);
  registerPortalRoutes(app, prisma, config, redis);
  registerMetricsRoutes(app, prisma);
  registerUsageRoutes(app, prisma, config, redis);
  registerEntitlementRoutes(app, prisma, redis);
  registerMockRoutes(app, prisma, config, redis);
  registerWebhookRoutes(app, prisma, config, redis);
  registerWebhookEventRoutes(app, prisma);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });

  return { app, prisma, redis, config };
}
