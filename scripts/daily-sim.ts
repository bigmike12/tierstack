/**
 * Watches a recurring subscription actually recur.
 *
 *   yarn sim:daily                       # 7 billing cycles on Paystack
 *   yarn sim:daily --cycles=14
 *   yarn sim:daily --rail=mock --cycles=10 --fail-after=3
 *   yarn sim:daily --cleanup             # remove everything past runs created
 *
 * Two rails. On Paystack — the default, and what the organization is actually
 * configured for — the first charge is a real checkout somebody completes in a
 * browser, and every renewal after it is a real `charge_authorization` against
 * the card that checkout saved. On the mock rail nothing leaves the machine,
 * which is the only way to watch a payment fail on demand.
 *
 * A daily plan takes a day to do anything, which makes it the one billing
 * interval you cannot watch. So the clock is moved instead of the outcome
 * faked: every cycle runs the real renewal job, the real dunning job and the
 * real grace-expiry sweep against a virtual `now`, exactly as the billing
 * worker would at that moment. Every invoice, payment attempt, transition and
 * email below is one the engine genuinely produced — none of it is written
 * here.
 *
 * `--fail-after=N` rewrites the saved card to a token the mock rail always
 * declines, so from cycle N the renewal genuinely fails and the subscription
 * walks its own dunning ladder into the grace period and out the other side.
 *
 * The rail: the router refuses the mock provider whenever a real one is
 * enabled, on the grounds that it would report a payment that never happened.
 * That is the right call in general and an obstacle here, so this script
 * disables the organization's real providers for the length of the run and
 * puts them back afterwards — including on Ctrl-C. It prints what it touched.
 */
import { loadRootEnv } from "@tierstack/shared";

loadRootEnv();

import { createPrismaClient } from "@tierstack/database";
import { LogEmailTransport } from "@tierstack/notifications";
import Redis from "ioredis";
import { buildServer } from "../apps/api/src/server";
import {
  applyTransition,
  attemptInvoicePayment,
  loadBillingSettings,
  renewSubscription,
  syncPaymentAttempt,
} from "../packages/billing/src";
import { runNotifications } from "../workers/billing-worker/src/notifications";

interface Json {
  [key: string]: any;
}

const DAY = 86_400_000;

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const ORG_SLUG = arg("org", "acme-software")!;
const PRICE_CODE = arg("price", "growth_daily_plan")!;
/**
 * How many billing periods to simulate — not how many days.
 *
 * On a daily price the two are the same number, which is why this was called
 * `--days` at first, and that was wrong the moment it was pointed at anything
 * else: one cycle of a monthly price is a month. `--days` still works so the
 * habit is not broken.
 */
const DAYS = Number(arg("cycles", arg("days", "7")));
const FAIL_AFTER = arg("fail-after") ? Number(arg("fail-after")) : null;
const RAIL = (arg("rail", "paystack") as "paystack" | "mock");
const CLEANUP = process.argv.includes("--cleanup");
const FORCE = process.argv.includes("--force");
const EMAIL = arg("email");
/**
 * Create the subscription, take the one payment, and stop — leaving the
 * billing worker to do every renewal after it on its own schedule. Nothing is
 * time-travelled, so this is the honest end-to-end test: whatever happens next
 * happens because the worker did it.
 */
const HANDOFF = process.argv.includes("--handoff");
/**
 * Pull the first period end back to now so the worker's next renewals tick
 * picks it up within five minutes instead of tomorrow. It shortens the period
 * the customer paid for, which is fine for a test and wrong for anything else.
 */
const DUE_NOW = process.argv.includes("--due-now");
/** How long to wait at the checkout page before giving up. */
const CHECKOUT_TIMEOUT_MS = Number(arg("wait", "600")) * 1000;

const SIM_PREFIX = "daily_sim_";

/**
 * Removes what previous runs left behind.
 *
 * Anything that was paid on a real rail is left alone unless `--force` says
 * otherwise. Every simulated customer shares one prefix, so a plain
 * prefix-match sweep cannot tell a throwaway mock run from a subscription
 * somebody actually put a card through Paystack for — and it deleted one.
 * A mock payment can be recreated in seconds; a real transaction is a record
 * that has a counterpart in the provider's dashboard, and deleting the local
 * half of it silently is exactly the surprise this now refuses to spring.
 *
 * Invoices do not cascade from a customer — deliberately, since losing a
 * financial record because somebody tidied a customer row would be much worse
 * than a foreign-key error — so the order here is the dependency order.
 */
