import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

export type { PrismaClient } from "./generated/client";
export * from "./generated/enums";

/**
 * Prisma runs Rust-free here: the query compiler is WASM and PostgreSQL is
 * reached through the node-postgres driver adapter. That keeps installs free of
 * platform-specific engine binaries.
 */
export function createPrismaClient(databaseUrl = process.env.DATABASE_URL): PrismaClient {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({
    adapter,
    log: process.env.PRISMA_LOG === "query" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

let singleton: PrismaClient | undefined;

/** Process-wide client. Tests and workers may create their own instead. */
export function getPrisma(): PrismaClient {
  if (!singleton) singleton = createPrismaClient();
  return singleton;
}

export async function disconnectPrisma(): Promise<void> {
  if (singleton) {
    await singleton.$disconnect();
    singleton = undefined;
  }
}

/**
 * A Prisma transaction client. Every function that participates in a financial
 * operation takes this type so callers can compose them inside one transaction.
 */
export type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;
