import { loadRootEnv } from "@tierbase/shared";

// Load the monorepo .env before anything reads process.env.
loadRootEnv();

import { Queue, Worker, type Job } from "bullmq";
import { createPrismaClient } from "@tierbase/database";
import Redis from "ioredis";
import {
  runGraceExpiry,
  runIdempotencySweep,
  runIncompleteExpiry,
  runRenewals,
  runSessionSweep,
  type JobContext,
} from "./jobs";

const QUEUE_NAME = "billing";

type JobName =
  | "renewals"
  | "grace-expiry"
  | "incomplete-expiry"
  | "idempotency-sweep"
  | "session-sweep";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!databaseUrl || !redisUrl) {
    throw new Error("DATABASE_URL and REDIS_URL must both be set.");
  }

  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const prisma = createPrismaClient(databaseUrl);

  const ctx: JobContext = {
    prisma,
    providerDeps: {
      redis: connection,
      checkoutBaseUrl: process.env.API_URL ?? "http://localhost:4000",
      encryptionKey: process.env.ENCRYPTION_KEY,
    },
    environment: process.env.BILLING_ENV === "live" ? "LIVE" : "TEST",
    // eslint-disable-next-line no-console
    log: (message, meta) => console.log(`[billing-worker] ${message}`, meta ?? ""),
  };

  const queue = new Queue(QUEUE_NAME, { connection });

  // Schedules are intentionally frequent: billing work is idempotent, so a run
  // that finds nothing to do costs one indexed query.
  await queue.upsertJobScheduler("renewals", { pattern: "*/5 * * * *" }, { name: "renewals" });
  await queue.upsertJobScheduler("grace-expiry", { pattern: "*/10 * * * *" }, { name: "grace-expiry" });
  await queue.upsertJobScheduler("incomplete-expiry", { pattern: "*/15 * * * *" }, { name: "incomplete-expiry" });
  await queue.upsertJobScheduler("idempotency-sweep", { pattern: "0 * * * *" }, { name: "idempotency-sweep" });
  await queue.upsertJobScheduler("session-sweep", { pattern: "0 3 * * *" }, { name: "session-sweep" });

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      switch (job.name as JobName) {
        case "renewals":
          return runRenewals(ctx);
        case "grace-expiry":
          return runGraceExpiry(ctx);
        case "incomplete-expiry":
          return runIncompleteExpiry(ctx);
        case "idempotency-sweep":
          return runIdempotencySweep(ctx);
        case "session-sweep":
          return runSessionSweep(ctx);
        default:
          throw new Error(`Unknown job "${job.name}".`);
      }
    },
    { connection, concurrency: 2 }
  );

  worker.on("failed", (job, error) => ctx.log("job failed", { job: job?.name, error: error.message }));
  worker.on("completed", (job, result) => ctx.log("job completed", { job: job.name, result }));

  const shutdown = async () => {
    await worker.close();
    await queue.close();
    await prisma.$disconnect();
    connection.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  ctx.log("worker started");
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
