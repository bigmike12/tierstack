/**
 * Populates a seeded organization with a spread of realistic billing states so
 * the dashboard has something honest to render: paid subscribers, a renewal, a
 * trial, an upgrade with proration, a customer in a grace period, and an
 * abandoned checkout.
 *
 *   npm run db:seed && npm run demo:data
 *
 * Everything goes through the public API, so this exercises the same paths a
 * real integration would.
 */
import { loadRootEnv } from "@tierstack/shared";

// Load the monorepo .env before anything reads process.env.
loadRootEnv();

import { createPrismaClient } from "@tierstack/database";
import { buildServer } from "../apps/api/src/server";

interface Json {
  [key: string]: any;
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();

  const organization = await prisma.organization.findUnique({ where: { slug: "acme-software" } });
  if (!organization) {
    throw new Error("Run `npm run db:seed` first — no seeded organization found.");
  }

  // Running this twice is not harmless: subscription creation is idempotent,
  // but the renewals are not, so a second pass advances billing periods past
  // the usage events the first pass recorded and every meter then reads zero.
  // Refuse rather than leave a confusing dataset behind.
  const existing = await prisma.subscription.count({ where: { organizationId: organization.id } });
  if (existing > 0) {
    throw new Error(
      `This organization already has ${existing} subscriptions. Demo data is not idempotent — ` +
        "run `npm run db:reset && npm run db:seed` first, then this script."
    );
  }

  const { app } = await buildServer({ NODE_ENV: "test" } as never);
  await app.ready();

