/**
 * Seeds a working local environment: one organization with an owner, a test API
 * key, the MOCK payment rail, a small plan catalogue in two currencies, and a
 * couple of customers. Running it twice is safe — everything is keyed on a
 * stable slug or code.
 */
import { createHash, randomBytes } from "node:crypto";
import { loadRootEnv } from "@tierstack/shared";

// Load the monorepo .env before anything reads process.env.
loadRootEnv();

import { createPrismaClient } from "@tierstack/database";
import { encryptCredentials } from "@tierstack/payments-core";
import { newId } from "@tierstack/shared";
import { scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (p: string, s: Buffer, l: number) => Promise<Buffer>;

const SEED_EMAIL = process.env.SEED_EMAIL ?? "founder@example.test";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "correct-horse-battery-staple";
const SEED_ORG = process.env.SEED_ORG ?? "Acme Software";
const SEED_ORG_SLUG = "acme-software";

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

function apiKey(prefix: string): { secret: string; prefix: string; keyHash: string } {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(32);
  let token = "";
  for (let i = 0; i < 32; i += 1) token += alphabet[bytes[i]! % alphabet.length];
  const secret = `${prefix}${token}`;
  return {
    secret,
    prefix: secret.slice(0, prefix.length + 4),
    keyHash: createHash("sha256").update(secret).digest("hex"),
  };
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();

  const organization = await prisma.organization.upsert({
    where: { slug: SEED_ORG_SLUG },
    create: { id: newId("organization"), name: SEED_ORG, slug: SEED_ORG_SLUG },
    update: { name: SEED_ORG },
  });

  const user = await prisma.user.upsert({
    where: { email: SEED_EMAIL },
    create: {
      id: newId("user"),
      email: SEED_EMAIL,
      name: "Seed Founder",
      passwordHash: await hashPassword(SEED_PASSWORD),
    },
    update: {},
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    create: {
      id: newId("member"),
      organizationId: organization.id,
      userId: user.id,
      role: "OWNER",
      acceptedAt: new Date(),
    },
    update: { role: "OWNER", removedAt: null },
  });

  await prisma.billingSettings.upsert({
    where: { organizationId: organization.id },
    create: {
      id: newId("organization"),
      organizationId: organization.id,
      gracePeriodDays: 7,
      maxRetryAttempts: 4,
      retryIntervals: [0, 1, 3, 5],
      accessDuringGracePeriod: "FULL_ACCESS",
      failureAction: "MARK_UNPAID",
      defaultCurrency: "NGN",
    },
    update: {},
  });

  // The mock rail needs no real credentials, but it is stored through exactly
  // the same encrypted path a real provider would be.
  await prisma.paymentProviderConfig.upsert({
    where: {
      organizationId_provider_environment: {
        organizationId: organization.id,
        provider: "MOCK",
        environment: "TEST",
      },
    },
    create: {
      id: newId("providerConfig"),
      organizationId: organization.id,
      provider: "MOCK",
      environment: "TEST",
      encryptedCredentials: encryptCredentials(
        { webhookSecret: "whsec_mock_local" },
        organization.id
      ),
      enabled: true,
      isDefault: true,
      priority: 10,
    },
    update: {},
  });

  const meters = [
    { code: "AI_TOKENS", name: "AI tokens", unitLabel: "tokens", aggregation: "SUM" },
    { code: "API_CALLS", name: "API calls", unitLabel: "calls", aggregation: "SUM" },
  ] as const;

  for (const spec of meters) {
    await prisma.usageMeter.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: spec.code } },
      create: {
        id: newId("usageMeter"),
        organizationId: organization.id,
        code: spec.code,
        name: spec.name,
        unitLabel: spec.unitLabel,
        aggregation: spec.aggregation,
      },
      update: { name: spec.name, unitLabel: spec.unitLabel },
    });
  }

  const tokenMeter = await prisma.usageMeter.findUnique({
    where: { organizationId_code: { organizationId: organization.id, code: "AI_TOKENS" } },
  });

  const plans = [
    {
      code: "starter",
      name: "Starter",
      description: "For side projects finding their first users.",
      features: { export_pdf: false, team_members: 1, support: "community" },
      prices: [
        { code: "starter_monthly_ngn", currency: "NGN", unitAmount: 500_000, interval: "MONTH" },
        { code: "starter_monthly_usd", currency: "USD", unitAmount: 900, interval: "MONTH" },
      ],
    },
    {
      code: "pro",
      name: "Pro",
      description: "For teams shipping to paying customers.",
      features: { export_pdf: true, advanced_analytics: true, team_members: 5 },
      prices: [
        { code: "pro_monthly_ngn", currency: "NGN", unitAmount: 1_000_000, interval: "MONTH" },
        { code: "pro_annual_ngn", currency: "NGN", unitAmount: 10_000_000, interval: "YEAR" },
        { code: "pro_monthly_usd", currency: "USD", unitAmount: 2_900, interval: "MONTH" },
      ],
    },
    {
      code: "team",
      name: "Team",
      description: "Priced per seat.",
      features: { export_pdf: true, advanced_analytics: true, sso: true },
      prices: [{ code: "team_seat_monthly_ngn", currency: "NGN", unitAmount: 200_000, interval: "MONTH", model: "PER_SEAT" }],
    },
    {
      code: "ai",
      name: "AI",
      description: "A base fee plus metered inference — the hybrid model.",
      features: { export_pdf: true, advanced_analytics: true, team_members: 10 },
      prices: [
        {
          code: "ai_hybrid_ngn",
          currency: "NGN",
          unitAmount: 1_500_000,
          interval: "MONTH",
          model: "HYBRID",
          meter: "AI_TOKENS",
          includedUnits: 100_000,
          usageUnitAmount: 5_000,
          usageUnitSize: 1_000,
        },
      ],
    },
  ] as const;

  for (const planSpec of plans) {
    const plan = await prisma.plan.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: planSpec.code } },
      create: {
        id: newId("plan"),
        organizationId: organization.id,
        code: planSpec.code,
        name: planSpec.name,
        description: planSpec.description,
        features: planSpec.features as never,
      },
      update: { name: planSpec.name, features: planSpec.features as never },
    });

    for (const priceSpec of planSpec.prices) {
      await prisma.price.upsert({
        where: { organizationId_code: { organizationId: organization.id, code: priceSpec.code } },
        create: {
          id: newId("price"),
          organizationId: organization.id,
          planId: plan.id,
          code: priceSpec.code,
          model: "model" in priceSpec ? (priceSpec.model as never) : "FLAT_RECURRING",
          currency: priceSpec.currency,
          unitAmount: priceSpec.unitAmount,
          intervalUnit: priceSpec.interval as never,
          intervalCount: 1,
          usageMeterId: "meter" in priceSpec && priceSpec.meter === "AI_TOKENS" ? (tokenMeter?.id ?? null) : null,
          includedUnits: "includedUnits" in priceSpec ? priceSpec.includedUnits : null,
          usageUnitAmount: "usageUnitAmount" in priceSpec ? priceSpec.usageUnitAmount : null,
          usageUnitSize: "usageUnitSize" in priceSpec ? priceSpec.usageUnitSize : 1,
        },
        update: {},
      });
    }
  }

  for (const spec of [
    { externalId: "user_83921", email: "jonathan@example.test", name: "Jonathan", country: "NG" },
    { externalId: "user_44120", email: "amaka@example.test", name: "Amaka", country: "NG" },
  ]) {
    await prisma.customer.upsert({
      where: { organizationId_externalId: { organizationId: organization.id, externalId: spec.externalId } },
      create: {
        id: newId("customer"),
        organizationId: organization.id,
        externalId: spec.externalId,
        email: spec.email,
        name: spec.name,
        country: spec.country,
        currency: "NGN",
      },
      update: {},
    });
  }

  const existingKeys = await prisma.apiKey.count({
    where: { organizationId: organization.id, type: "SECRET", environment: "TEST", revokedAt: null },
  });

  let secret: string | null = null;
  if (existingKeys === 0) {
    const generated = apiKey("sk_test_");
    await prisma.apiKey.create({
      data: {
        id: newId("apiKey"),
        organizationId: organization.id,
        name: "Seed test key",
        type: "SECRET",
        environment: "TEST",
        prefix: generated.prefix,
        keyHash: generated.keyHash,
      },
    });
    secret = generated.secret;
  }

  /* eslint-disable no-console */
  console.log("\nSeed complete.\n");
  console.log(`  Organization  ${organization.name} (${organization.id})`);
  console.log(`  Dashboard     ${SEED_EMAIL} / ${SEED_PASSWORD}`);
  console.log(`  Provider      MOCK (test), default`);
  console.log(`  Plans         starter, pro, team, ai (hybrid + metered)`);
  console.log(`  Meters        AI_TOKENS, API_CALLS`);
  if (secret) {
    console.log(`\n  Test secret key (shown once):\n    ${secret}\n`);
  } else {
    console.log(`\n  A test secret key already exists. Create another from the API if you need one.\n`);
  }
  /* eslint-enable no-console */

  await prisma.$disconnect();
}

main().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
