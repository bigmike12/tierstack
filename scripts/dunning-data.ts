/**
 * Creates customers sitting at every point on the dunning ladder, so recovery
 * can be looked at rather than imagined.
 *
 *   npm run db:seed && npm run demo:data && npm run dunning:data
 *
 * Everything real goes through the public API on the mock rail: real invoices,
 * real payment attempts, real transitions. The only direct writes are to
 * timestamps — a ladder that takes five days to walk cannot be watched in a
 * terminal, so the clock is moved rather than the outcome faked. Each persona
 * gets there by genuinely failing a charge against a card that genuinely
 * declines.
 *
 * Safe to run more than once: every run uses a fresh set of customers.
 */
import { loadRootEnv } from "@tierstack/shared";

loadRootEnv();

import { createPrismaClient } from "@tierstack/database";
import { LogEmailTransport } from "@tierstack/notifications";
import Redis from "ioredis";
import { buildServer } from "../apps/api/src/server";
import { expireGracePeriods } from "../packages/billing/src";
import { runNotifications } from "../workers/billing-worker/src/notifications";

interface Json {
  [key: string]: any;
}

const DAY = 86_400_000;

async function main(): Promise<void> {
  const prisma = createPrismaClient();

  const organization = await prisma.organization.findUnique({ where: { slug: "acme-software" } });
  if (!organization) {
    throw new Error("Run `npm run db:seed` first — no seeded organization found.");
  }

  const price = await prisma.price.findFirst({
    where: { organizationId: organization.id, active: true, currency: "NGN", model: "FLAT_RECURRING" },
    orderBy: { createdAt: "asc" },
  });
  if (!price) throw new Error("No live NGN price to subscribe anybody to. Run `npm run db:seed` first.");

  const settings = await prisma.billingSettings.findUnique({ where: { organizationId: organization.id } });
  const maxAttempts = settings?.maxRetryAttempts ?? 4;

  const { app } = await buildServer({ NODE_ENV: "test" } as never);
  await app.ready();

  const { generateApiKey } = await import("../apps/api/src/lib/api-keys");
  const { newId } = await import("@tierstack/shared");
  const generated = generateApiKey("SECRET", "TEST");
  await prisma.apiKey.create({
    data: {
      id: newId("apiKey"),
      organizationId: organization.id,
      name: "Dunning data script",
      type: "SECRET",
      environment: "TEST",
      prefix: generated.prefix,
      keyHash: generated.keyHash,
    },
  });

  const auth = { authorization: `Bearer ${generated.secret}`, "content-type": "application/json" };

  async function call(method: "GET" | "POST", url: string, payload?: unknown, extra: Json = {}) {
    const response = await app.inject({
      method,
      url,
      headers: { ...auth, ...extra },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
    try {
      return response.json() as Json;
    } catch {
      return { raw: response.body } as Json;
    }
  }

  const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: null,
  });
  const jobCtx = {
    prisma,
    providerDeps: {
      redis,
      checkoutBaseUrl: process.env.API_URL ?? "http://localhost:4000",
      encryptionKey: process.env.ENCRYPTION_KEY,
    },
    environment: "TEST" as const,
    log: () => {},
  };
  const mailCtx = { ...jobCtx, transport: new LogEmailTransport(() => {}) };

  const run = Date.now().toString(36).slice(-4);

  /**
   * A paying subscriber whose card then starts declining.
   *
   * The mock rail refuses any charge against a token minted `mock_pm_fail_*`,
   * so once the token is rewritten every later attempt is an ordinary charge
   * that genuinely fails — no test directive threaded through the engine.
   */
  async function subscriberWhoseCardWillFail(name: string, email: string, key: string) {
    const created = await call(
      "POST",
      "/v1/subscriptions",
      {
        customer: { externalId: `dunning_${key}_${run}`, email, name, country: "NG" },
        priceId: price!.id,
        metadata: { mockOutcome: "SUCCESS" },
      },
      { "idempotency-key": `dunning-${key}-${run}` }
    );

    const reference = created.data?.payment?.reference;
    if (reference) {
      await call("POST", `/mock/checkout/${reference}/complete`, { outcome: "SUCCESS" });
    }

    const subscription = created.data?.subscription;
    if (!subscription) throw new Error(`Could not create ${name}: ${JSON.stringify(created.error)}`);

    const method = await prisma.paymentMethod.findFirst({
      where: { organizationId: organization!.id, customerId: subscription.customerId },
    });
    if (method) {
      await prisma.paymentMethod.update({
        where: { id: method.id },
        data: { providerPaymentMethodRef: `mock_pm_fail_${method.id}` },
      });
    }
    return subscription.id as string;
  }

  /** Fails their renewal, which is what puts them on the ladder. */
  async function renewalDeclines(subscriptionId: string) {
    const renewed = await call("POST", `/v1/subscriptions/${subscriptionId}/renew`, {});
    return renewed.data?.invoiceId as string | undefined;
  }

  /**
   * Walks one invoice forward along the ladder.
   *
   * Deliberately not `runDunningRetries`: that job collects everything that is
   * due, which is right in production and useless here — advancing the fourth
   * persona would drag the first three to the end of their schedules too, and
   * every customer would look identical. This makes the same attempt through
   * the same engine path, one invoice at a time, so the spread survives.
   */
  async function advanceLadder(invoiceId: string, steps: number) {
    for (let step = 0; step < steps; step += 1) {
      const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice?.nextRetryAt || invoice.status !== "OPEN") return;
      await call("POST", `/v1/invoices/${invoiceId}/pay`, {});
    }
  }

  const made: { who: string; state: string }[] = [];

  console.log("Building customers on the dunning ladder…\n");

  // 1. Failed once, first retry already due.
  const fresh = await subscriberWhoseCardWillFail("Ngozi Umeh", `ngozi.${run}@example.test`, "fresh");
  const freshInvoice = await renewalDeclines(fresh);
  made.push({ who: "Ngozi Umeh", state: "failed once, first retry due now" });

  // 2. Mid-ladder: two attempts spent, more to come.
  const middle = await subscriberWhoseCardWillFail("Emeka Nnaji", `emeka.${run}@example.test`, "middle");
  const middleInvoice = await renewalDeclines(middle);
  if (middleInvoice) await advanceLadder(middleInvoice, 1);
  made.push({ who: "Emeka Nnaji", state: "part way through the retry schedule" });

  // 3. Attempts exhausted, grace period still open and closing tomorrow.
  const nearlyOut = await subscriberWhoseCardWillFail("Fatima Sani", `fatima.${run}@example.test`, "nearly");
  const nearlyInvoice = await renewalDeclines(nearlyOut);
  if (nearlyInvoice) await advanceLadder(nearlyInvoice, maxAttempts + 1);
  // Only the clock is moved. Whether they lapse, and into what, is still
  // decided by the frozen policy on the subscription.
  await prisma.subscription.update({
    where: { id: nearlyOut },
    data: {
      gracePeriodStart: new Date(Date.now() - 6 * DAY),
      gracePeriodEnd: new Date(Date.now() + DAY),
    },
  });
  made.push({ who: "Fatima Sani", state: "retries spent, grace ends tomorrow" });

  // 4. Grace ran out, and the configured failure action has been applied.
  const lapsed = await subscriberWhoseCardWillFail("Kwame Mensah", `kwame.${run}@example.test`, "lapsed");
  const lapsedInvoice = await renewalDeclines(lapsed);
  if (lapsedInvoice) await advanceLadder(lapsedInvoice, maxAttempts + 1);
  await prisma.subscription.update({
    where: { id: lapsed },
    data: {
      gracePeriodStart: new Date(Date.now() - 9 * DAY),
      gracePeriodEnd: new Date(Date.now() - 2 * DAY),
    },
  });
  const expired = await expireGracePeriods(prisma, organization.id, new Date());
  made.push({
    who: "Kwame Mensah",
    state: `grace expired → ${expired.find((e) => e.subscriptionId === lapsed)?.status ?? "unchanged"}`,
  });

  // 5. Failed, then paid — so the recovered case is visible too.
  const saved = await subscriberWhoseCardWillFail("Adaeze Okonkwo", `adaeze.${run}@example.test`, "saved");
  const savedInvoice = await renewalDeclines(saved);
  if (savedInvoice) {
    await advanceLadder(savedInvoice, 1);
    await call("POST", `/v1/invoices/${savedInvoice}/pay`, { metadata: { mockOutcome: "SUCCESS" } });
  }
  made.push({ who: "Adaeze Okonkwo", state: "failed twice, then paid" });

  // Everything above happened in the past few seconds; this is the run that
  // decides what each of them should have been told.
  await runNotifications(mailCtx as never);

  for (const row of made) console.log(`  ${row.who.padEnd(18)} ${row.state}`);

  const open = await prisma.invoice.findMany({
    where: { organizationId: organization.id, status: "OPEN", dunningAttempts: { gte: 1 } },
    select: { invoiceNumber: true, dunningAttempts: true, nextRetryAt: true },
    orderBy: { createdAt: "asc" },
  });

  console.log("\nOn the ladder now:");
  for (const invoice of open) {
    const next = invoice.nextRetryAt
      ? invoice.nextRetryAt.toISOString().slice(0, 16).replace("T", " ")
      : "exhausted";
    // dunningAttempts includes the charge that first failed, which was not a retry.
    const retries = Math.min(Math.max(invoice.dunningAttempts - 1, 0), maxAttempts);
    console.log(`  ${invoice.invoiceNumber}  retries ${retries}/${maxAttempts}  next: ${next}`);
  }

  const mail = await prisma.emailMessage.groupBy({
    by: ["type", "status"],
    where: { organizationId: organization.id },
    _count: { _all: true },
  });
  console.log("\nEmail the customers would have received:");
  for (const row of mail) {
    console.log(`  ${row.type.padEnd(20)} ${row.status.padEnd(10)} ${row._count._all}`);
  }

  console.log("\nOpen http://localhost:3000/dunning\n");

  await app.close();
  redis.disconnect();
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
