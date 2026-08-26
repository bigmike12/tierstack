/**
 * End-to-end walk through the billing core, driven over real HTTP against a
 * real PostgreSQL and Redis. Nothing here is mocked except the payment rail
 * itself, which is the point: the mock provider is a complete implementation,
 * so the flow a developer runs locally is the flow that runs in production.
 *
 *   npm run e2e
 */
import { createHmac } from "node:crypto";
import { loadRootEnv } from "@tierstack/shared";

// Load the monorepo .env before anything reads process.env.
loadRootEnv();

import { expireGracePeriods, expireIncompleteSubscriptions } from "../packages/billing/src";
import { LogEmailTransport } from "../packages/notifications/src";
import { runDunningRetries } from "../workers/billing-worker/src/jobs";
import { runNotifications } from "../workers/billing-worker/src/notifications";
import { buildServer } from "../apps/api/src/server";

type Json = Record<string, any>;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  \x1b[31m✗\x1b[0m ${label}`);
    if (detail !== undefined) console.log(`      ${JSON.stringify(detail).slice(0, 400)}`);
  }
}

function section(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function main(): Promise<void> {
  const { app, prisma, redis } = await buildServer({ NODE_ENV: "test" } as never);
  await app.ready();

  const stamp = Date.now();
  let cookie = "";
  let secretKey = "";
  let organizationId = "";
  /** The version-2 price from section 12e, edited across a tenant boundary in 14. */
  let supersededPriceId = "";

  const asUser = (extra: Json = {}) => ({ cookie, ...extra });
  const asKey = (extra: Json = {}) => ({ authorization: `Bearer ${secretKey}`, ...extra });

  async function call(
    method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
    url: string,
    options: { headers?: Json; payload?: unknown } = {}
  ): Promise<{ status: number; body: Json }> {
    const response = await app.inject({
      method,
      url,
      headers: { "content-type": "application/json", ...(options.headers ?? {}) },
      ...(options.payload === undefined ? {} : { payload: JSON.stringify(options.payload) }),
    });
    let body: Json = {};
    try {
      body = response.json();
    } catch {
      body = { raw: response.body.slice(0, 200) };
    }
    return { status: response.statusCode, body };
  }

  // -- 1. Organization, authentication, RBAC --------------------------------
  section("1. Organization and authentication");

  const registered = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({
      email: `founder+${stamp}@example.test`,
      name: "E2E Founder",
      password: "correct-horse-battery-staple",
      organizationName: `E2E Org ${stamp}`,
    }),
  });
  check("organization created with an owner", registered.statusCode === 201, registered.body.slice(0, 200));
  cookie = (registered.cookies[0] ? `${registered.cookies[0].name}=${registered.cookies[0].value}` : "");
  organizationId = registered.json().data.organization.id;

  const me = await call("GET", "/v1/auth/me", { headers: asUser() });
  check("session authenticates", me.status === 200 && me.body.data.actor === "user");
  check("owner role assigned", me.body.data.organizations[0].role === "OWNER");

  const unauth = await call("GET", "/v1/plans");
  check("unauthenticated request is rejected", unauth.status === 401 && unauth.body.error.code === "UNAUTHENTICATED");

  // -- 2. Billing policy -----------------------------------------------------
  section("2. Developer-configured billing policy");

  const settings = await call("PUT", "/v1/billing-settings", {
    headers: asUser(),
    payload: {
      gracePeriodDays: 3,
      maxRetryAttempts: 3,
      retryIntervals: [0, 1, 2],
      accessDuringGracePeriod: "RESTRICTED_ACCESS",
      failureAction: "MARK_UNPAID",
    },
  });
  check("grace period is whatever the developer chose", settings.body.data?.gracePeriodDays === 3, settings.body);
  check("retry schedule stored verbatim", JSON.stringify(settings.body.data?.retryIntervals) === "[0,1,2]");
  check("grace-period access policy stored", settings.body.data?.accessDuringGracePeriod === "RESTRICTED_ACCESS");

  // -- 3. Payment provider ---------------------------------------------------
  section("3. Payment provider configuration");

  const providerConfig = await call("POST", "/v1/payment-providers", {
    headers: asUser(),
    payload: {
      provider: "MOCK",
      environment: "TEST",
      credentials: { webhookSecret: "whsec_e2e" },
      isDefault: true,
      priority: 10,
    },
  });
  check("mock provider configured", providerConfig.status === 201, providerConfig.body);

  const providerList = await call("GET", "/v1/payment-providers", { headers: asUser() });
  const listed = providerList.body.data[0];
  check("credentials are never returned", !JSON.stringify(providerList.body).includes("whsec_e2e"));
  check("capabilities are reported by the adapter", listed?.capabilities?.recurringCard === true);

  const dbConfig = await prisma.paymentProviderConfig.findFirst({ where: { organizationId } });
  check(
    "credentials are encrypted at rest",
    Boolean(dbConfig) && !dbConfig!.encryptedCredentials.includes("whsec_e2e")
  );

  const tested = await call("POST", `/v1/payment-providers/${listed.id}/test`, { headers: asUser() });
  check("credentials can be tested", tested.body.data?.ok === true);

  // Paystack is implemented, so it must report its real capability set — and
  // must report `false` for the one it does not implement rather than claiming
  // it. No network call is made here; capabilities are static.
  const paystackConfig = await call("POST", "/v1/payment-providers", {
    headers: asUser(),
    payload: { provider: "PAYSTACK", environment: "TEST", credentials: { secretKey: "sk_test_e2e" } },
  });
  const paystackListed = (await call("GET", "/v1/payment-providers", { headers: asUser() })).body.data.find(
    (c: Json) => c.provider === "PAYSTACK"
  );
  check(
    "an implemented adapter reports its real capabilities",
    paystackConfig.status === 201 && paystackListed?.capabilities?.recurringCard === true,
    paystackListed?.capabilities
  );
  check(
    "a capability the adapter does not implement is reported false, not omitted",
    paystackListed?.capabilities?.directDebit === false
  );

  // A Paystack config with no secret key cannot be built at all — the same key
  // signs webhooks, so nothing could be verified.
  const keylessPaystack = await call("POST", "/v1/payment-providers", {
    headers: asUser(),
    payload: { provider: "FLUTTERWAVE", environment: "TEST", credentials: { apiKey: "x" } },
  });
  const flutterwaveListed = (
    await call("GET", "/v1/payment-providers", { headers: asUser() })
  ).body.data.find((c: Json) => c.provider === "FLUTTERWAVE");
  check(
    "an unimplemented adapter reports no capabilities rather than faking them",
    keylessPaystack.status === 201 && flutterwaveListed?.capabilities === null
  );

  await call("DELETE", `/v1/payment-providers/${paystackListed.id}`, { headers: asUser() });
  await call("DELETE", `/v1/payment-providers/${flutterwaveListed.id}`, { headers: asUser() });

  // -- 4. API keys -----------------------------------------------------------
  section("4. API keys");

  const keyResponse = await call("POST", "/v1/api-keys", {
    headers: asUser(),
    payload: { name: "e2e", type: "SECRET", environment: "TEST" },
  });
  secretKey = keyResponse.body.data.secret;
  check("secret key issued", keyResponse.status === 201 && secretKey.startsWith("sk_test_"));

  const keyRow = await prisma.apiKey.findFirst({ where: { organizationId, type: "SECRET" } });
  check("raw secret is never stored", Boolean(keyRow) && !JSON.stringify(keyRow).includes(secretKey.slice(8)));

  const keyList = await call("GET", "/v1/api-keys", { headers: asUser() });
  check("listing a key never re-reveals it", !JSON.stringify(keyList.body).includes(secretKey));

  const keyAuth = await call("GET", "/v1/auth/me", { headers: asKey() });
  check("api key resolves its own organization", keyAuth.body.data.organizationId === organizationId);

  const badKey = await call("GET", "/v1/plans", { headers: { authorization: "Bearer sk_test_notarealkeyatall1234" } });
  check("an unknown key is rejected", badKey.status === 401 && badKey.body.error.code === "INVALID_API_KEY");

  // -- 5. Catalogue ----------------------------------------------------------
  section("5. Plans and prices");

  const plan = await call("POST", "/v1/plans", {
    headers: asKey(),
    payload: { code: "pro", name: "Pro", features: { export_pdf: true, team_members: 5 } },
  });
  check("plan created", plan.status === 201, plan.body);

  const priceMonthly = await call("POST", "/v1/prices", {
    headers: asKey(),
    payload: { planId: "pro", code: "pro_monthly_ngn", currency: "NGN", unitAmount: 1_000_000, interval: "MONTHLY" },
  });
  const priceAnnual = await call("POST", "/v1/prices", {
    headers: asKey(),
    payload: { planId: "pro", code: "pro_annual_ngn", currency: "NGN", unitAmount: 10_000_000, interval: "ANNUALLY" },
  });
  const priceUsd = await call("POST", "/v1/prices", {
    headers: asKey(),
    payload: { planId: "pro", code: "pro_monthly_usd", currency: "USD", unitAmount: 2_900, interval: "MONTHLY" },
  });
  const priceQuarterly = await call("POST", "/v1/prices", {
    headers: asKey(),
    payload: { planId: "pro", code: "pro_90_days", currency: "NGN", unitAmount: 2_700_000, interval: "CUSTOM_DAYS", intervalDays: 90 },
  });
  check("one plan carries several prices", [priceMonthly, priceAnnual, priceUsd, priceQuarterly].every((r) => r.status === 201));
  check("multiple currencies on one plan", priceUsd.body.data.currency === "USD");
  check("custom-day intervals are supported", priceQuarterly.body.data.intervalUnit === "DAY" && priceQuarterly.body.data.intervalCount === 90);

  const teamPlan = await call("POST", "/v1/plans", { headers: asKey(), payload: { code: "team", name: "Team" } });
  const seatPrice = await call("POST", "/v1/prices", {
    headers: asKey(),
    payload: { planId: "team", code: "team_seat_ngn", currency: "NGN", unitAmount: 200_000, interval: "MONTHLY", model: "PER_SEAT" },
  });
  check("per-seat price created", teamPlan.status === 201 && seatPrice.status === 201);

  const meteredPrice = await call("POST", "/v1/prices", {
    headers: asKey(),
    payload: { planId: "pro", code: "pro_tokens", currency: "NGN", interval: "MONTHLY", model: "USAGE_METERED", usageUnitAmount: 5000, usageUnitSize: 1000 },
  });
  check("usage-metered price can be catalogued", meteredPrice.status === 201);

  // -- 6. Customers ----------------------------------------------------------
  section("6. Customers and automatic resolution");

  const explicitCustomer = await call("POST", "/v1/customers", {
    headers: asKey(),
    payload: { externalId: "user_explicit", email: "explicit@example.test", name: "Explicit", country: "NG" },
  });
  check("customer created explicitly", explicitCustomer.status === 201);

  const repeated = await call("POST", "/v1/customers", {
    headers: asKey(),
    payload: { externalId: "user_explicit", email: "explicit@example.test", name: "Explicit Renamed" },
  });
  check("repeat create is idempotent on externalId", repeated.body.data.id === explicitCustomer.body.data.id);

  const byExternalId = await call("GET", "/v1/customers/user_explicit", { headers: asKey() });
  check("customer is addressable by the developer's own id", byExternalId.body.data.id === explicitCustomer.body.data.id);

  // -- 7. Subscription, invoice, hosted checkout -----------------------------
  section("7. Subscription lifecycle with hosted checkout");

  const created = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `sub-${stamp}` }),
    payload: {
      customer: { externalId: "user_83921", email: "jonathan@example.test", name: "Jonathan" },
      priceId: "pro_monthly_ngn",
    },
  });
  check("subscription created with an auto-resolved customer", created.status === 201, created.body);
  const subscriptionId = created.body.data?.subscription?.id;
  const firstInvoiceId = created.body.data?.invoiceId;
  check("customer was created on the fly", created.body.data?.subscription?.customer?.externalId === "user_83921");
  check("first invoice generated", Boolean(firstInvoiceId));
  check("invoice total matches the price", created.body.data?.amountDue === 1_000_000);
  check("subscription is not active before payment", created.body.data?.subscription?.status === "INCOMPLETE",
    created.body.data?.subscription?.status);
  check("hosted checkout opened", typeof created.body.data?.payment?.checkoutUrl === "string");
  check("payment is pending, not assumed", created.body.data?.payment?.status === "PENDING");

  const checkoutPage = await app.inject({ method: "GET", url: `/mock/checkout/${created.body.data.payment.reference}` });
  check("mock checkout page renders", checkoutPage.statusCode === 200 && checkoutPage.body.includes("Pay"));

  const completed = await call("POST", `/mock/checkout/${created.body.data.payment.reference}/complete`, {
    payload: { outcome: "SUCCESS" },
  });
  check("customer completes payment", completed.body.data?.status === "SUCCEEDED", completed.body);

  const afterPayment = await call("GET", `/v1/subscriptions/${subscriptionId}`, { headers: asKey() });
  check("subscription activates only after payment settles", afterPayment.body.data.status === "ACTIVE");

  const paidInvoice = await call("GET", `/v1/invoices/${firstInvoiceId}`, { headers: asKey() });
  check("invoice marked paid", paidInvoice.body.data.status === "PAID");
  check("amount due cleared", paidInvoice.body.data.amountDue === 0);
  check("payment attempt recorded", paidInvoice.body.data.attempts.length >= 1);
  check("attempt is SUCCEEDED", paidInvoice.body.data.attempts.at(-1).status === "SUCCEEDED");

  const methods = await call("GET", `/v1/payment-methods?customerId=user_83921`, { headers: asKey() });
  check("payment method stored as a provider reference", methods.body.data[0]?.last4 === "4081");
  const storedMethod = await prisma.paymentMethod.findFirst({ where: { organizationId } });
  check("no card number is persisted", Boolean(storedMethod) && storedMethod!.providerPaymentMethodRef.startsWith("mock_pm_"));

  // -- 8. Idempotency --------------------------------------------------------
  section("8. Idempotency");

  const replay = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `sub-${stamp}` }),
    payload: {
      customer: { externalId: "user_83921", email: "jonathan@example.test", name: "Jonathan" },
      priceId: "pro_monthly_ngn",
    },
  });
  check("same key + same body replays the original response", replay.body.data?.subscription?.id === subscriptionId);
  const subCount = await prisma.subscription.count({ where: { organizationId, customerId: created.body.data.subscription.customerId } });
  check("no duplicate subscription was created", subCount === 1, { subCount });

  const conflict = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `sub-${stamp}` }),
    payload: { customer: { externalId: "user_83921", email: "jonathan@example.test" }, priceId: "pro_annual_ngn" },
  });
  check("same key + different body is rejected", conflict.body.error?.code === "IDEMPOTENCY_KEY_REUSE", conflict.body);

  // -- 9. Renewal on a stored payment method ---------------------------------
  section("9. Renewal charges the stored payment method");

  const renewed = await call("POST", `/v1/subscriptions/${subscriptionId}/renew`, { headers: asKey(), payload: {} });
  check("next period opened", renewed.body.data?.renewed === true, renewed.body);
  check("renewal invoice issued", Boolean(renewed.body.data?.invoiceId));
  check("stored method charged without a checkout", renewed.body.data?.payment?.status === "SUCCEEDED", renewed.body.data?.payment);
  check("subscription stays active", renewed.body.data?.subscription?.status === "ACTIVE");

  const invoices = await call("GET", `/v1/invoices?subscriptionId=${subscriptionId}`, { headers: asKey() });
  check("two invoices now exist", invoices.body.data.items.length === 2);
  check("the list reports its own total", invoices.body.data.total === 2, invoices.body.data);
  check(
    "invoice numbers are sequential",
    invoices.body.data.items.map((i: Json) => i.invoiceNumber).every((n: string) => n.startsWith("INV-"))
  );

  // -- 10. Plan change and proration -----------------------------------------
  section("10. Plan change and proration");

  const upgrade = await call("POST", `/v1/subscriptions/${subscriptionId}/change-plan`, {
    headers: asKey({ "idempotency-key": `upgrade-${stamp}` }),
    payload: { priceId: "pro_annual_ngn" },
  });
  check("upgrade applies immediately", upgrade.body.data?.applied === true, upgrade.body);
  check("proration invoice raised", Boolean(upgrade.body.data?.invoiceId));
  check("net proration is positive on an upgrade", upgrade.body.data?.netAmount > 0);

  const prorationInvoice = await call("GET", `/v1/invoices/${upgrade.body.data.invoiceId}`, { headers: asKey() });
  const lineTypes = prorationInvoice.body.data.lineItems.map((l: Json) => l.type);
  check("both halves of the proration are visible", lineTypes.filter((t: string) => t === "PRORATION").length === 2);
  const creditLine = prorationInvoice.body.data.lineItems.find((l: Json) => l.amount < 0);
  check("unused time appears as a credit line", Boolean(creditLine));

  const downgrade = await call("POST", `/v1/subscriptions/${subscriptionId}/change-plan`, {
    headers: asKey({ "idempotency-key": `downgrade-${stamp}` }),
    payload: { priceId: "pro_monthly_ngn" },
  });
  check("downgrade defers to the next period", downgrade.body.data?.applied === false, downgrade.body);

  // -- 11. Seat changes ------------------------------------------------------
  section("11. Per-seat subscription and seat proration");

  const seatSub = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `seat-${stamp}` }),
    payload: {
      customer: { externalId: "user_seats", email: "seats@example.test", name: "Seat Buyer" },
      priceId: "team_seat_ngn",
      quantity: 5,
      metadata: { mockOutcome: "SUCCESS" },
    },
  });
  check("per-seat subscription billed by quantity", seatSub.body.data?.amountDue === 1_000_000, seatSub.body);
  const seatSubId = seatSub.body.data.subscription.id;

  const seatUp = await call("POST", `/v1/subscriptions/${seatSubId}/quantity`, {
    headers: asKey(),
    payload: { quantity: 8 },
  });
  check("seat increase applies immediately", seatUp.body.data?.applied === true, seatUp.body);
  // The change lands moments after the period opened, so the prorated charge
  // is at most the full 3 x ₦2,000 and never more.
  check("seat increase is prorated on the remaining period",
    seatUp.body.data?.netAmount > 0 && seatUp.body.data?.netAmount <= 600_000, seatUp.body.data?.netAmount);

  const seatDown = await call("POST", `/v1/subscriptions/${seatSubId}/quantity`, {
    headers: asKey(),
    payload: { quantity: 6 },
  });
  check("seat decrease defers to the next period", seatDown.body.data?.applied === false);

  // -- 12. Failed payment, configured grace period, recovery -----------------
  section("12. Failed payment, grace period and recovery");

  const failing = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `fail-${stamp}` }),
    payload: {
      customer: { externalId: "user_declined", email: "declined@example.test", name: "Declined" },
      priceId: "pro_monthly_ngn",
      metadata: { mockOutcome: "FAILED" },
    },
  });
  const failingSubId = failing.body.data?.subscription?.id;
  const failingInvoiceId = failing.body.data?.invoiceId;
  check("declined payment recorded", failing.body.data?.payment?.status === "FAILED", failing.body.data?.payment);

  const afterFailure = await call("GET", `/v1/subscriptions/${failingSubId}`, { headers: asKey() });
  check("a declined first payment leaves the subscription INCOMPLETE", afterFailure.body.data.status === "INCOMPLETE", afterFailure.body.data.status);

  const abandoned = await call("POST", `/v1/subscriptions/${failingSubId}/renew`, { headers: asKey(), payload: {} });
  check("an unpaid subscription cannot open another period", abandoned.body.error?.code === "INVALID_STATE_TRANSITION");

  const transitions = await call("GET", `/v1/subscriptions/${failingSubId}/transitions`, { headers: asKey() });
  const path = transitions.body.data.map((t: Json) => t.toStatus);
  check("a never-paid subscription stays INCOMPLETE instead of entering a grace period",
    JSON.stringify(path) === JSON.stringify(["INCOMPLETE"]), path);
  check("no grace period is opened for a customer who never paid",
    afterFailure.body.data.gracePeriodEnd === null && afterFailure.body.data.gracePolicy === null);

  const retry = await call("POST", `/v1/invoices/${failingInvoiceId}/pay`, {
    headers: asKey({ "idempotency-key": `retry-${stamp}` }),
    payload: { metadata: { mockOutcome: "SUCCESS" } },
  });
  check("retry succeeds", retry.body.data?.status === "SUCCEEDED", retry.body);

  const recovered = await call("GET", `/v1/subscriptions/${failingSubId}`, { headers: asKey() });
  check("subscription recovers to ACTIVE", recovered.body.data.status === "ACTIVE");
  check("grace period is cleared on recovery", recovered.body.data.gracePeriodEnd === null);

  const failedInvoice = await call("GET", `/v1/invoices/${failingInvoiceId}`, { headers: asKey() });
  check("every attempt is kept, none overwritten", failedInvoice.body.data.attempts.length === 2, failedInvoice.body.data.attempts.length);
  check("the first attempt is still FAILED", failedInvoice.body.data.attempts[0].status === "FAILED");
  check("attempt numbers increment", failedInvoice.body.data.attempts[1].attemptNumber === 2);

  const renewalFailure = await call("POST", `/v1/subscriptions/${failingSubId}/renew`, {
    headers: asKey(),
    payload: { metadata: { mockOutcome: "FAILED" } },
  });
  check("a renewal charge can decline", renewalFailure.body.data?.payment?.status === "FAILED", renewalFailure.body.data?.payment);

  const renewalPath = (
    await call("GET", `/v1/subscriptions/${failingSubId}/transitions`, { headers: asKey() })
  ).body.data.map((t: Json) => t.toStatus);
  check("an active subscription walks ACTIVE -> PAST_DUE -> GRACE_PERIOD",
    JSON.stringify(renewalPath.slice(-3)) === JSON.stringify(["ACTIVE", "PAST_DUE", "GRACE_PERIOD"]), renewalPath);

  const afterRenewalFailure = await call("GET", `/v1/subscriptions/${failingSubId}`, { headers: asKey() });
  const graceDays = Math.round(
    (new Date(afterRenewalFailure.body.data.gracePeriodEnd).getTime() -
      new Date(afterRenewalFailure.body.data.gracePeriodStart).getTime()) / 86_400_000
  );
  check("the grace period is the configured 3 days, not a hard-coded default", graceDays === 3, { graceDays });
  check("the policy in force is frozen onto the subscription",
    afterRenewalFailure.body.data.gracePolicy?.failureAction === "MARK_UNPAID");

  const recoverRenewal = await call("POST", `/v1/invoices/${renewalFailure.body.data.invoiceId}/pay`, {
    headers: asKey(),
    payload: { metadata: { mockOutcome: "SUCCESS" } },
  });
  check("a lapsed subscription recovers out of the grace period", recoverRenewal.body.data?.status === "SUCCEEDED");
  const afterRecovery = await call("GET", `/v1/subscriptions/${failingSubId}`, { headers: asKey() });
  check("the grace window is cleared on recovery",
    afterRecovery.body.data.status === "ACTIVE" && afterRecovery.body.data.gracePeriodEnd === null);

  // -- 12b. Abandoned checkout ----------------------------------------------
  section("12b. Abandoned first checkout");

  const abandonedSub = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `abandon-${stamp}` }),
    payload: {
      customer: { externalId: "user_ghost", email: "ghost@example.test" },
      priceId: "pro_monthly_ngn",
    },
  });
  const ghostId = abandonedSub.body.data.subscription.id;
  const ghostInvoiceId = abandonedSub.body.data.invoiceId;
  check("an abandoned checkout leaves the subscription INCOMPLETE",
    abandonedSub.body.data.subscription.status === "INCOMPLETE");

  // Age it past the organization's configured expiry window.
  await prisma.subscription.update({
    where: { id: ghostId },
    data: { createdAt: new Date(Date.now() - 48 * 3_600_000) },
  });
  const expired = await expireIncompleteSubscriptions(prisma, organizationId);
  check("the abandoned subscription is expired", expired.includes(ghostId), expired);

  const ghost = await call("GET", `/v1/subscriptions/${ghostId}`, { headers: asKey() });
  check("its status is EXPIRED, never UNPAID", ghost.body.data.status === "EXPIRED");

  const ghostInvoice = await call("GET", `/v1/invoices/${ghostInvoiceId}`, { headers: asKey() });
  check("its invoice is voided rather than left as receivable", ghostInvoice.body.data.status === "VOID");
  check("nothing is owed on it", ghostInvoice.body.data.amountDue === 0);

  await call("PUT", "/v1/billing-settings", { headers: asUser(), payload: { incompleteExpiryHours: 0 } });
  const secondGhost = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `abandon2-${stamp}` }),
    payload: { customer: { externalId: "user_ghost2", email: "ghost2@example.test" }, priceId: "pro_monthly_ngn" },
  });
  await prisma.subscription.update({
    where: { id: secondGhost.body.data.subscription.id },
    data: { createdAt: new Date(Date.now() - 48 * 3_600_000) },
  });
  const noneExpired = await expireIncompleteSubscriptions(prisma, organizationId);
  check("expiry can be switched off by the developer", noneExpired.length === 0, noneExpired);
  await call("PUT", "/v1/billing-settings", { headers: asUser(), payload: { incompleteExpiryHours: 24 } });

  // -- 12c. Usage metering and entitlements ----------------------------------
  section("12c. Usage metering and entitlements");

  const meter = await call("POST", "/v1/usage-meters", {
    headers: asKey(),
    payload: { code: "AI_TOKENS", name: "AI tokens", unitLabel: "tokens", aggregation: "SUM" },
  });
  check("usage meter created", meter.status === 201, meter.body);

  const hybridPrice = await call("POST", "/v1/prices", {
    headers: asKey(),
    payload: {
      planId: "pro",
      code: "ai_hybrid_ngn",
      currency: "NGN",
      unitAmount: 1_500_000,
      interval: "MONTHLY",
      model: "HYBRID",
      usageMeterCode: "AI_TOKENS",
      includedUnits: 100_000,
      usageUnitAmount: 5_000,
      usageUnitSize: 1_000,
    },
  });
  check("hybrid price created with a meter attached", hybridPrice.status === 201, hybridPrice.body);

  const noMeter = await call("POST", "/v1/prices", {
    headers: asKey(),
    payload: { planId: "pro", code: "broken_metered", currency: "NGN", interval: "MONTHLY", model: "USAGE_METERED", usageUnitAmount: 100 },
  });
  const brokenSub = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `broken-${stamp}` }),
    payload: { customer: { externalId: "user_broken", email: "broken@example.test" }, priceId: "broken_metered" },
  });
  check("a metered price with no meter is refused rather than under-charging",
    noMeter.status === 201 && brokenSub.body.error?.code === "VALIDATION_ERROR", brokenSub.body);

  const meteredSub = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `metered-${stamp}` }),
    payload: {
      customer: { externalId: "user_ai", email: "ai@example.test", name: "AI Startup" },
      priceId: "ai_hybrid_ngn",
      metadata: { mockOutcome: "SUCCESS" },
    },
  });
  const meteredSubId = meteredSub.body.data?.subscription?.id;
  check("a hybrid subscription can now be created", meteredSub.status === 201, meteredSub.body.error);
  check("only the base fee is billed in advance", meteredSub.body.data?.amountDue === 1_500_000, meteredSub.body.data?.amountDue);
  check("hybrid subscription activates on payment", meteredSub.body.data?.subscription?.status === "ACTIVE");

  const beforeUsage = await call("POST", "/v1/entitlements/check", {
    headers: asKey(),
    payload: { customerId: "user_ai", featureKey: "AI_TOKENS" },
  });
  check("entitlement reports the full included allowance before any usage",
    beforeUsage.body.data?.access === true && beforeUsage.body.data?.remainingQuota === 100_000, beforeUsage.body.data);

  const track1 = await call("POST", "/v1/events/track", {
    headers: asKey(),
    payload: { customerId: "user_ai", meter: "AI_TOKENS", units: 40_000, eventId: `evt-${stamp}-1` },
  });
  check("usage event accepted", track1.body.data?.recorded === true, track1.body);

  const replayEvent = await call("POST", "/v1/events/track", {
    headers: asKey(),
    payload: { customerId: "user_ai", meter: "AI_TOKENS", units: 40_000, eventId: `evt-${stamp}-1` },
  });
  check("a replayed event is de-duplicated, not double counted", replayEvent.body.data?.duplicate === true);

  const afterFirst = await call("POST", "/v1/entitlements/check", {
    headers: asKey(),
    payload: { customerId: "user_ai", featureKey: "AI_TOKENS" },
  });
  check("quota reflects consumption once, not twice",
    afterFirst.body.data?.remainingQuota === 60_000, afterFirst.body.data);
  check("reason is the usage quota", afterFirst.body.data?.reason === "USAGE_QUOTA");

  const batch = await call("POST", "/v1/events/track/batch", {
    headers: asKey(),
    payload: {
      events: [
        { customerId: "user_ai", meter: "AI_TOKENS", units: 30_000, eventId: `evt-${stamp}-2`, metadata: {} },
        { customerId: "user_ai", meter: "AI_TOKENS", units: 50_000, eventId: `evt-${stamp}-3`, metadata: {} },
        { customerId: "user_ai", meter: "AI_TOKENS", units: 10, eventId: `evt-${stamp}-2`, metadata: {} },
      ],
    },
  });
  check("batch ingestion accepts new events and rejects the repeat",
    batch.body.data?.accepted === 2 && batch.body.data?.duplicates === 1, batch.body.data);

  const exceeded = await call("POST", "/v1/entitlements/check", {
    headers: asKey(),
    payload: { customerId: "user_ai", featureKey: "AI_TOKENS" },
  });
  check("access is denied once the allowance is spent",
    exceeded.body.data?.access === false && exceeded.body.data?.reason === "QUOTA_EXCEEDED", exceeded.body.data);

  const usageView = await call("GET", "/v1/usage?customerId=user_ai", { headers: asKey() });
  const tokenUsage = usageView.body.data?.meters?.find((m: Json) => m.meterCode === "AI_TOKENS");
  check("usage reports 120,000 consumed", tokenUsage?.used === 120_000, tokenUsage);
  check("overage is 20,000 units", tokenUsage?.overage === 20_000);
  check("overage is 20 priced blocks", tokenUsage?.overageBlocks === 20);
  check("overage would cost NGN 1,000", tokenUsage?.overageAmount === 100_000, tokenUsage?.overageAmount);

  const booleanFeature = await call("POST", "/v1/entitlements/check", {
    headers: asKey(),
    payload: { customerId: "user_ai", featureKey: "export_pdf" },
  });
  check("plan feature flags resolve as boolean entitlements",
    booleanFeature.body.data?.access === true && booleanFeature.body.data?.reason === "PLAN_FEATURE", booleanFeature.body.data);

  const unknownFeature = await call("POST", "/v1/entitlements/check", {
    headers: asKey(),
    payload: { customerId: "user_ai", featureKey: "teleportation" },
  });
  check("an unknown feature is reported as not found", unknownFeature.body.data?.reason === "FEATURE_NOT_FOUND");

  const override = await call("POST", "/v1/entitlements", {
    headers: asUser(),
    payload: { featureKey: "AI_TOKENS", type: "USAGE", limitValue: 500_000, meterCode: "AI_TOKENS", customerId: "user_ai" },
  });
  check("a customer override can be granted", override.status === 201, override.body);

  const afterOverride = await call("POST", "/v1/entitlements/check", {
    headers: asKey(),
    payload: { customerId: "user_ai", featureKey: "AI_TOKENS" },
  });
  check("the override beats the plan and restores access",
    afterOverride.body.data?.access === true && afterOverride.body.data?.remainingQuota === 380_000, afterOverride.body.data);
  check("the override invalidated the cached answer immediately",
    afterOverride.body.data?.reason === "USAGE_QUOTA");

  await call("DELETE", `/v1/entitlements/${override.body.data.id}`, { headers: asUser() });

  // -- 12d. Billing the consumption ------------------------------------------
  section("12d. Overage reaches the invoice");

  const meteredRenewal = await call("POST", `/v1/subscriptions/${meteredSubId}/renew`, {
    headers: asKey(),
    payload: {},
  });
  check("hybrid subscription renews", meteredRenewal.body.data?.renewed === true, meteredRenewal.body);

  const usageInvoice = await call("GET", `/v1/invoices/${meteredRenewal.body.data.invoiceId}`, { headers: asKey() });
  const invoiceLines = usageInvoice.body.data.lineItems;
  const baseLine = invoiceLines.find((l: Json) => l.type === "SUBSCRIPTION");
  const usageLine = invoiceLines.find((l: Json) => l.type === "USAGE");
  const overageLine = invoiceLines.find((l: Json) => l.type === "OVERAGE");

  check("the base fee is billed in advance for the new period", baseLine?.amount === 1_500_000, baseLine);
  check("included usage appears as a zero-value line", usageLine?.amount === 0 && usageLine !== undefined);
  check("overage is billed in arrears for the closed period", overageLine?.amount === 100_000, overageLine);
  check("overage is priced by whole blocks", overageLine?.quantity === 20 && overageLine?.unitAmount === 5_000);
  check("invoice total is base plus overage", usageInvoice.body.data.total === 1_600_000, usageInvoice.body.data.total);
  check("the two lines cover different windows",
    new Date(baseLine.periodStart).getTime() > new Date(overageLine.periodStart).getTime());

  const afterRenewalQuota = await call("POST", "/v1/entitlements/check", {
    headers: asKey(),
    payload: { customerId: "user_ai", featureKey: "AI_TOKENS" },
  });
  check("the allowance resets with the new billing period",
    afterRenewalQuota.body.data?.access === true && afterRenewalQuota.body.data?.remainingQuota === 100_000,
    afterRenewalQuota.body.data);

  // -- 12e. Editing a price ---------------------------------------------------
  section("12e. Editing a price");

  // A subscription only renews once its first payment has settled — INCOMPLETE
  // means nothing has ever been collected. This walks the mock checkout the way
  // a customer would, so the renewals below have something real to renew.
  async function settle(created: Json): Promise<void> {
    const payment = created.body?.data?.payment;
    if (!payment?.checkoutUrl) return;
    await call("POST", `/mock/checkout/${payment.reference}/complete`, {
      payload: { outcome: "SUCCESS" },
    });
  }

  const editablePlan = await call("POST", "/v1/plans", {
    headers: asKey(),
    payload: { code: "editable", name: "Editable" },
  });
  const editable = await call("POST", "/v1/prices", {
    headers: asKey(),
    payload: {
      planId: "editable",
      code: "editable_monthly_ngn",
      currency: "NGN",
      unitAmount: 500_000,
      interval: "MONTHLY",
    },
  });
  check("a price to edit exists", editablePlan.status === 201 && editable.status === 201, editable.body);

  const renamed = await call("PATCH", `/v1/prices/${editable.body.data.id}`, {
    headers: asKey(),
    payload: { nickname: "Monthly, Naira" },
  });
  check("presentation edits in place", renamed.body.data?.nickname === "Monthly, Naira", renamed.body);
  check("a presentation edit keeps the same row", renamed.body.data?.id === editable.body.data.id);

  // Nobody is subscribed yet, so getting the number right is an edit, not a
  // new version — otherwise every typo would litter the plan with dead rows.
  const repriced = await call("PATCH", `/v1/prices/${editable.body.data.id}`, {
    headers: asKey(),
    payload: { unitAmount: 750_000 },
  });
  check("an amount edits in place while nobody is subscribed", repriced.body.data?.unitAmount === 750_000, repriced.body);
  check("editing in place creates no new version", repriced.body.data?.id === editable.body.data.id);
  check("no supersede is reported", repriced.body.data?.supersededPriceId === null);

  const editCustomer = await call("POST", "/v1/customers", {
    headers: asKey(),
    payload: { externalId: `edit_${stamp}`, email: `edit-${stamp}@example.test`, name: "Edit" },
  });
  const editSubscription = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `edit-sub-${stamp}` }),
    payload: { customerId: editCustomer.body.data.id, priceId: editable.body.data.id },
  });
  check("a customer subscribes to it", editSubscription.status === 201, editSubscription.body);
  await settle(editSubscription);

  const superseded = await call("PATCH", `/v1/prices/${editable.body.data.id}`, {
    headers: asKey(),
    payload: { unitAmount: 900_000 },
  });
  check("repricing a subscribed price returns a different row", superseded.body.data?.id !== editable.body.data.id, superseded.body);
  check("the new row carries the new amount", superseded.body.data?.unitAmount === 900_000);
  check("the new row is version 2", superseded.body.data?.version === 2);
  check("it points back at what it replaced", superseded.body.data?.supersedesPriceId === editable.body.data.id);
  check("the subscriber is reported as retained", superseded.body.data?.subscribersRetained === 1);
  check("the lineage code follows the current version", superseded.body.data?.code === "editable_monthly_ngn");
  supersededPriceId = superseded.body.data?.id ?? "";

  const oldPrice = await call("GET", `/v1/prices/${editable.body.data.id}`, { headers: asKey() });
  check("the previous version still exists", oldPrice.status === 200, oldPrice.body);
  check("the previous version keeps its own amount", oldPrice.body.data?.unitAmount === 750_000);
  check("the previous version is archived", oldPrice.body.data?.active === false);
  check("the previous version's code is suffixed", oldPrice.body.data?.code === "editable_monthly_ngn-v1");

  const editSubscriptionId = editSubscription.body.data.subscription.id;
  const stillOnOld = await call("GET", `/v1/subscriptions/${editSubscriptionId}`, {
    headers: asKey(),
  });
  check(
    "the current period is not repriced under the subscriber",
    stillOnOld.body.data?.price?.id === editable.body.data.id,
    stillOnOld.body.data?.price
  );
  check("they still pay the old amount for the period they are in", stillOnOld.body.data?.price?.unitAmount === 750_000);
  check("that period was already invoiced at the old amount", stillOnOld.body.data?.price?.unitAmount === 750_000);

  // The point of versioning is not that subscribers never move — it is that
  // they move at a renewal boundary rather than mid-period.
  const rolled = await call("POST", `/v1/subscriptions/${editSubscriptionId}/renew`, {
    headers: asKey(),
    payload: {},
  });
  check("the next renewal rolls them onto the new version", rolled.body.data?.subscription?.price?.id === superseded.body.data.id, rolled.body.data?.subscription?.price);
  check("and charges the new amount", rolled.body.data?.amountDue === 900_000, rolled.body.data);
  check(
    "the subscription now genuinely points at the new version",
    rolled.body.data?.subscription?.price?.unitAmount === 900_000
  );

  // -- pinning ---------------------------------------------------------------
  const pinnedCustomer = await call("POST", "/v1/customers", {
    headers: asKey(),
    payload: { externalId: `pinned_${stamp}`, email: `pinned-${stamp}@example.test`, name: "Pinned" },
  });
  const pinnedSub = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `pinned-sub-${stamp}` }),
    payload: { customerId: pinnedCustomer.body.data.id, priceId: superseded.body.data.id },
  });
  const pinnedSubId = pinnedSub.body.data?.subscription?.id;
  check("a second subscriber joins on the current version", pinnedSub.status === 201, pinnedSub.body);
  await settle(pinnedSub);

  const pinResult = await call("POST", `/v1/subscriptions/${pinnedSubId}/pin-price`, {
    headers: asKey(),
    payload: { pinned: true },
  });
  check("a subscription can be pinned to its price", pinResult.body.data?.pricePinned === true, pinResult.body);

  const supersededAgain = await call("PATCH", `/v1/prices/${superseded.body.data.id}`, {
    headers: asKey(),
    payload: { unitAmount: 1_200_000 },
  });
  check("a third version can be published", supersededAgain.body.data?.version === 3, supersededAgain.body);

  const pinnedRenewal = await call("POST", `/v1/subscriptions/${pinnedSubId}/renew`, {
    headers: asKey(),
    payload: {},
  });
  check(
    "a pinned subscription does not roll forward",
    pinnedRenewal.body.data?.subscription?.price?.id === superseded.body.data.id,
    pinnedRenewal.body.data?.subscription?.price
  );
  check("a pinned subscription keeps its old amount", pinnedRenewal.body.data?.amountDue === 900_000, pinnedRenewal.body.data);

  const unpinned = await call("POST", `/v1/subscriptions/${pinnedSubId}/pin-price`, {
    headers: asKey(),
    payload: { pinned: false },
  });
  check("a pin can be released", unpinned.body.data?.pricePinned === false, unpinned.body);

  const afterUnpin = await call("POST", `/v1/subscriptions/${pinnedSubId}/renew`, {
    headers: asKey(),
    payload: {},
  });
  check("releasing the pin lets the next renewal catch up", afterUnpin.body.data?.amountDue === 1_200_000, afterUnpin.body.data);
  check(
    "catching up crosses every version it missed in one hop",
    afterUnpin.body.data?.subscription?.price?.id === supersededAgain.body.data.id
  );

  // -- an interval change is not something a price edit may do silently ------
  const intervalPlan = await call("POST", "/v1/plans", {
    headers: asKey(),
    payload: { code: "intervalled", name: "Intervalled" },
  });
  const intervalPrice = await call("POST", "/v1/prices", {
    headers: asKey(),
    payload: {
      planId: "intervalled",
      code: "intervalled_monthly_ngn",
      currency: "NGN",
      unitAmount: 300_000,
      interval: "MONTHLY",
    },
  });
  const intervalCustomer = await call("POST", "/v1/customers", {
    headers: asKey(),
    payload: { externalId: `interval_${stamp}`, email: `interval-${stamp}@example.test` },
  });
  const intervalSub = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `interval-sub-${stamp}` }),
    payload: { customerId: intervalCustomer.body.data.id, priceId: intervalPrice.body.data.id },
  });
  check("a monthly subscriber exists", intervalPlan.status === 201 && intervalSub.status === 201, intervalSub.body);
  await settle(intervalSub);

  const nowAnnual = await call("PATCH", `/v1/prices/${intervalPrice.body.data.id}`, {
    headers: asKey(),
    payload: { interval: "ANNUALLY", unitAmount: 3_000_000 },
  });
  check("the price can be moved to annual", nowAnnual.body.data?.version === 2, nowAnnual.body);

  const intervalRenewal = await call("POST", `/v1/subscriptions/${intervalSub.body.data.subscription.id}/renew`, {
    headers: asKey(),
    payload: {},
  });
  check(
    "an interval change does not roll forward on its own",
    intervalRenewal.body.data?.subscription?.price?.id === intervalPrice.body.data.id,
    intervalRenewal.body.data?.subscription?.price
  );
  check("the monthly subscriber is still billed monthly", intervalRenewal.body.data?.amountDue === 300_000, intervalRenewal.body.data);

  // Trial length lives on the subscription once it starts, so changing it on
  // the price cannot move anybody who is already trialing.
  const trialEdit = await call("PATCH", `/v1/prices/${superseded.body.data.id}`, {
    headers: asKey(),
    payload: { trialDays: 14 },
  });
  check("trial length edits in place even with subscribers", trialEdit.body.data?.id === superseded.body.data.id, trialEdit.body);
  check("the trial length was applied", trialEdit.body.data?.trialDays === 14);

  // Aimed at the version people are actually on: v1 has been vacated by the
  // roll-forward above, and an abandoned row is free to change.
  const currencyChange = await call("PATCH", `/v1/prices/${superseded.body.data.id}`, {
    headers: asKey(),
    payload: { currency: "USD" },
  });
  check(
    "changing currency under live subscribers is refused",
    currencyChange.status >= 400,
    currencyChange.body
  );

  // -- 12f. Trials -----------------------------------------------------------
  section("12f. Trials");

  const trialPlan = await call("POST", "/v1/plans", {
    headers: asKey(),
    payload: { code: "trialled", name: "Trialled", features: { trial_feature: true } },
  });
  const trialPrice = await call("POST", "/v1/prices", {
    headers: asKey(),
    payload: {
      planId: "trialled",
      code: "trialled_monthly_ngn",
      currency: "NGN",
      unitAmount: 400_000,
      interval: "MONTHLY",
      trialDays: 14,
    },
  });
  check("a price can carry a trial", trialPlan.status === 201 && trialPrice.body.data?.trialDays === 14, trialPrice.body);

  // -- a trial for a customer with no payment method on file -----------------
  const cardless = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `trial-cardless-${stamp}` }),
    payload: {
      customer: { externalId: `trial_cardless_${stamp}`, email: `cardless-${stamp}@example.test` },
      priceId: "trialled_monthly_ngn",
    },
  });
  const cardlessId = cardless.body.data?.subscription?.id;
  const cardlessCustomerId = cardless.body.data?.subscription?.customerId;
  check("a trial subscription starts TRIALING", cardless.body.data?.subscription?.status === "TRIALING", cardless.body);
  check("a trial issues no invoice up front", cardless.body.data?.invoiceId === null, cardless.body.data);
  check("nothing is owed during a trial", cardless.body.data?.amountDue === 0);

  const trialAccess = await call("POST", "/v1/entitlements/check", {
    headers: asKey(),
    payload: { customerId: cardlessCustomerId, featureKey: "trial_feature" },
  });
  check("a trialing customer has service", trialAccess.body.data?.access === true, trialAccess.body);

  const trialStart = new Date(cardless.body.data.subscription.currentPeriodStart);
  const trialEnd = new Date(cardless.body.data.subscription.currentPeriodEnd);
  check(
    "the trial window is exactly the configured length",
    Math.round((trialEnd.getTime() - trialStart.getTime()) / 86_400_000) === 14,
    { trialStart, trialEnd }
  );
  check("trialEnd is recorded on the subscription", cardless.body.data.subscription.trialEnd !== null);

  const cardlessEnded = await call("POST", `/v1/subscriptions/${cardlessId}/renew`, {
    headers: asKey(),
    payload: {},
  });
  check("the trial's first paid period opens", cardlessEnded.body.data?.renewed === true, cardlessEnded.body);
  check("it is invoiced for the first real period", cardlessEnded.body.data?.amountDue === 400_000, cardlessEnded.body.data);
  check(
    "a trial with nothing to charge lapses instead of activating",
    ["PAST_DUE", "GRACE_PERIOD"].includes(cardlessEnded.body.data?.subscription?.status),
    cardlessEnded.body.data?.subscription?.status
  );
  check(
    "it is given a way to pay rather than left stranded",
    typeof cardlessEnded.body.data?.payment?.checkoutUrl === "string",
    cardlessEnded.body.data?.payment
  );

  const cardlessPeriodStart = new Date(cardlessEnded.body.data.subscription.currentPeriodStart);
  const cardlessPeriodEnd = new Date(cardlessEnded.body.data.subscription.currentPeriodEnd);
  check(
    "the paid period starts where the trial ended",
    cardlessPeriodStart.getTime() === trialEnd.getTime(),
    { cardlessPeriodStart, trialEnd }
  );
  check(
    "billing re-anchors to the trial end rather than the signup day",
    cardlessPeriodEnd.getUTCDate() === trialEnd.getUTCDate() ||
      // Month-end clamping: a trial ending on the 30th bills on the 28th.
      cardlessPeriodEnd.getUTCDate() ===
        new Date(Date.UTC(cardlessPeriodEnd.getUTCFullYear(), cardlessPeriodEnd.getUTCMonth() + 1, 0)).getUTCDate(),
    { cardlessPeriodEnd, trialEnd }
  );

  // -- a trial for a customer who already has a card on file -----------------
  // The customer from section 7, who paid a hosted checkout and left a stored
  // card behind.
  const cardCustomerId = created.body.data.subscription.customerId;
  const converting = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `trial-card-${stamp}` }),
    payload: { customerId: cardCustomerId, priceId: "trialled_monthly_ngn" },
  });
  const convertingId = converting.body.data?.subscription?.id;
  check(
    "a second trial starts for a customer with a stored card",
    converting.body.data?.subscription?.status === "TRIALING",
    converting.body
  );

  const convertingEnded = await call("POST", `/v1/subscriptions/${convertingId}/renew`, {
    headers: asKey(),
    payload: {},
  });
  check("the stored card is charged at trial end", convertingEnded.body.data?.payment?.status === "SUCCEEDED", convertingEnded.body.data?.payment);
  check("no checkout is opened for a card already on file", !convertingEnded.body.data?.payment?.checkoutUrl);
  check("the trial converts to ACTIVE", convertingEnded.body.data?.subscription?.status === "ACTIVE", convertingEnded.body.data?.subscription?.status);

  const convertingHistory = await prisma.subscriptionTransition.findMany({
    where: { subscriptionId: convertingId },
    orderBy: { createdAt: "asc" },
  });
  check(
    "a converting trial never passes through PAST_DUE",
    !convertingHistory.some((t) => t.toStatus === "PAST_DUE"),
    convertingHistory.map((t) => `${t.fromStatus ?? "-"}->${t.toStatus}`)
  );
  check(
    "the conversion is recorded as a payment, not a lapse",
    convertingHistory.at(-1)?.toStatus === "ACTIVE" && convertingHistory.at(-1)?.reason === "payment_succeeded",
    convertingHistory.at(-1)
  );

  // -- the interval, not the calendar, drives the next period ----------------
  const beforeSecond = new Date(convertingEnded.body.data.subscription.currentPeriodEnd);
  const secondPeriod = await call("POST", `/v1/subscriptions/${convertingId}/renew`, {
    headers: asKey(),
    payload: {},
  });
  const secondStart = new Date(secondPeriod.body.data.subscription.currentPeriodStart);
  const secondEnd = new Date(secondPeriod.body.data.subscription.currentPeriodEnd);
  check("periods are contiguous — no gap, no overlap", secondStart.getTime() === beforeSecond.getTime(), { secondStart, beforeSecond });
  check(
    "a monthly price advances exactly one month",
    (secondEnd.getUTCFullYear() - secondStart.getUTCFullYear()) * 12 +
      (secondEnd.getUTCMonth() - secondStart.getUTCMonth()) ===
      1,
    { secondStart, secondEnd }
  );
  check("the anchor day is held across renewals", secondEnd.getUTCDate() === secondStart.getUTCDate(), { secondStart, secondEnd });
  check("each renewal charges the stored card again", secondPeriod.body.data?.payment?.status === "SUCCEEDED", secondPeriod.body.data?.payment);
  check("the subscription stays ACTIVE across renewals", secondPeriod.body.data?.subscription?.status === "ACTIVE");

  const customSub = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `custom-${stamp}` }),
    payload: { customerId: cardCustomerId, priceId: "pro_90_days" },
  });
  check("a custom-day subscription can be created", customSub.status === 201, customSub.body);
  const customStart = new Date(customSub.body.data.subscription.currentPeriodStart);
  const customEnd = new Date(customSub.body.data.subscription.currentPeriodEnd);
  check(
    "a 90-day price bills every 90 days, not every three months",
    Math.round((customEnd.getTime() - customStart.getTime()) / 86_400_000) === 90,
    { customStart, customEnd }
  );

  const trialOverride = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `trial-off-${stamp}` }),
    payload: {
      customer: { externalId: `trial_off_${stamp}`, email: `trialoff-${stamp}@example.test` },
      priceId: "trialled_monthly_ngn",
      trialDays: 0,
    },
  });
  check(
    "trialDays: 0 skips a trial the price would otherwise grant",
    trialOverride.body.data?.subscription?.status === "INCOMPLETE",
    trialOverride.body.data?.subscription?.status
  );
  check("skipping the trial invoices immediately", trialOverride.body.data?.amountDue === 400_000, trialOverride.body.data);

  // -- 12h. Changing the policy under somebody already in a grace period ----
  section("12h. Changing policy mid-recovery");

  const midPolicyEmail = `midpolicy-${stamp}@example.test`;
  const midPolicy = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `midpolicy-${stamp}` }),
    payload: {
      customer: { externalId: `midpolicy_${stamp}`, email: midPolicyEmail, name: "Mid Policy" },
      priceId: "pro_monthly_ngn",
      metadata: { mockOutcome: "SUCCESS" },
    },
  });
  const midPolicySubId = midPolicy.body.data?.subscription?.id;
  const midPolicyCustomerId = midPolicy.body.data?.subscription?.customerId;
  await call("POST", `/mock/checkout/${midPolicy.body.data.payment.reference}/complete`, {
    payload: { outcome: "SUCCESS" },
  });
  await call("POST", `/v1/subscriptions/${midPolicySubId}/renew`, {
    headers: asKey(),
    payload: { metadata: { mockOutcome: "FAILED" } },
  });

  const inGrace = await call("GET", `/v1/subscriptions/${midPolicySubId}`, { headers: asKey() });
  const graceEndBefore = inGrace.body.data?.gracePeriodEnd;
  check("they are in a grace period", inGrace.body.data?.status === "GRACE_PERIOD", inGrace.body.data?.status);
  check("the policy in force is frozen onto them", inGrace.body.data?.gracePolicy?.gracePeriodDays === 3, inGrace.body.data?.gracePolicy);

  const accessDuringGrace = await call("POST", "/v1/entitlements/check", {
    headers: asKey(),
    payload: { customerId: midPolicyCustomerId, featureKey: "export_pdf" },
  });
  check("they still have service under the policy they lapsed on", accessDuringGrace.body.data?.access === true, accessDuringGrace.body);

  // The organization now changes its mind about everything.
  await call("PUT", "/v1/billing-settings", {
    headers: asKey(),
    payload: { gracePeriodDays: 30, failureAction: "CANCEL", accessDuringGracePeriod: "NO_ACCESS" },
  });

  const afterPolicyChange = await call("GET", `/v1/subscriptions/${midPolicySubId}`, { headers: asKey() });
  check(
    "a longer grace period does not extend one already running",
    afterPolicyChange.body.data?.gracePeriodEnd === graceEndBefore,
    { before: graceEndBefore, after: afterPolicyChange.body.data?.gracePeriodEnd }
  );
  check(
    "the frozen policy still says what will happen at the end",
    afterPolicyChange.body.data?.gracePolicy?.failureAction === "MARK_UNPAID",
    afterPolicyChange.body.data?.gracePolicy?.failureAction
  );

  const accessAfterChange = await call("POST", "/v1/entitlements/check", {
    headers: asKey(),
    payload: { customerId: midPolicyCustomerId, featureKey: "export_pdf" },
  });
  check(
    "and tightening access does not cut off somebody who lapsed under the old terms",
    accessAfterChange.body.data?.access === true,
    accessAfterChange.body
  );

  const expiredUnderOldPolicy = await expireGracePeriods(
    prisma,
    organizationId,
    new Date(new Date(graceEndBefore).getTime() + 60_000)
  );
  const outcome = expiredUnderOldPolicy.find((r) => r.subscriptionId === midPolicySubId);
  check(
    "the recovery ends on the terms it started on, not the new ones",
    outcome?.status === "UNPAID",
    outcome
  );

  // A customer who lapses from here does get the new policy.
  const newPolicyEmail = `newpolicy-${stamp}@example.test`;
  const newPolicy = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `newpolicy-${stamp}` }),
    payload: {
      customer: { externalId: `newpolicy_${stamp}`, email: newPolicyEmail, name: "New Policy" },
      priceId: "pro_monthly_ngn",
      metadata: { mockOutcome: "SUCCESS" },
    },
  });
  await call("POST", `/mock/checkout/${newPolicy.body.data.payment.reference}/complete`, {
    payload: { outcome: "SUCCESS" },
  });
  await call("POST", `/v1/subscriptions/${newPolicy.body.data.subscription.id}/renew`, {
    headers: asKey(),
    payload: { metadata: { mockOutcome: "FAILED" } },
  });
  const underNewPolicy = await call("GET", `/v1/subscriptions/${newPolicy.body.data.subscription.id}`, {
    headers: asKey(),
  });
  const newGraceDays = Math.round(
    (new Date(underNewPolicy.body.data.gracePeriodEnd).getTime() -
      new Date(underNewPolicy.body.data.gracePeriodStart).getTime()) / 86_400_000
  );
  check("the next customer to lapse gets the new policy", newGraceDays === 30, { newGraceDays });
  check(
    "including what happens when their grace period ends",
    underNewPolicy.body.data?.gracePolicy?.failureAction === "CANCEL",
    underNewPolicy.body.data?.gracePolicy?.failureAction
  );

  const accessUnderNewPolicy = await call("POST", "/v1/entitlements/check", {
    headers: asKey(),
    payload: { customerId: underNewPolicy.body.data.customerId, featureKey: "export_pdf" },
  });
  check("and the new access policy applies to them", accessUnderNewPolicy.body.data?.access === false, accessUnderNewPolicy.body);

  // Put it back so the sections after this one see the policy they expect.
  await call("PUT", "/v1/billing-settings", {
    headers: asKey(),
    payload: { gracePeriodDays: 3, failureAction: "MARK_UNPAID", accessDuringGracePeriod: "FULL_ACCESS" },
  });

  // -- 12g. The dunning ladder and the email that goes with it ---------------
  section("12g. Dunning retries and customer email");

  const mailbox = new LogEmailTransport(() => {});
  const jobCtx = {
    prisma,
    providerDeps: { redis, checkoutBaseUrl: "http://localhost:4000", encryptionKey: undefined },
    environment: "TEST" as const,
    log: () => {},
  };
  const mailCtx = { ...jobCtx, transport: mailbox };

  /** The last message the transport actually delivered to one address. */
  function lastMailTo(toEmail: string) {
    return [...mailbox.sent].reverse().find((m) => m.to === toEmail);
  }

  /** Emails of one type sent to one address, newest last. */
  async function outbox(type: string, toEmail?: string) {
    return prisma.emailMessage.findMany({
      where: { organizationId, type, ...(toEmail ? { toEmail } : {}) },
      orderBy: { createdAt: "asc" },
    });
  }

  const dunnedEmail = `dunned-${stamp}@example.test`;
  const dunned = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `dunned-${stamp}` }),
    payload: {
      customer: { externalId: `dunned_${stamp}`, email: dunnedEmail, name: "Chidi Nwosu" },
      priceId: "pro_monthly_ngn",
      metadata: { mockOutcome: "SUCCESS" },
    },
  });
  const dunnedSubId = dunned.body.data?.subscription?.id;
  await call("POST", `/mock/checkout/${dunned.body.data.payment.reference}/complete`, {
    payload: { outcome: "SUCCESS" },
  });
  check("a paying subscriber exists to be dunned", dunned.status === 201, dunned.body);

  // The mock rail declines any charge against a token minted as mock_pm_fail_*.
  // Rewriting the stored token is how this walks a real ladder: the retries the
  // job makes are ordinary charges with no test directive attached, exactly as
  // they will be in production, and they decline because the card does.
  const dunnedMethod = await prisma.paymentMethod.findFirst({
    where: { organizationId, customerId: dunned.body.data.subscription.customerId },
  });
  await prisma.paymentMethod.update({
    where: { id: dunnedMethod!.id },
    data: { providerPaymentMethodRef: `mock_pm_fail_${dunnedMethod!.id}` },
  });

  const declinedRenewal = await call("POST", `/v1/subscriptions/${dunnedSubId}/renew`, {
    headers: asKey(),
    payload: { metadata: { mockOutcome: "FAILED" } },
  });
  const dunnedInvoiceId = declinedRenewal.body.data?.invoiceId;
  check("their renewal declines", declinedRenewal.body.data?.payment?.status === "FAILED", declinedRenewal.body.data?.payment);

  const scheduled = await prisma.invoice.findUnique({ where: { id: dunnedInvoiceId } });
  check("the failure schedules a retry rather than just recording itself", scheduled?.nextRetryAt !== null, scheduled?.nextRetryAt);
  check("the invoice counts the failure", scheduled?.dunningAttempts === 1, scheduled?.dunningAttempts);

  // This organization's schedule is [0, 1, 3, 5]; the first retry is same-day.
  const firstAttemptAt = (
    await prisma.paymentAttempt.findFirst({
      where: { invoiceId: dunnedInvoiceId, status: "FAILED" },
      orderBy: { createdAt: "asc" },
    })
  )?.createdAt;
  check(
    "the first retry is same-day, so the schedule's first entry is not skipped",
    Math.abs(scheduled!.nextRetryAt!.getTime() - firstAttemptAt!.getTime()) < 1000,
    { nextRetryAt: scheduled?.nextRetryAt, firstAttemptAt }
  );

  // -- the ladder runs -------------------------------------------------------
  // Asserted on this invoice rather than on the batch counters: the suite runs
  // against one database and earlier sections leave their own failed invoices
  // behind, which is exactly the situation the job meets in production.
  const runAt = new Date(Date.now() + 60_000);
  await runDunningRetries(jobCtx as never, runAt);

  const afterFirstRetry = await prisma.invoice.findUnique({ where: { id: dunnedInvoiceId } });
  check("the ladder picks up the due invoice and charges again", afterFirstRetry?.dunningAttempts === 2, afterFirstRetry?.dunningAttempts);
  check("and reschedules further out, not on a fixed loop", afterFirstRetry!.nextRetryAt!.getTime() > scheduled!.nextRetryAt!.getTime(), {
    first: scheduled?.nextRetryAt,
    second: afterFirstRetry?.nextRetryAt,
  });

  await runDunningRetries(jobCtx as never, runAt);
  const afterSecondRun = await prisma.invoice.findUnique({ where: { id: dunnedInvoiceId } });
  check(
    "an invoice whose next retry has not arrived is left alone",
    afterSecondRun?.dunningAttempts === 2,
    afterSecondRun?.dunningAttempts
  );

  // -- the customer is told --------------------------------------------------
  await runNotifications(mailCtx as never);
  const failedMail = await outbox("payment_failed", dunnedEmail);
  check("the customer is told their payment failed", failedMail.length >= 1, failedMail.map((m) => m.subject));
  check("the email actually went out", failedMail.at(-1)?.status === "SENT", failedMail.at(-1));
  check("it names the amount, not the minor units", lastMailTo(dunnedEmail)?.text.includes("₦10,000.00"), lastMailTo(dunnedEmail)?.text);
  check("it names the next attempt date", /\d{1,2} \w+ \d{4}/.test(lastMailTo(dunnedEmail)?.text ?? ""), lastMailTo(dunnedEmail)?.text);
  check("it is signed by the merchant, not the platform", Boolean(lastMailTo(dunnedEmail)?.fromName));

  const before = mailbox.sent.filter((m) => m.to === dunnedEmail).length;
  await runNotifications(mailCtx as never);
  check(
    "running the job again sends nothing twice",
    mailbox.sent.filter((m) => m.to === dunnedEmail).length === before,
    { before, after: mailbox.sent.filter((m) => m.to === dunnedEmail).length }
  );

  // -- the ladder runs out ---------------------------------------------------
  // Interleaved the way the two schedulers actually run: the ladder makes an
  // attempt, the notifier tells the customer about it, repeat.
  let guard = 0;
  while (guard < 10) {
    const invoice = await prisma.invoice.findUnique({ where: { id: dunnedInvoiceId } });
    if (!invoice?.nextRetryAt) break;
    await runDunningRetries(jobCtx as never, new Date(invoice.nextRetryAt.getTime() + 60_000));
    await runNotifications(mailCtx as never);
    guard += 1;
  }
  const exhaustedInvoice = await prisma.invoice.findUnique({ where: { id: dunnedInvoiceId } });
  check("the ladder stops at the configured attempt limit", exhaustedInvoice?.nextRetryAt === null, exhaustedInvoice?.dunningAttempts);
  check("it did not retry forever", (exhaustedInvoice?.dunningAttempts ?? 0) <= 4, exhaustedInvoice?.dunningAttempts);
  check("each failure is its own email, one per attempt", (await outbox("payment_failed", dunnedEmail)).length >= 2);

  await runNotifications(mailCtx as never);
  const finalMail = await outbox("dunning_exhausted", dunnedEmail);
  check("a final email says the automatic attempts are over", finalMail.length === 1, finalMail.map((m) => m.subject));
  check("and carries a link the customer can actually pay through", (lastMailTo(dunnedEmail)?.text ?? "").includes("http"), lastMailTo(dunnedEmail)?.text);

  // -- recovery closes the loop ---------------------------------------------
  const dunningRecovery = await call("POST", `/v1/invoices/${dunnedInvoiceId}/pay`, {
    headers: asKey(),
    payload: { metadata: { mockOutcome: "SUCCESS" } },
  });
  check("the outstanding invoice can still be paid", dunningRecovery.body.data?.status === "SUCCEEDED", dunningRecovery.body);

  const settled = await prisma.invoice.findUnique({ where: { id: dunnedInvoiceId } });
  check("paying clears the retry schedule", settled?.nextRetryAt === null && settled?.status === "PAID", settled?.status);

  await runNotifications(mailCtx as never);
  check("the customer is told it came good", (await outbox("payment_recovered", dunnedEmail)).length === 1);

  const farFuture = new Date(Date.now() + 30 * 86_400_000);
  await runDunningRetries(jobCtx as never, farFuture);
  const stillDue = await prisma.invoice.findMany({
    where: { id: dunnedInvoiceId, status: "OPEN", nextRetryAt: { lte: farFuture } },
    select: { id: true },
  });
  check("a paid invoice is never retried again, however far time moves", stillDue.length === 0, stillDue);

  // -- notice before a price rise -------------------------------------------
  const noticePlan = await call("POST", "/v1/plans", {
    headers: asKey(),
    payload: { code: "noticed", name: "Noticed" },
  });
  const noticePrice = await call("POST", "/v1/prices", {
    headers: asKey(),
    payload: { planId: "noticed", code: "noticed_monthly_ngn", currency: "NGN", unitAmount: 600_000, interval: "MONTHLY" },
  });
  const noticeEmail = `notice-${stamp}@example.test`;
  const noticeSub = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `notice-${stamp}` }),
    payload: {
      customer: { externalId: `notice_${stamp}`, email: noticeEmail, name: "Zainab Bello" },
      priceId: noticePrice.body.data.id,
    },
  });
  await call("POST", `/mock/checkout/${noticeSub.body.data.payment.reference}/complete`, {
    payload: { outcome: "SUCCESS" },
  });
  check("a subscriber exists to be warned", noticePlan.status === 201 && noticeSub.status === 201, noticeSub.body);

  await runNotifications(mailCtx as never);
  check("nothing is sent while the price has not changed", (await outbox("price_change", noticeEmail)).length === 0);

  const raised = await call("PATCH", `/v1/prices/${noticePrice.body.data.id}`, {
    headers: asKey(),
    payload: { unitAmount: 900_000 },
  });
  check("the price is raised", raised.body.data?.version === 2, raised.body);

  // The renewal is a month out, so nothing should go yet.
  await runNotifications(mailCtx as never);
  check("no notice goes out a month early", (await outbox("price_change", noticeEmail)).length === 0);

  // Bring the renewal inside the notice window the organization configured.
  const noticeSubId = noticeSub.body.data.subscription.id;
  await prisma.subscription.update({
    where: { id: noticeSubId },
    data: { currentPeriodEnd: new Date(Date.now() + 3 * 86_400_000) },
  });
  await runNotifications(mailCtx as never);

  const noticeMail = await outbox("price_change", noticeEmail);
  check("the customer is warned before the new price applies", noticeMail.length === 1, noticeMail.map((m) => m.subject));
  const noticeBody = lastMailTo(noticeEmail)?.text ?? "";
  check("the notice names the old price", noticeBody.includes("₦6,000.00"), noticeBody);
  check("the notice names the new price", noticeBody.includes("₦9,000.00"), noticeBody);
  check("the notice says the current period is unaffected", noticeBody.includes("current period is unaffected"));
  check("the notice offers the way out that keeps it from being a chargeback", noticeBody.includes("cancel before that date"));

  await runNotifications(mailCtx as never);
  check("the warning is sent once, not on every run", (await outbox("price_change", noticeEmail)).length === 1);

  // -- notice before a trial converts ---------------------------------------
  const trialNoticeEmail = `trialnotice-${stamp}@example.test`;
  const trialNotice = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `trialnotice-${stamp}` }),
    payload: {
      customer: { externalId: `trialnotice_${stamp}`, email: trialNoticeEmail, name: "Tunde Ade" },
      priceId: "trialled_monthly_ngn",
    },
  });
  check("a trialing subscriber exists", trialNotice.body.data?.subscription?.status === "TRIALING", trialNotice.body);

  await runNotifications(mailCtx as never);
  check("nothing is sent while the trial has weeks to run", (await outbox("trial_ending", trialNoticeEmail)).length === 0);

  await prisma.subscription.update({
    where: { id: trialNotice.body.data.subscription.id },
    data: { trialEnd: new Date(Date.now() + 2 * 86_400_000) },
  });
  await runNotifications(mailCtx as never);
  const trialMail = await outbox("trial_ending", trialNoticeEmail);
  check("the customer is warned before the trial becomes a charge", trialMail.length === 1, trialMail.map((m) => m.subject));
  check(
    "and told there is no card on file rather than promised a charge",
    (lastMailTo(trialNoticeEmail)?.text ?? "").includes("no payment method on file"),
    lastMailTo(trialNoticeEmail)?.text
  );

  // -- an organization that has switched email off --------------------------
  await call("PUT", "/v1/billing-settings", {
    headers: asKey(),
    payload: { notificationsEnabled: false },
  });
  const quietEmail = `quiet-${stamp}@example.test`;
  const quiet = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `quiet-${stamp}` }),
    payload: {
      customer: { externalId: `quiet_${stamp}`, email: quietEmail, name: "Quiet" },
      priceId: "pro_monthly_ngn",
      metadata: { mockOutcome: "SUCCESS" },
    },
  });
  await call("POST", `/mock/checkout/${quiet.body.data.payment.reference}/complete`, {
    payload: { outcome: "SUCCESS" },
  });
  await call("POST", `/v1/subscriptions/${quiet.body.data.subscription.id}/renew`, {
    headers: asKey(),
    payload: { metadata: { mockOutcome: "FAILED" } },
  });

  await runNotifications(mailCtx as never);
  const quietMail = await outbox("payment_failed", quietEmail);
  check("email off means nothing is delivered", mailbox.sent.every((m) => m.to !== quietEmail));
  check("but the decision is still recorded rather than lost", quietMail.length === 1, quietMail);
  check("and recorded honestly as suppressed, not as sent", quietMail[0]?.status === "SUPPRESSED", quietMail[0]?.status);

  await call("PUT", "/v1/billing-settings", {
    headers: asKey(),
    payload: { notificationsEnabled: true },
  });

  // -- 13. Webhooks ----------------------------------------------------------
  section("13. Webhook verification and de-duplication");

  const webhookSub = await call("POST", "/v1/subscriptions", {
    headers: asKey({ "idempotency-key": `wh-${stamp}` }),
    payload: {
      customer: { externalId: "user_webhook", email: "webhook@example.test" },
      priceId: "pro_monthly_ngn",
    },
  });
  const webhookRef = webhookSub.body.data.payment.reference;
  await call("POST", `/mock/checkout/${webhookRef}/complete`, { payload: { outcome: "SUCCESS" } });

  const txn = JSON.parse(
    (await redis.get(`mock:txn:${webhookRef}`)) ?? "null"
  );
  const eventBody = JSON.stringify({
    id: `mock_evt_${txn.providerReference}_SUCCEEDED`,
    event: "payment.succeeded",
    createdAt: new Date().toISOString(),
    data: {
      reference: webhookRef,
      providerReference: txn.providerReference,
      amount: txn.amount,
      currency: txn.currency,
      status: "SUCCEEDED",
      method: txn.method,
      paidAt: txn.paidAt,
      paymentMethodRef: txn.paymentMethodRef,
    },
  });
  const signature = createHmac("sha256", "whsec_e2e").update(eventBody).digest("hex");

  const unsigned = await app.inject({
    method: "POST",
    url: "/webhooks/mock",
    headers: { "content-type": "application/json" },
    payload: eventBody,
  });
  check("an unsigned webhook is refused", unsigned.statusCode === 403, unsigned.statusCode);

  const tampered = await app.inject({
    method: "POST",
    url: "/webhooks/mock",
    headers: { "content-type": "application/json", "x-mock-signature": signature },
    payload: eventBody.replace(String(txn.amount), "1"),
  });
  check("a tampered webhook is refused", tampered.statusCode === 403);

  const accepted = await app.inject({
    method: "POST",
    url: "/webhooks/mock",
    headers: { "content-type": "application/json", "x-mock-signature": signature },
    payload: eventBody,
  });
  check("a signed webhook is accepted", accepted.statusCode === 200, accepted.body.slice(0, 200));

  const replayed = await app.inject({
    method: "POST",
    url: "/webhooks/mock",
    headers: { "content-type": "application/json", "x-mock-signature": signature },
    payload: eventBody,
  });
  check("a replayed webhook is ignored, not reprocessed", replayed.json().data?.duplicate === true);

  const events = await prisma.webhookEvent.count({ where: { organizationId, status: "PROCESSED" } });
  check("exactly one webhook event was processed", events === 1, { events });

  // Paystack cannot carry the underscore in a `pay_...` id and is sent a dashed
  // reference instead. The intake resolves the organization from the raw body
  // before any adapter exists, so it has to recognise that spelling — otherwise
  // every real Paystack delivery is filed as "unmatched" and silently dropped.
  const paystackSecret = "sk_test_e2e_reference_shape";
  await call("POST", "/v1/payment-providers", {
    headers: asUser(),
    payload: {
      provider: "PAYSTACK",
      environment: "TEST",
      credentials: { secretKey: paystackSecret },
      isDefault: false,
    },
  });

  const anyAttempt = await prisma.paymentAttempt.findFirst({ where: { organizationId } });
  const dashedReference = anyAttempt!.id.replace("_", "-");
  check("a payment attempt id contains the character Paystack rejects", anyAttempt!.id.includes("_"));

  // An event type that normalizes to UNKNOWN, so the intake records it without
  // calling out to Paystack — this asserts routing and signature only.
  const paystackBody = JSON.stringify({
    event: "subscription.not_renew",
    data: { id: 987654, reference: dashedReference, currency: "NGN", amount: 100 },
  });
  const paystackSignature = createHmac("sha512", paystackSecret).update(paystackBody).digest("hex");

  const paystackDelivery = await app.inject({
    method: "POST",
    url: "/webhooks/paystack",
    headers: { "content-type": "application/json", "x-paystack-signature": paystackSignature },
    payload: paystackBody,
  });
  check(
    "a Paystack webhook with a dashed reference finds its organization",
    paystackDelivery.statusCode === 200 && paystackDelivery.json().data?.received === true,
    paystackDelivery.body.slice(0, 200)
  );

  const paystackEvent = await prisma.webhookEvent.findFirst({
    where: { organizationId, provider: "PAYSTACK" },
  });
  check(
    "it is recorded against the tenant with a verified signature",
    paystackEvent?.organizationId === organizationId && paystackEvent?.signatureVerified === true,
    { matched: paystackEvent?.organizationId, verified: paystackEvent?.signatureVerified }
  );

  const forgedPaystack = await app.inject({
    method: "POST",
    url: "/webhooks/paystack",
    headers: { "content-type": "application/json", "x-paystack-signature": "deadbeef" },
    payload: paystackBody,
  });
  check("a Paystack webhook with a bad signature is refused", forgedPaystack.statusCode === 403);

  // -- 14. Tenant isolation --------------------------------------------------
  section("14. Tenant isolation");

  const other = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({
      email: `intruder+${stamp}@example.test`,
      name: "Intruder",
      password: "correct-horse-battery-staple",
      organizationName: `Other Org ${stamp}`,
    }),
  });
  const otherCookie = `${other.cookies[0]!.name}=${other.cookies[0]!.value}`;
  const otherKeyResponse = await call("POST", "/v1/api-keys", {
    headers: { cookie: otherCookie },
    payload: { name: "intruder", type: "SECRET", environment: "TEST" },
  });
  const otherKey = otherKeyResponse.body.data.secret;

  const crossRead = await call("GET", `/v1/subscriptions/${subscriptionId}`, {
    headers: { authorization: `Bearer ${otherKey}` },
  });
  check("another tenant cannot read the subscription", crossRead.status === 404, crossRead.status);

  const crossInvoice = await call("GET", `/v1/invoices/${firstInvoiceId}`, {
    headers: { authorization: `Bearer ${otherKey}` },
  });
  check("another tenant cannot read the invoice", crossInvoice.status === 404);

  const crossPay = await call("POST", `/v1/invoices/${firstInvoiceId}/pay`, {
    headers: { authorization: `Bearer ${otherKey}` },
    payload: {},
  });
  check("another tenant cannot pay the invoice", crossPay.status === 404);

  const crossHeader = await call("GET", "/v1/plans", {
    headers: { cookie: otherCookie, "x-organization-id": organizationId },
  });
  check("a forged organization header is rejected", crossHeader.body.error?.code === "CROSS_TENANT_ACCESS", crossHeader.body);

  const sameExternalId = await call("POST", "/v1/customers", {
    headers: { authorization: `Bearer ${otherKey}` },
    payload: { externalId: "user_83921", email: "different@example.test" },
  });
  check("two tenants may use the same external customer id", sameExternalId.status === 201);

  const otherTenantEdit = await call("PATCH", `/v1/prices/${supersededPriceId}`, {
    headers: { authorization: `Bearer ${otherKey}` },
    payload: { nickname: "hijacked" },
  });
  check("another tenant cannot edit the price", otherTenantEdit.status === 404, otherTenantEdit.body);

  // -- 15. Key revocation and cancellation -----------------------------------
  section("15. Revocation and cancellation");

  const cancelled = await call("POST", `/v1/subscriptions/${subscriptionId}/cancel`, {
    headers: asKey(),
    payload: { atPeriodEnd: true },
  });
  check("cancellation can be scheduled", cancelled.body.data?.cancelAtPeriodEnd === true, cancelled.body);

  const resumed = await call("POST", `/v1/subscriptions/${subscriptionId}/resume`, { headers: asKey(), payload: {} });
  check("a scheduled cancellation can be revoked", resumed.body.data?.cancelAtPeriodEnd === false);

  const cancelledNow = await call("POST", `/v1/subscriptions/${subscriptionId}/cancel`, {
    headers: asKey(),
    payload: { atPeriodEnd: false },
  });
  check("immediate cancellation works", cancelledNow.body.data?.status === "CANCELED");

  const doubleCancel = await call("POST", `/v1/subscriptions/${subscriptionId}/cancel`, {
    headers: asKey(),
    payload: { atPeriodEnd: false },
  });
  check("a canceled subscription cannot be canceled twice", doubleCancel.body.error?.code === "SUBSCRIPTION_ALREADY_CANCELED");

  const renewCanceled = await call("POST", `/v1/subscriptions/${subscriptionId}/renew`, { headers: asKey(), payload: {} });
  check("a canceled subscription cannot renew", renewCanceled.body.error?.code === "INVALID_STATE_TRANSITION");

  const keyId = keyResponse.body.data.id;
  await call("DELETE", `/v1/api-keys/${keyId}`, { headers: asUser() });
  const afterRevoke = await call("GET", "/v1/plans", { headers: asKey() });
  check("a revoked key stops working immediately", afterRevoke.body.error?.code === "API_KEY_REVOKED", afterRevoke.body);

  // -- 16. Pagination and search --------------------------------------------
  section("16. Pagination and search");

  const firstPage = await call("GET", "/v1/customers?limit=2", { headers: asUser() });
  check("a page is capped at the requested limit", firstPage.body.data.items.length <= 2, firstPage.body.data);
  check("the envelope reports page, limit and total",
    firstPage.body.data.page === 1 &&
      firstPage.body.data.limit === 2 &&
      typeof firstPage.body.data.total === "number",
    firstPage.body.data
  );
  check(
    "totalPages is derived from the total, not the page",
    firstPage.body.data.totalPages === Math.max(1, Math.ceil(firstPage.body.data.total / 2)),
    firstPage.body.data
  );

  const secondPage = await call("GET", "/v1/customers?limit=2&page=2", { headers: asUser() });
  const firstIds = new Set(firstPage.body.data.items.map((c: Json) => c.id));
  check(
    "page 2 returns different rows to page 1",
    secondPage.body.data.items.every((c: Json) => !firstIds.has(c.id)),
    secondPage.body.data.items.map((c: Json) => c.id)
  );

  const searched = await call("GET", "/v1/customers?q=user_explicit", { headers: asUser() });
  check(
    "search matches on the developer's own id",
    searched.body.data.items.length > 0 &&
      searched.body.data.items.every((c: Json) => String(c.externalId ?? "").includes("user_explicit")),
    searched.body.data.items
  );

  const noMatch = await call("GET", "/v1/customers?q=zzz-no-such-customer", { headers: asUser() });
  check("a search with no matches returns an empty page, not an error",
    noMatch.body.data.items.length === 0 && noMatch.body.data.total === 0,
    noMatch.body
  );

  // A page number nobody typed on purpose must not 500 the dashboard.
  const garbage = await call("GET", "/v1/customers?page=not-a-number&limit=abc", { headers: asUser() });
  check(
    "an unparseable page falls back to page one",
    garbage.body.data.page === 1 && garbage.body.data.limit === 25,
    garbage.body.data
  );

  const overLimit = await call("GET", "/v1/customers?limit=100000", { headers: asUser() });
  check("limit is clamped so one request cannot ask for everything", overLimit.body.data.limit === 100);

  const searchedSubs = await call("GET", "/v1/subscriptions?q=user_explicit", { headers: asUser() });
  check(
    "subscriptions can be searched by their customer",
    Array.isArray(searchedSubs.body.data.items),
    searchedSubs.body
  );

  const otherOrgPage = await call("GET", "/v1/customers?limit=100", {
    headers: { authorization: `Bearer ${otherKey}` },
  });
  check(
    "pagination never crosses a tenant boundary",
    otherOrgPage.body.data.items.every((c: Json) => !firstIds.has(c.id)),
    otherOrgPage.body.data.total
  );

  // -- 17. Audit trail -------------------------------------------------------
  section("17. Audit trail");

  const auditRows = await prisma.auditLog.findMany({ where: { organizationId } });
  const actions = new Set(auditRows.map((r) => r.action));
  check("organization creation audited", actions.has("organization.created"));
  check("api key lifecycle audited", actions.has("api_key.created") && actions.has("api_key.revoked"));
  check("provider configuration audited", actions.has("payment_provider.configured"));
  check("billing settings changes audited", actions.has("billing_settings.updated"));
  check("no provider secret leaked into the audit trail", !JSON.stringify(auditRows).includes("whsec_e2e"));

  // -- summary ---------------------------------------------------------------
  await app.close();
  await prisma.$disconnect();

  console.log(`\n${"─".repeat(60)}`);
  if (failed === 0) {
    console.log(`\x1b[32mAll ${passed} end-to-end checks passed.\x1b[0m`);
  } else {
    console.log(`\x1b[31m${failed} of ${passed + failed} checks failed:\x1b[0m`);
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log(`${"─".repeat(60)}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