  // The seed prints its key once and does not keep it, so mint a fresh one for
  // this script rather than asking the operator to paste anything.
  const { generateApiKey } = await import("../apps/api/src/lib/api-keys");
  const { newId } = await import("@tierstack/shared");
  const generated = generateApiKey("SECRET", "TEST");
  await prisma.apiKey.create({
    data: {
      id: newId("apiKey"),
      organizationId: organization.id,
      name: "Demo data script",
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

  const people = [
    { externalId: "user_83921", email: "jonathan@example.test", name: "Jonathan Ade", price: "pro_monthly_ngn" },
    { externalId: "user_44120", email: "amaka@example.test", name: "Amaka Obi", price: "pro_annual_ngn" },
    { externalId: "user_51882", email: "tunde@example.test", name: "Tunde Bello", price: "starter_monthly_ngn" },
    { externalId: "user_66190", email: "chioma@example.test", name: "Chioma Eze", price: "pro_monthly_usd" },
  ];

  console.log("Creating paid subscribers…");
  for (const person of people) {
    const created = await call(
      "POST",
      "/v1/subscriptions",
      {
        customer: { externalId: person.externalId, email: person.email, name: person.name, country: "NG" },
        priceId: person.price,
        metadata: { mockOutcome: "SUCCESS" },
      },
      { "idempotency-key": `demo-${person.externalId}` }
    );
    console.log(`  ${person.name} → ${created.data?.subscription?.status ?? created.error?.code}`);
  }

  console.log("Adding a per-seat team…");
  const team = await call(
    "POST",
    "/v1/subscriptions",
    {
      customer: { externalId: "user_70011", email: "ops@brightlabs.test", name: "Bright Labs" },
      priceId: "team_seat_monthly_ngn",
      quantity: 12,
      metadata: { mockOutcome: "SUCCESS" },
    },
    { "idempotency-key": "demo-team" }
  );
  if (team.data?.subscription?.id) {
    await call("POST", `/v1/subscriptions/${team.data.subscription.id}/quantity`, { quantity: 18 });
    console.log("  Bright Labs → 12 seats, then raised to 18 (prorated)");
  }

  console.log("Renewing one subscriber into a second period…");
  const active = await call("GET", "/v1/subscriptions?status=ACTIVE&limit=1");
  const first = active.data?.items?.[0];
  if (first) {
    await call("POST", `/v1/subscriptions/${first.id}/renew`, {});
    console.log(`  ${first.customer?.externalId} renewed on its stored card`);
  }

  console.log("Upgrading a subscriber (proration)…");
  const toUpgrade = (await call("GET", "/v1/subscriptions?status=ACTIVE&limit=5")).data?.items?.find(
    (s: Json) => s.price?.code === "starter_monthly_ngn"
  );
  if (toUpgrade) {
    const upgraded = await call(
      "POST",
      `/v1/subscriptions/${toUpgrade.id}/change-plan`,
      { priceId: "pro_monthly_ngn" },
      { "idempotency-key": "demo-upgrade" }
    );
    console.log(`  net proration ${upgraded.data?.netAmount ?? "—"}`);
  }

  console.log("Putting one customer into a grace period…");
  const lapsing = await call(
    "POST",
    "/v1/subscriptions",
    {
      customer: { externalId: "user_90210", email: "lapsed@example.test", name: "Kemi Adeyemi" },
      priceId: "pro_monthly_ngn",
      metadata: { mockOutcome: "SUCCESS" },
    },
    { "idempotency-key": "demo-lapsing" }
  );
  if (lapsing.data?.subscription?.id) {
    const renewal = await call("POST", `/v1/subscriptions/${lapsing.data.subscription.id}/renew`, {
      metadata: { mockOutcome: "FAILED" },
    });
    console.log(`  Kemi Adeyemi → ${renewal.data?.subscription?.status ?? "?"}`);
  }

  console.log("Leaving one checkout abandoned…");
  await call(
    "POST",
    "/v1/subscriptions",
    {
      customer: { externalId: "user_00777", email: "ghost@example.test", name: "Never Paid" },
      priceId: "pro_monthly_ngn",
    },
    { "idempotency-key": "demo-abandoned" }
  );
  console.log("  Never Paid → INCOMPLETE (no grace period, no entitlements)");

  console.log("Adding a metered AI customer with real consumption…");
  const aiSub = await call(
    "POST",
    "/v1/subscriptions",
    {
      customer: { externalId: "user_ai_lab", email: "ops@ailab.test", name: "AI Lab" },
      priceId: "ai_hybrid_ngn",
      metadata: { mockOutcome: "SUCCESS" },
    },
    { "idempotency-key": "demo-ai" }
  );
  if (aiSub.data?.subscription?.id) {
    // A week of inference: mostly inside the allowance, tipping into overage.
    const batches = [18_500, 22_000, 31_250, 27_800, 14_600, 9_400];
    for (const [index, units] of batches.entries()) {
      await call("POST", "/v1/events/track", {
        customerId: "user_ai_lab",
        meter: "AI_TOKENS",
        units,
        eventId: `demo-ai-tokens-${index}`,
      });
    }
    const usage = await call("GET", "/v1/usage?customerId=user_ai_lab");
    const tokens = usage.data?.meters?.find((m: Json) => m.meterCode === "AI_TOKENS");
    console.log(
      `  AI Lab → ${tokens?.used?.toLocaleString()} tokens used, ${tokens?.overage?.toLocaleString()} over allowance`
    );

    // A second customer who stays comfortably inside their allowance.
    await call(
      "POST",
      "/v1/subscriptions",
      {
        customer: { externalId: "user_ai_calm", email: "hello@steadyai.test", name: "Steady AI" },
        priceId: "ai_hybrid_ngn",
        metadata: { mockOutcome: "SUCCESS" },
      },
      { "idempotency-key": "demo-ai-calm" }
    );
    await call("POST", "/v1/events/track", {
      customerId: "user_ai_calm",
      meter: "AI_TOKENS",
      units: 34_200,
      eventId: "demo-ai-calm-1",
    });
    console.log("  Steady AI → 34,200 tokens used, inside the allowance");
  }

  console.log("Starting a trial…");
  await call(
    "POST",
    "/v1/subscriptions",
    {
      customer: { externalId: "user_31337", email: "trial@example.test", name: "Ifeoma Nwosu" },
      priceId: "pro_monthly_ngn",
      trialDays: 14,
    },
    { "idempotency-key": "demo-trial" }
  );
  console.log("  Ifeoma Nwosu → TRIALING");

  // Enough customers that the tables and the customer picker are exercised past
  // one screenful. A dashboard that only ever holds ten rows never shows you
  // whether paging and search actually work.
  console.log("Filling out the customer list so paging and search have something to do…");
  const FIRST = ["Ada", "Chidi", "Zainab", "Tunde", "Amara", "Kwame", "Nneka", "Femi", "Halima", "Obi"];
  const LAST = ["Okafor", "Mensah", "Bello", "Achebe", "Danjuma", "Osei", "Eze", "Sadiq"];

  for (let index = 0; index < 48; index += 1) {
    const first = FIRST[index % FIRST.length]!;
    const last = LAST[Math.floor(index / FIRST.length) % LAST.length]!;
    await call("POST", "/v1/customers", {
      externalId: `user_9${String(index).padStart(4, "0")}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}${index}@example.test`,
      name: `${first} ${last}`,
      country: index % 3 === 0 ? "NG" : index % 3 === 1 ? "KE" : "GH",
    });
  }
  console.log("  48 further customers created (no subscriptions — they are list fodder)");

  const counts = await prisma.subscription.groupBy({
    by: ["status"],
    where: { organizationId: organization.id },
    _count: { _all: true },
  });

  console.log("\nSubscription states now in the database:");
  for (const row of counts) console.log(`  ${row.status.padEnd(14)} ${row._count._all}`);
  console.log("\nOpen the dashboard at http://localhost:8181\n");

  await app.close();
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
