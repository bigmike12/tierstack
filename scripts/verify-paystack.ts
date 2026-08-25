/**
 * Walks one real payment all the way through Paystack and checks what actually
 * happened at every step.
 *
 *   npx tsx scripts/verify-paystack.ts --key sk_test_YOUR_TIERSTACK_KEY
 *
 * This talks to the running API over HTTP rather than building its own server,
 * which matters: the webhook Paystack sends has to reach the same process that
 * opened the checkout, and that is the one behind your tunnel.
 *
 * Nothing here is mocked. It is the only check that can tell you the adapter
 * works, because unit tests against a recorded transport cannot.
 *
 * Optional flags:
 *   --price <code>   which price to subscribe to (default: first live NGN price)
 *   --email <addr>   the customer's email (Paystack sends a receipt there)
 *   --api <url>      API base URL (default: API_URL from .env, or :4000)
 *   --renew          also run an immediate renewal charge after settlement
 */

import { createInterface } from "node:readline/promises";
import { loadRootEnv } from "@tierstack/shared";

loadRootEnv();

const args = process.argv.slice(2);

const flag = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const API = (flag("api") ?? process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const KEY = flag("key") ?? process.env.TIERSTACK_API_KEY ?? "";
const EMAIL = flag("email") ?? `paystack-test-${Date.now()}@gmail.com`;
const EXTERNAL_ID = `user_paystack_${Date.now()}`;
const RUN_RENEWAL_CHECK = hasFlag("renew");

let passed = 0;
let failed = 0;
const problems: string[] = [];

function check(label: string, ok: boolean, detail?: unknown): boolean {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed += 1;
    problems.push(label);
    console.log(`  \x1b[31m✗\x1b[0m ${label}`);
    if (detail !== undefined) {
      console.log(`      ${JSON.stringify(detail).slice(0, 500)}`);
    }
  }

  return ok;
}

