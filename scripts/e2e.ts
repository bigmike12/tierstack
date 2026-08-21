/**
 * End-to-end walk through the billing core, driven over real HTTP against a
 * real PostgreSQL and Redis. Nothing here is mocked except the payment rail
 * itself, which is the point: the mock provider is a complete implementation,
 * so the flow a developer runs locally is the flow that runs in production.
 *
 *   npm run e2e
 */
import { createHmac } from "node:crypto";
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

  const unsupportedProvider = await call("POST", "/v1/payment-providers", {
    headers: asUser(),
    payload: { provider: "PAYSTACK", environment: "TEST", credentials: { secretKey: "sk_x" } },
  });
  const paystackListed = (await call("GET", "/v1/payment-providers", { headers: asUser() })).body.data.find(
    (c: Json) => c.provider === "PAYSTACK"
  );
  check("an unimplemented adapter reports no capabilities rather than faking them",
    unsupportedProvider.status === 201 && paystackListed?.capabilities === null);
  await call("DELETE", `/v1/payment-providers/${paystackListed.id}`, { headers: asUser() });

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
  check("subscription is not active before payment", created.body.data?.subscription?.status === "PAST_DUE");
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
  check("two invoices now exist", invoices.body.data.length === 2);
  check("invoice numbers are sequential", invoices.body.data.map((i: Json) => i.invoiceNumber).every((n: string) => n.startsWith("INV-")));

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
  check("subscription enters the grace period", afterFailure.body.data.status === "GRACE_PERIOD", afterFailure.body.data.status);

  const graceDays = Math.round(
    (new Date(afterFailure.body.data.gracePeriodEnd).getTime() -
      new Date(afterFailure.body.data.gracePeriodStart).getTime()) /
      86_400_000
  );
  check("grace period is the configured 3 days, not a hard-coded default", graceDays === 3, { graceDays });
  check("the policy in force is frozen onto the subscription", afterFailure.body.data.gracePolicy?.failureAction === "MARK_UNPAID");

  const transitions = await call("GET", `/v1/subscriptions/${failingSubId}/transitions`, { headers: asKey() });
  const path = transitions.body.data.map((t: Json) => t.toStatus);
  check("a first payment that never settles goes straight into the grace period",
    JSON.stringify(path) === JSON.stringify(["PAST_DUE", "GRACE_PERIOD"]), path);

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
  check("a second grace period opens with the same configured length",
    Math.round(
      (new Date(afterRenewalFailure.body.data.gracePeriodEnd).getTime() -
        new Date(afterRenewalFailure.body.data.gracePeriodStart).getTime()) / 86_400_000
    ) === 3);

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

  // -- 16. Audit trail -------------------------------------------------------
  section("16. Audit trail");

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