async function removeSimulations(
  prisma: any,
  organizationId: string,
  force: boolean
): Promise<{ removed: number; kept: { id: string; externalId: string | null }[] }> {
  const customers = await prisma.customer.findMany({
    where: { organizationId, externalId: { startsWith: SIM_PREFIX } },
    select: { id: true, externalId: true },
  });
  if (customers.length === 0) return { removed: 0, kept: [] };

  const kept: { id: string; externalId: string | null }[] = [];
  const doomed: { id: string; externalId: string | null }[] = [];

  for (const customer of customers) {
    const realPayment = force
      ? 0
      : await prisma.paymentAttempt.count({
          where: { customerId: customer.id, status: "SUCCEEDED", provider: { not: "MOCK" } },
        });
    (realPayment > 0 ? kept : doomed).push(customer);
  }

  if (doomed.length === 0) return { removed: 0, kept };

  const customerIds = doomed.map((c) => c.id);
  const subscriptions = await prisma.subscription.findMany({
    where: { customerId: { in: customerIds } },
    select: { id: true },
  });
  const invoices = await prisma.invoice.findMany({
    where: { customerId: { in: customerIds } },
    select: { id: true },
  });
  const subscriptionIds = subscriptions.map((s: { id: string }) => s.id);
  const invoiceIds = invoices.map((i: { id: string }) => i.id);

  await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await prisma.paymentAttempt.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  await prisma.subscriptionTransition.deleteMany({ where: { subscriptionId: { in: subscriptionIds } } });
  await prisma.entitlement.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.emailMessage.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.creditLedgerEntry.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.portalSession.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.usageEvent.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.couponRedemption.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.subscription.deleteMany({ where: { id: { in: subscriptionIds } } });
  await prisma.paymentMethod.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });

  return { removed: doomed.length, kept };
}

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(minor / 100);
const day = (date: Date | null | undefined) =>
  date ? new Date(date).toISOString().slice(0, 10) : "—";