function section(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

function note(message: string): void {
  console.log(`  \x1b[2m${message}\x1b[0m`);
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any; error: any }> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${KEY}`,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const envelope = await response
    .json()
    .catch(() => ({ data: null, error: { message: "unreadable" } }));

  return {
    status: response.status,
    data: envelope.data,
    error: envelope.error,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  console.log(`\n\x1b[1mPaystack live verification\x1b[0m  →  ${API}\n`);

  if (!KEY) {
    console.error(
      "Pass a Tierstack secret key:\n" +
        "  npx tsx scripts/verify-paystack.ts --key sk_test_...\n\n" +
        "Create one in the dashboard under API Keys if you do not have it.\n"
    );
    process.exit(1);
  }

  // -- 1. Is anything listening -----------------------------------------------

  section("1. The API");

  const health = await fetch(`${API}/health`).catch(() => null);

  if (!check("API is reachable", health?.ok === true, `${API}/health`)) {
    console.error("\nStart it with `yarn dev`, then run this again.\n");
    process.exit(1);
  }

  // -- 2. Provider configuration ----------------------------------------------

  section("2. Provider configuration");

  const providers = await api("GET", "/v1/payment-providers");

  if (providers.status === 401) {
    console.error("\nThat API key was rejected. Check it under API Keys in the dashboard.\n");
    process.exit(1);
  }

  const configs: any[] = providers.data ?? [];
  const paystack = configs.find((c) => c.provider === "PAYSTACK");

  if (!check("Paystack is configured", Boolean(paystack), configs.map((c) => c.provider))) {
    console.error(
      "\nAdd it in the dashboard under Payment Providers, with `secretKey=sk_test_...`\n" +
        "in the credentials box.\n"
    );
    process.exit(1);
  }

  check(
    "the adapter was built, not just stored",
    paystack.capabilities !== null && paystack.capabilities !== undefined,
    paystack.capabilities
  );

  check("it reports recurring card support", paystack.capabilities?.recurringCard === true);

  check(
    "it reports direct debit as unsupported rather than claiming it",
    paystack.capabilities?.directDebit === false
  );

  // Routing sorts on priority with isDefault worth -100. Print the complete
  // routing calculation so a failure explains exactly why a rail won.
  const scored = configs
    .filter((c) => c.enabled)
    .map((c) => ({
      kind: c.provider,
      score: c.priority - (c.isDefault ? 100 : 0),
      priority: c.priority,
      isDefault: c.isDefault,
    }))
    .sort((a, b) => a.score - b.score);

  for (const rail of scored) {
    note(
      `${String(rail.kind).padEnd(12)} priority ${String(rail.priority).padEnd(4)} ` +
        `default ${String(rail.isDefault).padEnd(5)} → score ${rail.score}`
    );
  }

  check("Paystack ranks first", scored[0]?.kind === "PAYSTACK", scored);

  // A default MOCK rail silently wins every payment and Paystack is never
  // called. Fail before creating a real subscription in that situation.
  const mock = configs.find((c) => c.provider === "MOCK" && c.enabled);
  const paystackWins = paystack.isDefault === true || !mock;

  if (
    !check(
      "Paystack will win the routing",
      paystackWins,
      {
        paystackIsDefault: paystack.isDefault,
        mockStillEnabled: Boolean(mock),
      }
    )
  ) {
    console.error(
      "\nMOCK is still the default rail, so it will take this payment instead.\n" +
        "Re-save Paystack with 'Make this the default rail' ticked, or remove MOCK.\n"
    );
    process.exit(1);
  }

  // -- 3. Credentials ----------------------------------------------------------

  section("3. Credentials");

  const tested = await api("POST", `/v1/payment-providers/${paystack.id}/test`, {});

  if (
    !check(
      "Paystack accepted the secret key",
      tested.data?.ok === true,
      tested.data ?? tested.error
    )
  ) {
    console.error("\nThe key is wrong, or api.paystack.co is unreachable from here.\n");
    process.exit(1);
  }

  // -- 4. A price to charge ----------------------------------------------------

  section("4. Catalogue");

  const plans = await api("GET", "/v1/plans");
  const prices = (plans.data ?? []).flatMap((plan: any) => plan.prices ?? []);
  const wanted = flag("price");

  const price = wanted
    ? prices.find((p: any) => p.code === wanted || p.id === wanted)
    : prices.find(
        (p: any) =>
          p.currency === "NGN" &&
          p.active &&
          p.unitAmount > 0 &&
          p.model !== "USAGE_METERED"
      );

  if (!check("a chargeable NGN price exists", Boolean(price), prices.map((p: any) => p.code))) {
    console.error("\nCreate one in the dashboard under Plans, or pass --price <code>.\n");
    process.exit(1);
  }

  note(`using ${price.code} — ${(price.unitAmount / 100).toLocaleString()} ${price.currency}`);

  // -- 5. Open a checkout ------------------------------------------------------

  section("5. Checkout");

  const created = await api(
    "POST",
    "/v1/subscriptions",
    {
      customer: {
        externalId: EXTERNAL_ID,
        email: EMAIL,
        name: "Paystack Verification",
      },
      priceId: price.id,
      collectPayment: true,
      callbackUrl: `${process.env.APP_URL ?? "http://localhost:8181"}/subscriptions`,
    },
    { "idempotency-key": `paystack-verify-${Date.now()}` }
  );

  if (
    !check(
      "the subscription was created",
      created.status === 201,
      created.error ?? created.data
    )
  ) {
    const message = String(created.error?.message ?? "");

    if (/reference/i.test(message)) {
      console.error(
        "\nPaystack rejected the reference format. The fix for that is commit\n" +
          "'Fix Paystack reference format' — check it is in your history.\n"
      );
    }

    process.exit(1);
  }

  const subscriptionId = created.data.subscription.id;
  const invoiceId = created.data.invoiceId;
  const payment = created.data.payment;
  const firstCheckoutUrl = payment?.checkoutUrl as string | undefined;

  // Every attempt is recorded before the provider is called, so a rail that
  // failed leaves a row explaining why. That row is the diagnosis.
  const attempts =
    ((await api("GET", `/v1/payment-attempts?invoiceId=${invoiceId}&limit=10`)).data?.items ??
      []) as any[];

  const failures = attempts.filter((a) => a.status === "FAILED");

  for (const failure of failures) {
    console.log(`  \x1b[33m!\x1b[0m ${failure.provider} failed: ${failure.failureCode}`);
    console.log(`      ${String(failure.failureReason ?? "").slice(0, 400)}`);
  }

  check("Paystack was the rail used", payment?.provider === "PAYSTACK", payment?.provider);
  check("a checkout was opened", Boolean(payment?.checkoutUrl), payment);

  // Initialization must never report success — no money has moved yet.
  check("nothing is marked paid yet", payment?.status === "PENDING", payment?.status);

  check(
    "the subscription is INCOMPLETE until it settles",
    created.data.subscription.status === "INCOMPLETE"
  );

  if (
    !check(
      "Paystack was tried without falling through to another rail",
      !failures.some((failure) => failure.provider === "PAYSTACK") ||
        payment?.provider === "PAYSTACK",
      failures
    )
  ) {
    console.error(
      "\nPaystack was tried and failed. The failure reason is printed above.\n" +
        "Fix that provider error before relying on this verification.\n"
    );
    process.exit(1);
  }

  if (!payment?.checkoutUrl) {
    console.error("\nNo checkout URL came back, so there is nothing to pay. Stopping.\n");
    process.exit(1);
  }

  // -- 6. Pay it ---------------------------------------------------------------

  section("6. Over to you");

  console.log(`\n  \x1b[1m${payment.checkoutUrl}\x1b[0m\n`);

  console.log("  Paystack test card:");
  console.log("    4084 0840 8408 4081   CVV 408   any future expiry");
  console.log("    PIN 0000   OTP 123456\n");

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  await rl.question("  Press Enter once you have completed (or abandoned) the payment… ");

  rl.close();

  // -- 7. What actually happened ----------------------------------------------

  section("7. Settlement");

  note("polling for up to 90s while the webhook arrives…");

  let invoice: any = null;
  let subscription: any = null;

  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    invoice = (await api("GET", `/v1/invoices/${invoiceId}`)).data;
    subscription = (await api("GET", `/v1/subscriptions/${subscriptionId}`)).data;

    if (invoice?.status === "PAID" || subscription?.status === "ACTIVE") {
      break;
    }

    await sleep(3000);
  }

  const settled = check("the invoice is PAID", invoice?.status === "PAID", {
    status: invoice?.status,
    amountPaid: invoice?.amountPaid,
    amountDue: invoice?.amountDue,
  });

  check("the subscription is ACTIVE", subscription?.status === "ACTIVE", subscription?.status);

  if (settled) {
    check(
      "the amount collected matches the invoice",
      invoice.amountPaid === invoice.total,
      {
        collected: invoice.amountPaid,
        invoiced: invoice.total,
      }
    );
  }

  // -- 8. The webhook ----------------------------------------------------------

  section("8. Webhook");

  const events = (
    await api("GET", "/v1/webhook-events?provider=PAYSTACK&limit=10")
  ).data;

  const items: any[] = events?.items ?? [];
  const charge = items.find((e) => e.eventType === "charge.success");

  if (
    !check(
      "a charge.success webhook arrived",
      Boolean(charge),
      items.map((e) => e.eventType)
    )
  ) {
    console.error(
      "\n  Nothing arrived from Paystack. The usual causes, in order:\n" +
        "    · the Test Webhook URL is missing its path — it must end in /webhooks/paystack\n" +
        "    · the cloudflared tunnel is not running, or its URL changed on restart\n" +
        "    · the tunnel points somewhere other than http://localhost:4000\n"
    );
  } else {
    check("its signature was verified", charge.signatureVerified === true, charge);

    check("it was processed", charge.status === "PROCESSED", {
      status: charge.status,
      error: charge.errorMessage,
    });

    check(
      "it was matched to this organization rather than filed as unmatched",
      charge.eventType !== "unmatched"
    );
  }

  if (!settled) {
    section("8b. Why it is still unpaid");

    const unresolvedAttempts =
      ((await api("GET", `/v1/payment-attempts?invoiceId=${invoiceId}&limit=10`)).data?.items ??
        []) as any[];

    const latest = unresolvedAttempts[0];
    if (latest) {
      note(
        `latest attempt ${latest.id} on ${latest.provider}: ${latest.status}` +
          (latest.providerReference ? ` (provider ref ${latest.providerReference})` : "")
      );
      if (latest.failureCode || latest.failureReason) {
        console.log(
          `  \x1b[33m!\x1b[0m ${latest.failureCode ?? "PROVIDER_ERROR"}: ${String(
            latest.failureReason ?? ""
          ).slice(0, 400)}`
        );
      }
    }

    if (latest?.status === "PENDING" && !charge) {
      console.error(
        "\n  Checkout was opened but no successful settlement reached the API yet.\n" +
          "  This is usually an abandoned/unfinished Paystack flow. Complete it fully\n" +
          "  (PIN + OTP in test mode), then run this script again.\n"
      );

      if (firstCheckoutUrl) {
        console.error(`\n  Re-open checkout: ${firstCheckoutUrl}\n`);
      }
    }
  }

  // -- 9. Tokenization ---------------------------------------------------------

  section("9. The stored card");

  const methods =
    (await api("GET", `/v1/payment-methods?customerId=${EXTERNAL_ID}`)).data ?? [];

  const card = methods.find(
    (m: any) => m.type === "CARD" && m.status === "ACTIVE"
  );

  const tokenized = check("a reusable card was stored", Boolean(card), methods);

  if (tokenized) {
    note(
      `${card.brand ?? "card"} ending ${card.last4 ?? "????"}${
        card.bankName ? ` · ${card.bankName}` : ""
      }`
    );

    check(
      "no card number was stored, only a reference",
      !JSON.stringify(card).includes("408408408408")
    );
  }

  // -- 10. The real prize ------------------------------------------------------

  section("10. Renewal with nobody present");

  if (!RUN_RENEWAL_CHECK) {
    note("skipped — pass --renew to run an immediate stored-card renewal check.");
  } else if (!tokenized || !settled) {
    note("skipped — needs a settled payment with a stored card.");
  } else {
    const renewed = await api(
      "POST",
      `/v1/subscriptions/${subscriptionId}/renew`,
      {}
    );

    const renewalPayment = renewed.data?.payment;

    check(
      "the next period opened",
      renewed.data?.renewed === true,
      renewed.error ?? renewed.data
    );

    check(
      "the stored card was charged without a checkout",
      renewalPayment?.status === "SUCCEEDED" && !renewalPayment?.checkoutUrl,
      renewalPayment
    );

    check(
      "the subscription stayed ACTIVE",
      renewed.data?.subscription?.status === "ACTIVE"
    );
  }

  // -- summary -----------------------------------------------------------------

  console.log(`\n${"─".repeat(64)}`);

  if (failed === 0) {
    console.log(
      `\x1b[32mAll ${passed} checks passed. Paystack is verified end to end.\x1b[0m`
    );
  } else {
    console.log(
      `\x1b[31m${failed} of ${passed + failed} checks failed:\x1b[0m`
    );

    for (const problem of problems) {
      console.log(`  · ${problem}`);
    }
  }

  console.log(`${"─".repeat(64)}\n`);

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n", error);
  process.exit(1);
});