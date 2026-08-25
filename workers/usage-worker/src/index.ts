import { loadRootEnv } from "@tierstack/shared";

// Load the monorepo .env before anything reads process.env.
loadRootEnv();

import { createPrismaClient } from "@tierstack/database";
import { EntitlementCache } from "@tierstack/entitlements";
import { Queue, Worker, type Job } from "bullmq";
import Redis from "ioredis";
import { markEventsProcessed, reportIngestionLag, type UsageJobContext } from "./jobs";

const QUEUE_NAME = "usage";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!databaseUrl || !redisUrl) {
    throw new Error("DATABASE_URL and REDIS_URL must both be set. Run `npm run setup` first.");
  }

  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const prisma = createPrismaClient(databaseUrl);

  const ctx: UsageJobContext = {
    prisma,
    cache: new EntitlementCache(connection),
    // eslint-disable-next-line no-console
    log: (message, meta) => console.log(`[usage-worker] ${message}`, meta ?? ""),
  };

  const queue = new Queue(QUEUE_NAME, { connection });
  await queue.upsertJobScheduler("process-events", { pattern: "* * * * *" }, { name: "process-events" });
  await queue.upsertJobScheduler("ingestion-lag", { pattern: "*/5 * * * *" }, { name: "ingestion-lag" });

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      switch (job.name) {
        case "process-events":
          return markEventsProcessed(ctx);
        case "ingestion-lag":
          return reportIngestionLag(ctx);
        default:
          throw new Error(`Unknown job "${job.name}".`);
      }
    },
    { connection, concurrency: 1 }
  );

  worker.on("failed", (job, error) => ctx.log("job failed", { job: job?.name, error: error.message }));

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
