import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  APP_URL: z.string().url().default("http://localhost:8181"),
  API_URL: z.string().url().default("http://localhost:4000"),
  PORTAL_URL: z.string().url().default("http://localhost:3001"),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 64 hex characters (32 bytes)"),

  BILLING_ENV: z.enum(["test", "live"]).default("test"),
  APP_NAME: z.string().default("Tierstack"),
  INVOICE_NUMBER_PREFIX: z.string().default("INV"),
  /** Unset means the log transport: invite emails print instead of sending. */
  RESEND_API_KEY: z.string().optional(),

  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 14),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),
  /** Comma-separated list; "*" allows any origin (development only). */
  CORS_ORIGINS: z.string().default("*"),
});

export type AppConfig = z.infer<typeof schema> & { corsOrigins: string[] | true };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
  }
  const value = parsed.data;
  return {
    ...value,
    corsOrigins: value.CORS_ORIGINS === "*" ? true : value.CORS_ORIGINS.split(",").map((o) => o.trim()),
  };
}

/** The API-key environment matching the process-level billing environment. */
export function apiEnvironment(config: AppConfig): "TEST" | "LIVE" {
  return config.BILLING_ENV === "live" ? "LIVE" : "TEST";
}
