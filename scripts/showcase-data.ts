/**
 * Fills the demo organization out to the size a real small SaaS would be, so
 * the dashboard screenshots on the marketing site show software doing work
 * rather than software with four rows in it.
 *
 *   yarn db:seed && yarn demo:data && yarn showcase:data
 *
 * Everything goes through the public API, exactly as an integration would. The
 * numbers that come out are therefore real arithmetic over real rows — the
 * point of showing the dashboard at all is that it is not a mockup.
 *
 * Names are invented. They read as plausible African software businesses
 * because the product is for African software businesses, and a screenshot
 * full of "Acme Corp" teaches a visitor nothing about who this is for.
 */
import { loadRootEnv } from "@tierstack/shared";

loadRootEnv();

import { createPrismaClient } from "@tierstack/database";
import { buildServer } from "../apps/api/src/server";

interface Json {
  [key: string]: any;
}

/** Monthly payers. Mixed plans, so the plan column is not one repeated word. */
const SUBSCRIBERS: Array<{ name: string; slug: string; price: string; seats?: number }> = [
  { name: "Ajala Logistics", slug: "ajala", price: "pro_monthly_ngn" },
  { name: "Zuri Health", slug: "zuri", price: "pro_monthly_ngn" },
  { name: "Bantu Labs", slug: "bantu", price: "team_seat_monthly_ngn", seats: 14 },
  { name: "Kesi Media", slug: "kesi", price: "starter_monthly_ngn" },
  { name: "Amara Systems", slug: "amara", price: "pro_annual_ngn" },
  { name: "Ndu Cloud", slug: "ndu", price: "pro_monthly_ngn" },
  { name: "Sifa Retail", slug: "sifa", price: "starter_monthly_ngn" },
  { name: "Chike Analytics", slug: "chike", price: "pro_monthly_ngn" },
  { name: "Obi Freight", slug: "obi", price: "team_seat_monthly_ngn", seats: 9 },
  { name: "Zola Energy", slug: "zola", price: "pro_annual_ngn" },
  { name: "Ife Interactive", slug: "ife", price: "starter_monthly_ngn" },
  { name: "Dala Foods", slug: "dala", price: "pro_monthly_ngn" },
  { name: "Kano Data", slug: "kano", price: "pro_monthly_ngn" },
  { name: "Mota Rides", slug: "mota", price: "team_seat_monthly_ngn", seats: 22 },
  { name: "Sade Health", slug: "sade", price: "starter_monthly_ngn" },
  { name: "Enugu Cloud", slug: "enugu", price: "pro_monthly_ngn" },
  { name: "Lekki Labs", slug: "lekki", price: "pro_annual_ngn" },
  { name: "Yaba Digital", slug: "yaba", price: "pro_monthly_ngn" },
  { name: "Aba Textiles", slug: "aba", price: "starter_monthly_ngn" },
  { name: "Jos Mining Co", slug: "jos", price: "pro_monthly_ngn" },
  { name: "Kigali Kits", slug: "kigali", price: "starter_monthly_ngn" },
  { name: "Accra Analytics", slug: "accra", price: "pro_monthly_ngn" },
  { name: "Nairobi Notes", slug: "nairobi", price: "pro_monthly_ngn" },
  { name: "Douala Data", slug: "douala", price: "team_seat_monthly_ngn", seats: 6 },
  { name: "Dakar Design", slug: "dakar", price: "starter_monthly_ngn" },
  { name: "Tema Transit", slug: "tema", price: "pro_monthly_ngn" },
  { name: "Ikeja Interactive", slug: "ikeja", price: "pro_monthly_ngn" },
  { name: "Kumasi Cloud", slug: "kumasi", price: "starter_monthly_ngn" },
  { name: "Lusaka Ledger", slug: "lusaka", price: "pro_monthly_ngn" },
  { name: "Abeokuta AI", slug: "abeokuta", price: "ai_hybrid_ngn" },
];

/** Two trials, so the trial column is populated without dominating. */
const TRIALS = [
  { name: "Harare Health", slug: "harare", price: "pro_monthly_ngn" },
  { name: "Onitsha Online", slug: "onitsha", price: "starter_monthly_ngn" },
];

/**
 * Two subscribers whose renewal declines. Not five — a dunning queue with five
 * open cases against forty subscribers is a business in trouble, and that is
 * not the picture. Two is what a healthy month actually looks like.
 */
