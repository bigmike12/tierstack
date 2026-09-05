import { loadRootEnv, redact } from "@tierstack/shared";

// Load the monorepo .env before anything reads process.env.
loadRootEnv();

import { Queue, Worker, type Job } from "bullmq";
import { createPrismaClient } from "@tierstack/database";
import Redis from "ioredis";
import { createEmailTransport } from "@tierstack/notifications";
import {
  runDunningRetries,
  runGraceExpiry,
  runIdempotencySweep,
  runIncompleteExpiry,
  runPaymentReconciliation,
  runPlatformMetering,
  runRenewals,
  runSessionSweep,
  runWebhookDeliveries,
  type JobContext,
} from "./jobs";
import { runNotifications, type NotificationContext } from "./notifications";

const QUEUE_NAME = "billing";

type JobName =
  | "renewals"
  | "dunning-retries"
  | "notifications"
  | "grace-expiry"
  | "incomplete-expiry"
  | "payment-reconciliation"
  | "platform-metering"
  | "webhook-deliveries"
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
    // Set only on a deployment that resells itself. Unset everywhere else, and
    // the volume-metering job below stays a no-op.
    platformOrganizationId: process.env.PLATFORM_ORGANIZATION_ID || null,
    // eslint-disable-next-line no-console
    log: (message, meta) => console.log(`[billing-worker] ${message}`, meta ?? ""),
  };

  // No key configured means the log transport, which prints every message it
  // would have sent. Nothing silently disappears, and nothing is recorded as
  // delivered that was not.
  const transport = createEmailTransport({ resendApiKey: process.env.RESEND_API_KEY });
  const notifications: NotificationContext = { ...ctx, transport };
  ctx.log("email transport", { provider: transport.kind });
  if (ctx.platformOrganizationId) {
    ctx.log("platform billing enabled", { organizationId: ctx.platformOrganizationId });
  }

  const queue = new Queue(QUEUE_NAME, { connection });

  // Schedules are intentionally frequent: billing work is idempotent, so a run
  // that finds nothing to do costs one indexed query.
  await queue.upsertJobScheduler("renewals", { pattern: "*/5 * * * *" }, { name: "renewals" });
  await queue.upsertJobScheduler("dunning-retries", { pattern: "*/10 * * * *" }, { name: "dunning-retries" });
  // Notice before a charge is the point, so this runs often enough that a
  // price-change or trial-ending email is never late by more than a few minutes.
  await queue.upsertJobScheduler("notifications", { pattern: "*/5 * * * *" }, { name: "notifications" });
  await queue.upsertJobScheduler("grace-expiry", { pattern: "*/10 * * * *" }, { name: "grace-expiry" });
  // Runs ahead of incomplete-expiry so a stranded attempt gets its real
  // failure reason recorded before the subscription is ever closed as abandoned.
  await queue.upsertJobScheduler(
    "payment-reconciliation",
    { pattern: "*/2 * * * *" },
    { name: "payment-reconciliation" }
  );
  await queue.upsertJobScheduler("incomplete-expiry", { pattern: "*/15 * * * *" }, { name: "incomplete-expiry" });
  // A developer's own app reacting to a subscription or invoice event is the
  // point of this one — runs every minute so delivery is close to real-time.
  await queue.upsertJobScheduler(
    "webhook-deliveries",
    { pattern: "* * * * *" },
    { name: "webhook-deliveries" }
  );
  // Volume settles continuously, but it is only ever read when an invoice is
  // built, so this trades promptness for a tenth of the passes. The lookback
  // window is a day, so a late run costs nothing but latency.
  await queue.upsertJobScheduler(
    "platform-metering",
    { pattern: "*/15 * * * *" },
    { name: "platform-metering" }
  );
  await queue.upsertJobScheduler("idempotency-sweep", { pattern: "0 * * * *" }, { name: "idempotency-sweep" });
  await queue.upsertJobScheduler("session-sweep", { pattern: "0 3 * * *" }, { name: "session-sweep" });

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      switch (job.name as JobName) {
        case "renewals":
          return runRenewals(ctx);
        case "dunning-retries":
          return runDunningRetries(ctx);
        case "notifications":
          return runNotifications(notifications);
        case "grace-expiry":
          return runGraceExpiry(ctx);
        case "incomplete-expiry":
          return runIncompleteExpiry(ctx);
        case "payment-reconciliation":
          return runPaymentReconciliation(ctx);
        case "platform-metering":
          return runPlatformMetering(ctx);
        case "webhook-deliveries":
          return runWebhookDeliveries(ctx);
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
  // Every job today only returns counts and ids, so this is currently a no-op
  // — but nothing stops a future job from returning something richer, and
  // this is the one place that would log it unexamined.
  worker.on("completed", (job, result) => ctx.log("job completed", { job: job.name, result: redact(result) }));

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