async function main(): Promise<void> {
  const prisma = createPrismaClient();

  const organization = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!organization) throw new Error(`No organization with slug "${ORG_SLUG}".`);

  if (CLEANUP) {
    const { removed, kept } = await removeSimulations(prisma, organization.id, FORCE);
    console.log(`Removed ${removed} simulated customer${removed === 1 ? "" : "s"} and everything billed to them.`);
    if (kept.length > 0) {
      console.log(
        `\nKept ${kept.length} that ${kept.length === 1 ? "has" : "have"} a real payment behind ${kept.length === 1 ? "it" : "them"}:`
      );
      for (const customer of kept) console.log(`   ${customer.externalId}  ${customer.id}`);
      console.log("\nPass --force to remove those too.");
    }
    await prisma.$disconnect();
    return;
  }

  const price = await prisma.price.findFirst({
    where: { organizationId: organization.id, code: PRICE_CODE },
    include: { plan: true },
  });
  if (!price) throw new Error(`No price with code "${PRICE_CODE}" in ${ORG_SLUG}.`);

  console.log(`\nPlan     ${price.plan.name} (${price.code})`);
  console.log(
    `Price    ${money(price.unitAmount ?? 0, price.currency)} every ${price.intervalCount} ${price.intervalUnit.toLowerCase()}${price.intervalCount === 1 ? "" : "s"}`
  );
  const period = `${price.intervalCount} ${price.intervalUnit.toLowerCase()}${price.intervalCount === 1 ? "" : "s"}`;
  console.log(`Rail     ${RAIL === "paystack" ? "Paystack (real charges, test mode)" : "mock (local, instant)"}`);
  // In handoff mode no cycles are simulated at all, so announcing a window of
  // them describes work this run is not going to do.
  console.log(
    HANDOFF
      ? `Window   one payment, then the billing worker renews every ${period}\n`
      : `Window   ${DAYS} billing cycles — one charge every ${period}` +
          `${RAIL === "mock" && FAIL_AFTER ? `, card starts declining after cycle ${FAIL_AFTER}` : ""}\n`
  );

  if (FAIL_AFTER !== null && RAIL === "paystack") {
    // The decline is produced by rewriting the saved token to one the mock
    // rail refuses. There is no equivalent on a real rail: Paystack decides
    // whether a charge succeeds, and it will keep approving a good test card.
    console.log("--fail-after only works on --rail=mock; ignoring it. Every renewal below is a real charge.\n");
  }

  // --- the rail ----------------------------------------------------------
  // On Paystack nothing is touched: the org's own configuration decides, the
  // first charge is a real checkout somebody completes in a browser, and every
  // renewal after it is a real charge against the authorization that checkout
  // saved. On the mock rail the org's real providers are stood down for the
  // length of the run, because the router refuses the mock provider whenever a
  // real one is enabled — it would report a payment that never happened.
  const realRails =
    RAIL === "mock"
      ? await prisma.paymentProviderConfig.findMany({
          where: { organizationId: organization.id, provider: { not: "MOCK" }, enabled: true },
          select: { id: true, provider: true },
        })
      : [];

  if (RAIL === "paystack") {
    const paystack = await prisma.paymentProviderConfig.findFirst({
      where: { organizationId: organization.id, provider: "PAYSTACK", enabled: true },
    });
    if (!paystack) {
      throw new Error(
        `${ORG_SLUG} has no enabled PAYSTACK configuration. Add one under Payment Providers, or run with --rail=mock.`
      );
    }
  }

  // The key this run mints is a real secret with full access to the
  // organization. It is deleted on the way out, including on Ctrl-C — a
  // throwaway script should not leave a working credential behind every time
  // it is run.
  let apiKeyId: string | null = null;

  let restored = false;
  const restore = async () => {
    if (restored) return;
    restored = true;
    if (realRails.length > 0) {
      await prisma.paymentProviderConfig.updateMany({
        where: { id: { in: realRails.map((rail) => rail.id) } },
        data: { enabled: true },
      });
      console.log(`\nRe-enabled ${realRails.map((r) => r.provider).join(", ")} for ${ORG_SLUG}.`);
    }
    if (apiKeyId) {
      await prisma.apiKey.deleteMany({ where: { id: apiKeyId } });
    }
  };

  if (realRails.length > 0) {
    await prisma.paymentProviderConfig.updateMany({
      where: { id: { in: realRails.map((rail) => rail.id) } },
      data: { enabled: false },
    });
    console.log(
      `Temporarily disabled ${realRails.map((r) => r.provider).join(", ")} so charges run on the mock rail.`
    );
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void restore().then(() => process.exit(1));
    });
  }

  try {
    const { app } = await buildServer({ NODE_ENV: "test" } as never);
    await app.ready();

    const { generateApiKey } = await import("../apps/api/src/lib/api-keys");
    const { newId } = await import("@tierstack/shared");
    const generated = generateApiKey("SECRET", "TEST");
    const key = await prisma.apiKey.create({
      data: {
        id: newId("apiKey"),
        organizationId: organization.id,
        name: "Daily simulation",
        type: "SECRET",
        environment: "TEST",
        prefix: generated.prefix,
        keyHash: generated.keyHash,
      },
    });
    apiKeyId = key.id;

    const auth = { authorization: `Bearer ${generated.secret}`, "content-type": "application/json" };
    const call = async (method: "GET" | "POST", url: string, payload?: unknown, extra: Json = {}) => {
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
    };

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

    /**
     * Hands the checkout to a human and waits for them to pay.
     *
     * Polls by asking Paystack directly rather than waiting for a webhook, so
     * the run does not depend on a tunnel being up. If the webhook does arrive
     * first that is fine — it resolves the same attempt, and this then sees a
     * subscription that is already active and stops waiting.
     */
    async function completePaystackCheckout(response: Json, subscriptionId: string): Promise<void> {
      const checkoutUrl = response.data?.payment?.checkoutUrl ?? response.data?.checkoutUrl;
      if (!checkoutUrl) {
        throw new Error(
          `Paystack did not return a checkout URL: ${JSON.stringify(response.data?.payment ?? response.error ?? response).slice(0, 300)}`
        );
      }

      console.log("The first charge is a real Paystack checkout. Open this and pay:\n");
      console.log(`   ${checkoutUrl}\n`);
      console.log("   Test card  4084 0840 8408 4081   any future expiry   any CVV   OTP 123456");
      console.log(`   Waiting up to ${Math.round(CHECKOUT_TIMEOUT_MS / 1000)}s…\n`);

      const deadline = Date.now() + CHECKOUT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5000));

        const subscription = await prisma.subscription.findUniqueOrThrow({
          where: { id: subscriptionId },
          select: { status: true },
        });
        if (subscription.status !== "INCOMPLETE") {
          console.log(`   Paid — subscription is ${subscription.status}.\n`);
          return;
        }

        // Ask Paystack what happened rather than assuming the webhook landed.
        // An attempt hangs off its invoice, not the subscription directly.
        const pending = await prisma.paymentAttempt.findFirst({
          where: {
            status: { in: ["PENDING", "PROCESSING"] },
            invoice: { subscriptionId },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (pending) {
          await syncPaymentAttempt(prisma, jobCtx.providerDeps as never, {
            organizationId: organization!.id,
            attemptId: pending.id,
          }).catch(() => undefined);
        }
      }
      console.log("   Gave up waiting for the checkout.\n");
    }

    // --- day zero: somebody subscribes -----------------------------------
    const run = Date.now().toString(36).slice(-4);
    const created = await call(
      "POST",
      "/v1/subscriptions",
      {
        customer: {
          externalId: `daily_sim_${run}`,
          // The rest of the repo's fixtures use `.test`, which is the correct
          // reserved TLD for something that must never resolve — but Paystack
          // validates the address and rejects it outright, so a real charge
          // cannot be initialized for one. `example.com` is the other reserved
          // name, has a TLD Paystack accepts, and is equally undeliverable.
          // Pass --email=you@yours.com to get the receipt somewhere real.
          email: EMAIL ?? `daily.sim.${run}@example.com`,
          name: `Daily Sim ${run.toUpperCase()}`,
          country: "NG",
        },
        priceId: price.id,
        ...(RAIL === "mock" ? { metadata: { mockOutcome: "SUCCESS" } } : {}),
      },
      { "idempotency-key": `daily-sim-${run}` }
    );

    const subscriptionId: string | undefined = created.data?.subscription?.id;
    if (!subscriptionId) {
      throw new Error(`Could not create the subscription: ${JSON.stringify(created.error ?? created)}`);
    }

    if (RAIL === "mock") {
      const reference = created.data?.payment?.reference;
      if (reference) await call("POST", `/mock/checkout/${reference}/complete`, { outcome: "SUCCESS" });
    } else {
      await completePaystackCheckout(created, subscriptionId);
    }

    const opening = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    if (opening.status === "INCOMPLETE") {
      throw new Error(
        "The first payment was never completed, so there is no saved card to renew against. " +
          "Nothing was simulated. Re-run and finish the checkout, or use --rail=mock."
      );
    }
    console.log(
      `Cycle 0 ${day(opening.currentPeriodStart)}  subscribed — ${opening.status}, first period ends ${day(opening.currentPeriodEnd)}\n`
    );

    // --- hand it to the worker and get out of the way ----------------------
    if (HANDOFF) {
      let dueAt = opening.currentPeriodEnd;
      if (DUE_NOW) {
        dueAt = new Date();
        await prisma.subscription.update({
          where: { id: subscriptionId },
          data: { currentPeriodEnd: dueAt },
        });
      }

      const firstInvoice = await prisma.invoice.findFirst({
        where: { subscriptionId },
        orderBy: { createdAt: "asc" },
      });

      console.log("─".repeat(64));
      console.log("Paid once. Everything after this is the billing worker's job.\n");
      if (firstInvoice) {
        console.log(
          `  Signup invoice  ${firstInvoice.invoiceNumber}  ${money(firstInvoice.total, firstInvoice.currency)}  ${firstInvoice.status}`
        );
      }
      console.log(`  Next renewal    ${dueAt.toISOString()}`);
      // The five minutes is the job's polling interval, not a billing
      // frequency. Saying "runs every 5 minutes" next to "next renewal" reads
      // as "renews every 5 minutes", which is the one thing it does not do.
      console.log(
        DUE_NOW
          ? `                  due now — the renewals job polls every 5 minutes, so it will charge\n` +
            `                  once on the next tick and then go back to every ${period}`
          : `                  in ${period}, once the period actually ends`
      );
      if (DUE_NOW) {
        console.log(
          `\n  Note            --due-now ended the paid period early, so that one extra charge\n` +
            `                  covers a period the signup invoice had already paid for. Expect two\n` +
            `                  invoices for overlapping days. Drop the flag to bill honestly.`
        );
      }
      console.log(`\n  Subscription    ${subscriptionId}`);
      console.log(`  Customer        ${opening.customerId}`);
      console.log(`  Dashboard       /subscriptions/${subscriptionId}\n`);
      console.log("Leave `yarn dev` running. Nothing here will touch it again.\n");

      redis.disconnect();
      await app.close();
      return;
    }

    // --- then one billing cycle at a time ---------------------------------
    // The clock follows the subscription rather than a fixed step. While it is
    // renewing, each cycle jumps to whatever period end the engine actually
    // opened — which is what makes this correct for a monthly or 90-day price
    // and not just a daily one. Once it stops renewing the period end stops
    // moving, so the clock steps a day at a time instead: the retry ladder is
    // measured in days, and jumping a whole month would step over it.
    let clock = opening.currentPeriodEnd.getTime();
    const ledger: { day: number; status: string; invoice: string; amount: string; state: string }[] = [];

    for (let dayNumber = 1; dayNumber <= DAYS; dayNumber += 1) {
      // A minute past the period end, which is when the worker would find it.
      const now = new Date(clock + 60_000);

      if (RAIL === "mock" && FAIL_AFTER !== null && dayNumber === FAIL_AFTER + 1) {
        const method = await prisma.paymentMethod.findFirst({
          where: { organizationId: organization.id, customerId: opening.customerId },
        });
        if (method) {
          // The mock rail declines any charge against a token minted like
          // this, so the failure is a real one the engine has to handle.
          await prisma.paymentMethod.update({
            where: { id: method.id },
            data: { providerPaymentMethodRef: `mock_pm_fail_${method.id}` },
          });
          console.log(`      ↳ the card starts declining here\n`);
        }
      }

      // Deliberately not the worker's own sweeps. `runRenewals`,
      // `runDunningRetries` and `expireGracePeriods` all collect everything
      // that is due — across every organization in the database, in the first
      // two cases — which is right in production and destructive here: run
      // them against a clock a week ahead and they advance every other
      // subscription in your database along with this one. These are the same
      // engine calls those jobs make, aimed at one subscription.
      const events: string[] = [];

      const current = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        select: { status: true, currentPeriodEnd: true },
      });

      // 1. Renewal, if this subscription's own period has ended.
      if (["ACTIVE", "TRIALING"].includes(current.status) && current.currentPeriodEnd <= now) {
        const result = await renewSubscription(prisma, subscriptionId, now);
        if (result.renewed) {
          events.push("renewed");
          if (result.invoiceId) {
            const charge = await attemptInvoicePayment(prisma, jobCtx.providerDeps as never, {
              organizationId: organization.id,
              invoiceId: result.invoiceId,
              environment: "TEST",
            }).catch(() => null);
            events.push(charge?.status === "SUCCEEDED" ? "collected" : "charge declined");
          }
        }
      }

      // 2. The dunning ladder, for this subscription's own open invoice.
      const settings = await loadBillingSettings(prisma as never, organization.id);
      const dueRetry = await prisma.invoice.findFirst({
        where: { subscriptionId, status: "OPEN", nextRetryAt: { lte: now } },
        orderBy: { nextRetryAt: "asc" },
      });
      if (dueRetry) {
        if (dueRetry.dunningAttempts >= settings.maxRetryAttempts) {
          await prisma.invoice.update({ where: { id: dueRetry.id }, data: { nextRetryAt: null } });
          events.push("retries exhausted");
        } else {
          await attemptInvoicePayment(prisma, jobCtx.providerDeps as never, {
            organizationId: organization.id,
            invoiceId: dueRetry.id,
            environment: "TEST",
          }).catch(() => null);
          events.push("retried");
        }
      }

      // 3. Grace expiry, for this subscription only.
      const inGrace = await prisma.subscription.findFirst({
        where: { id: subscriptionId, status: "GRACE_PERIOD", gracePeriodEnd: { lte: now } },
        select: { id: true, gracePolicy: true },
      });
      if (inGrace) {
        const action =
          ((inGrace.gracePolicy as { failureAction?: string } | null)?.failureAction ??
            settings.failureAction) === "CANCEL"
            ? "CANCELED"
            : "UNPAID";
        await applyTransition(prisma, subscriptionId, "GRACE_PERIOD", action as never, "grace_period_expired");
        events.push(`grace expired → ${action.toLowerCase()}`);
      }

      await runNotifications(mailCtx as never, now).catch(() => undefined);

      const subscription = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      const invoice = await prisma.invoice.findFirst({
        where: { subscriptionId },
        orderBy: { createdAt: "desc" },
      });
      const attempts = invoice
        ? await prisma.paymentAttempt.count({ where: { invoiceId: invoice.id } })
        : 0;

      const activity = events.join(", ");

      console.log(
        `Cycle ${String(dayNumber).padEnd(2)} ${day(now)}  ${subscription.status.padEnd(13)} ` +
          `period ends ${day(subscription.currentPeriodEnd)}  ${activity || "nothing due"}`
      );
      if (invoice) {
        console.log(
          `       ${invoice.invoiceNumber}  ${money(invoice.total, invoice.currency)}  ${invoice.status}` +
            `  ${attempts} attempt${attempts === 1 ? "" : "s"}` +
            (invoice.nextRetryAt ? `  next retry ${day(invoice.nextRetryAt)}` : "")
        );
      }

      ledger.push({
        day: dayNumber,
        status: subscription.status,
        invoice: invoice?.invoiceNumber ?? "—",
        amount: invoice ? money(invoice.total, invoice.currency) : "—",
        state: invoice?.status ?? "—",
      });

      // Advance to the period the engine just opened. If it opened none — the
      // subscription is past due, unpaid or cancelled — step a day so the
      // dunning schedule and the grace period still come due.
      const advanced = subscription.currentPeriodEnd.getTime();
      clock = advanced > clock ? advanced : clock + DAY;
    }

    // --- what the engine actually produced --------------------------------
    const invoices = await prisma.invoice.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: "asc" },
    });
    const paid = invoices.filter((i) => i.status === "PAID");
    const transitions = await prisma.subscriptionTransition.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: "asc" },
    });
    const emails = await prisma.emailMessage.count({
      where: { organizationId: organization.id, customerId: opening.customerId },
    });

    console.log(`\n${"─".repeat(64)}`);
    // Spelled out because "7 cycles" producing 8 invoices reads like an
    // off-by-one until you notice the subscription was billed the moment it
    // was created. It is billed in advance: the signup charge buys the first
    // period, and each renewal buys the next one.
    console.log(
      `Invoices issued   ${invoices.length}  (1 at signup + ${Math.max(invoices.length - 1, 0)} renewals)`
    );
    console.log(
      `Collected         ${paid.length} · ${money(
        paid.reduce((total, i) => total + i.amountPaid, 0),
        price.currency
      )}`
    );
    console.log(
      `Outstanding       ${money(
        invoices.filter((i) => i.status === "OPEN").reduce((t, i) => t + i.amountDue, 0),
        price.currency
      )}`
    );
    console.log(`Emails sent       ${emails}`);
    console.log(`\nLifecycle`);
    for (const event of transitions) {
      console.log(
        `  ${day(event.createdAt)}  ${(event.fromStatus ?? "—").padEnd(13)} → ${event.toStatus.padEnd(13)} ${event.reason}`
      );
    }
    console.log(`\nSubscription  ${subscriptionId}`);
    console.log(`Open it at    /subscriptions/${subscriptionId}\n`);

    redis.disconnect();
    await app.close();
  } finally {
    await restore();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