const DECLINES = [
  { name: "Warri Works", slug: "warri", price: "pro_monthly_ngn" },
  { name: "Benin Books", slug: "benin", price: "starter_monthly_ngn" },
];

async function main(): Promise<void> {
  const prisma = createPrismaClient();

  const organization = await prisma.organization.findUnique({ where: { slug: "acme-software" } });
  if (!organization) throw new Error("Run `yarn db:seed` first — no seeded organization found.");

  const { app } = await buildServer({ NODE_ENV: "test" } as never);
  await app.ready();

  const { generateApiKey } = await import("../apps/api/src/lib/api-keys");
  const { newId } = await import("@tierstack/shared");
  const generated = generateApiKey("SECRET", "TEST");
  await prisma.apiKey.create({
    data: {
      id: newId("apiKey"),
      organizationId: organization.id,
      name: "Showcase data script",
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

  const created: string[] = [];

  console.log(`Adding ${SUBSCRIBERS.length} paying subscribers…`);
  for (const company of SUBSCRIBERS) {
    const result = await call(
      "POST",
      "/v1/subscriptions",
      {
        customer: {
          externalId: `co_${company.slug}`,
          email: `billing@${company.slug}.test`,
          name: company.name,
          country: "NG",
        },
        priceId: company.price,
        ...(company.seats ? { quantity: company.seats } : {}),
        metadata: { mockOutcome: "SUCCESS" },
      },
      { "idempotency-key": `showcase-${company.slug}` }
    );
    const id = result.data?.subscription?.id;
    if (id) created.push(id);
    else console.log(`  ! ${company.name} → ${result.error?.code ?? "unknown"}`);
  }
  console.log(`  ${created.length} active`);

  // A second and third period for the earlier cohort, so revenue collected and
  // the invoice list read as a business with a history rather than one that
  // opened this morning.
  console.log("Renewing the first two-thirds of them into later periods…");
  let renewals = 0;
  for (const id of created.slice(0, Math.floor(created.length * 0.66))) {
    const renewed = await call("POST", `/v1/subscriptions/${id}/renew`, {});
    if (renewed.data?.subscription) renewals += 1;
  }
  console.log(`  ${renewals} renewals collected on stored cards`);

  console.log("Starting two trials…");
  for (const trial of TRIALS) {
    await call(
      "POST",
      "/v1/subscriptions",
      {
        customer: {
          externalId: `co_${trial.slug}`,
          email: `billing@${trial.slug}.test`,
          name: trial.name,
          country: "NG",
        },
        priceId: trial.price,
        trialDays: 14,
      },
      { "idempotency-key": `showcase-trial-${trial.slug}` }
    );
  }

  console.log("Declining two renewals so the recovery queue has real work in it…");
  for (const decline of DECLINES) {
    const sub = await call(
      "POST",
      "/v1/subscriptions",
      {
        customer: {
          externalId: `co_${decline.slug}`,
          email: `billing@${decline.slug}.test`,
          name: decline.name,
          country: "NG",
        },
        priceId: decline.price,
        metadata: { mockOutcome: "SUCCESS" },
      },
      { "idempotency-key": `showcase-decline-${decline.slug}` }
    );
    if (sub.data?.subscription?.id) {
      await call("POST", `/v1/subscriptions/${sub.data.subscription.id}/renew`, {
        metadata: { mockOutcome: "FAILED" },
      });
    }
  }

  console.log("Recording API usage for the metered customer…");
  for (const [index, units] of [42_000, 38_500, 51_200, 29_900].entries()) {
    await call("POST", "/v1/events/track", {
      customerId: "co_abeokuta",
      meter: "AI_TOKENS",
      units,
      eventId: `showcase-tokens-${index}`,
    });
  }

  const counts = await prisma.subscription.groupBy({
    by: ["status"],
    where: { organizationId: organization.id },
    _count: { _all: true },
  });

  const attempts = await prisma.paymentAttempt.groupBy({
    by: ["status"],
    where: { organizationId: organization.id },
    _count: { _all: true },
  });

  console.log("\nSubscription states:");
  for (const row of counts) console.log(`  ${row.status.padEnd(14)} ${row._count._all}`);
  console.log("\nPayment attempts:");
  for (const row of attempts) console.log(`  ${row.status.padEnd(14)} ${row._count._all}`);

  await app.close();
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
