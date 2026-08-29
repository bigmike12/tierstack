import type { DocGroup, DocPage } from "./types";

/**
 * The documentation, as data.
 *
 * Accuracy rule: every endpoint listed here exists in `apps/api/src/routes`.
 * If a route is added, changed or removed, this file changes in the same
 * commit. Anything not yet built is named as not built rather than omitted —
 * a gap a reader discovers by hitting a 404 costs more trust than a gap the
 * page admits to.
 */

const gettingStarted: DocPage[] = [
  {
    slug: "quickstart",
    title: "Quickstart",
    summary: "A customer, a subscription and an entitlement check, in three calls.",
    blocks: [
      {
        kind: "prose",
        text: "This walks the whole loop: create a subscription for a customer, let the billing engine collect the money, then ask whether that customer is allowed to do something. It runs in test mode, so no provider account and no real card are involved.",
      },
      { kind: "heading", text: "1. Get a secret key" },
      {
        kind: "prose",
        text: "Create one from **API keys** in the dashboard. Test keys start with `sk_test_` and live keys with `sk_live_`. The full key is shown once and only its SHA-256 is stored, so if you lose it you create another.",
      },
      { kind: "heading", text: "2. Create a subscription" },
      {
        kind: "prose",
        text: "One call resolves or creates the customer, opens the subscription, issues the first invoice and starts collection.",
      },
      {
        kind: "code",
        caption: "Request",
        code: `POST /v1/subscriptions
Authorization: Bearer sk_test_…
Idempotency-Key: sub_7f21c0
Content-Type: application/json

{
  "customer": {
    "externalId": "user_83921",
    "email": "ada@example.com",
    "name": "Ada Okafor",
    "country": "NG"
  },
  "priceId": "pro_monthly_ngn"
}`,
      },
      {
        kind: "code",
        caption: "Response",
        code: `{
  "data": {
    "subscription": {
      "id": "sub_…",
      "status": "ACTIVE",
      "currentPeriodStart": "2026-08-27T00:00:00.000Z",
      "currentPeriodEnd": "2026-09-27T00:00:00.000Z"
    },
    "invoiceId": "inv_…",
    "amountDue": 1000000
  },
  "error": null,
  "requestId": "req_…"
}`,
      },
      {
        kind: "note",
        text: "`amountDue` is an integer in the currency's smallest unit. 1000000 is ₦10,000.00, not ₦1,000,000.",
      },
      { kind: "heading", text: "3. Ask what the customer may do" },
      {
        kind: "prose",
        text: "Your application never needs to know which plan somebody is on. It asks one question and gets an answer with the reason attached.",
      },
      {
        kind: "code",
        code: `POST /v1/entitlements/check
Authorization: Bearer sk_test_…

{ "customerId": "user_83921", "feature": "export_pdf" }`,
      },
      {
        kind: "code",
        code: `{
  "data": {
    "allowed": true,
    "limit": 5,
    "used": 2,
    "remaining": 3,
    "reason": "Granted by a plan feature flag"
  },
  "error": null,
  "requestId": "req_…"
}`,
      },
      { kind: "heading", text: "What happens next, without you" },
      {
        kind: "list",
        items: [
          "The period closes and the next invoice opens on schedule.",
          "If the card fails, the retry ladder runs and the customer is emailed a link to fix it.",
          "If the retries are spent, the subscription moves to the state your grace policy says.",
          "Usage recorded against a meter is totalled and billed in arrears on the next invoice.",
        ],
      },
    ],
  },
  {
    slug: "authentication",
    title: "Authentication",
    summary: "Secret keys, environments, and the two kinds of caller.",
    blocks: [
      {
        kind: "prose",
        text: "Every request outside `/portal/*` carries a secret key as a bearer token.",
      },
      { kind: "code", code: `Authorization: Bearer sk_test_4f2a…` },
      { kind: "heading", text: "Key format" },
      {
        kind: "table",
        head: ["Prefix", "Meaning"],
        rows: [
          ["`sk_test_`", "Secret key, test environment. Safe to use against the mock rail."],
          ["`sk_live_`", "Secret key, live environment. Moves real money."],
          ["`pk_test_` / `pk_live_`", "Publishable key. Reserved; not yet used by any endpoint."],
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text: "Secret keys belong on your server. Never put one in a browser, a mobile app, or a repository.",
      },
      { kind: "heading", text: "Environments are separate" },
      {
        kind: "prose",
        text: "Keys, provider credentials and data are scoped to an environment. A test key cannot read live data and a live key cannot read test data — the attempt returns `ENVIRONMENT_MISMATCH` rather than an empty list, so a misconfigured deploy fails loudly instead of looking like a quiet Monday.",
      },
      { kind: "heading", text: "The portal is authenticated differently" },
      {
        kind: "prose",
        text: "Routes under `/portal/*` accept a portal session token and nothing else, and no portal route takes a customer id — the customer is whoever the token belongs to. An API key is rejected there, and a portal token is rejected everywhere else. See **Customer portal**.",
      },
      { kind: "heading", text: "Managing keys" },
      { kind: "endpoint", method: "GET", path: "/v1/api-keys", summary: "List keys, by prefix. The secret is never returned again." },
      { kind: "endpoint", method: "POST", path: "/v1/api-keys", summary: "Create a key. The full secret is in this response only." },
      { kind: "endpoint", method: "DELETE", path: "/v1/api-keys/:keyId", summary: "Revoke a key immediately." },
    ],
  },
  {
    slug: "responses-and-errors",
    title: "Responses and errors",
    summary: "One envelope for everything, and the codes you can switch on.",
    blocks: [
      {
        kind: "prose",
        text: "Every response — success or failure — has the same three keys. There is no second shape to handle.",
      },
      {
        kind: "code",
        code: `{
  "data":      <the result, or null>,
  "error":     { "code": "...", "message": "...", "details": ... } | null,
  "requestId": "req_…"
}`,
      },
      {
        kind: "prose",
        text: "`requestId` appears on every response and in the server logs. Quote it when something goes wrong and the exact request can be found.",
      },
      { kind: "heading", text: "Error codes" },
      {
        kind: "prose",
        text: "Codes are part of the public contract and are not renamed once released. Switch on `error.code`, not on the message or the status.",
      },
      {
        kind: "table",
        head: ["Code", "HTTP", "When"],
        rows: [
          ["`UNAUTHENTICATED`", "401", "No key, or a key that does not parse."],
          ["`INVALID_API_KEY`", "401", "The key is not recognised."],
          ["`API_KEY_REVOKED`", "401", "The key existed and was revoked."],
          ["`PORTAL_LINK_EXPIRED`", "401", "A portal session has run out. Distinct so the portal can offer a fresh link."],
          ["`ENVIRONMENT_MISMATCH`", "403", "A test key reaching for live data, or the reverse."],
          ["`CROSS_TENANT_ACCESS`", "403", "The record exists but belongs to another organization."],
          ["`VALIDATION_ERROR`", "422", "The body failed schema validation. `details` says which field."],
          ["`INVALID_STATE_TRANSITION`", "409", "The subscription cannot move from where it is to where you asked."],
          ["`IDEMPOTENCY_KEY_REUSE`", "409", "Same key, different body."],
          ["`IDEMPOTENCY_REQUEST_IN_PROGRESS`", "409", "The first request with this key has not finished yet."],
          ["`INVOICE_ALREADY_PAID`", "409", "Nothing left to collect."],
          ["`PAYMENT_FAILED`", "402", "The provider declined. The attempt is recorded with its reason."],
          ["`NO_PAYMENT_METHOD`", "400", "Nothing on file to charge, and no checkout was requested."],
          ["`NO_ELIGIBLE_PAYMENT_PROVIDER`", "400", "No configured rail can take this currency or this call."],
          ["`UNSUPPORTED_PROVIDER_CAPABILITY`", "400", "The provider genuinely cannot do this. It is not attempted."],
          ["`PROVIDER_ERROR`", "502", "The provider failed in a way that is not a decline."],
          ["`NOT_IMPLEMENTED`", "501", "The feature is not built yet."],
        ],
      },
      {
        kind: "note",
        text: "`UNSUPPORTED_PROVIDER_CAPABILITY` and `NOT_IMPLEMENTED` exist so that nothing ever returns a plausible-looking success it did not perform. If you get one, the operation did not happen.",
      },
      { kind: "heading", text: "Listing and pagination" },
      {
        kind: "prose",
        text: "Every list endpoint takes `page`, `limit` and — where searching makes sense — `q`. Unparseable values fall back to the default rather than erroring, so a malformed `?page=abc` shows page one.",
      },
      {
        kind: "code",
        code: `GET /v1/customers?page=2&limit=25&q=benin

{
  "data": {
    "items": [ … ],
    "page": 2,
    "limit": 25,
    "total": 91,
    "totalPages": 4
  },
  "error": null,
  "requestId": "req_…"
}`,
      },
    ],
  },
  {
    slug: "idempotency",
    title: "Idempotency",
    summary: "How to retry a charge without charging twice.",
    blocks: [
      {
        kind: "prose",
        text: "Every call that can move money accepts an `Idempotency-Key` header. Send one, and a retry replays the original response instead of doing the work again.",
      },
      { kind: "code", code: `Idempotency-Key: sub_7f21c0` },
      {
        kind: "list",
        items: [
          "Same key, same body → the stored response is replayed. Nothing is charged twice.",
          "Same key, different body → `IDEMPOTENCY_KEY_REUSE`. The call is refused rather than quietly doing something else.",
          "Same key, first request still running → `IDEMPOTENCY_REQUEST_IN_PROGRESS`. Wait and retry.",
          "No key → the call is executed as sent. Use a key for anything that charges.",
        ],
      },
      {
        kind: "prose",
        text: "Keys are at most 255 characters and are scoped to your organization. Pick something derived from the thing you are creating — an order id, a subscription request id — rather than a random value you cannot regenerate after a timeout.",
      },
      { kind: "heading", text: "Where it also applies" },
      {
        kind: "prose",
        text: "Idempotency is not only a header. Applying a payment result is idempotent per attempt, so a webhook that arrives twice and a reconciliation that lands at the same moment cannot both credit the same invoice. Inbound provider webhooks are de-duplicated by the provider's own event id.",
      },
    ],
  },
  {
    slug: "money",
    title: "Money and intervals",
    summary: "Integers in minor units, and how a billing period is described.",
    blocks: [
      { kind: "heading", text: "Amounts are integers" },
      {
        kind: "prose",
        text: "Every amount in the API is an integer in the currency's smallest unit, and the number of minor units is stored per currency. Nothing in the billing path does decimal arithmetic on money.",
      },
      {
        kind: "table",
        head: ["Value", "Currency", "Means"],
        rows: [
          ["`500000`", "NGN", "₦5,000.00"],
          ["`2900`", "USD", "US$29.00"],
          ["`1`", "NGN", "one kobo"],
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text: "Never send a float. `10000.50` is not a valid amount; the value you want is `1000050`.",
      },
      { kind: "heading", text: "Intervals" },
      {
        kind: "prose",
        text: "A billing interval is a unit and a count — `{ \"unit\": \"MONTH\", \"count\": 1 }` for monthly, `{ \"unit\": \"DAY\", \"count\": 90 }` for every ninety days. Units are `DAY`, `WEEK`, `MONTH` and `YEAR`.",
      },
      { kind: "heading", text: "Month ends" },
      {
        kind: "prose",
        text: "A subscription created on the 31st keeps the 31st as its anchor and is clamped to the last day of shorter months. It bills on 28 February and is back on the 31st in March — it does not drift to the 28th forever, which is the bug every hand-rolled version of this has.",
      },
      { kind: "heading", text: "Multi-currency" },
      {
        kind: "prose",
        text: "One plan can carry prices in several currencies. Totals are never summed across currencies — the dashboard reports each one separately, because a number that adds naira to dollars does not mean anything.",
      },
    ],
  },
];

const core: DocPage[] = [
  {
    slug: "customers",
    title: "Customers",
    summary: "Who you bill, keyed by your own id.",
    blocks: [
      {
        kind: "prose",
        text: "A customer is your record, mirrored. Give it your own `externalId` and you never have to store one of ours — every endpoint that takes a customer accepts either.",
      },
      { kind: "endpoint", method: "POST", path: "/v1/customers" },
      { kind: "endpoint", method: "GET", path: "/v1/customers", summary: "Paginated. `q` searches name, email and external id." },
      { kind: "endpoint", method: "GET", path: "/v1/customers/:customerId" },
      { kind: "endpoint", method: "PATCH", path: "/v1/customers/:customerId" },
      { kind: "endpoint", method: "DELETE", path: "/v1/customers/:customerId" },
      {
        kind: "params",
        title: "Body",
        rows: [
          { name: "externalId", type: "string", note: "Your id for this customer. Unique within your organization." },
          { name: "email", type: "string", required: true, note: "Where billing email goes." },
          { name: "name", type: "string", note: "Shown in the dashboard and on invoices." },
          { name: "phone", type: "string", note: "Optional." },
          { name: "currency", type: "string(3)", note: "Default currency for this customer." },
          { name: "country", type: "string(2)", note: "ISO code. Used for provider routing." },
          { name: "metadata", type: "object", note: "Anything you want to carry along." },
        ],
      },
      {
        kind: "code",
        code: `POST /v1/customers

{
  "externalId": "user_83921",
  "email": "ada@example.com",
  "name": "Ada Okafor",
  "country": "NG"
}`,
      },
      {
        kind: "note",
        text: "You rarely need this endpoint on its own. `POST /v1/subscriptions` takes an inline `customer` object and resolves or creates it for you, under the same idempotency key.",
      },
    ],
  },
  {
    slug: "plans-and-prices",
    title: "Plans and prices",
    summary: "What you sell, what it costs, and what happens when that changes.",
    blocks: [
      {
        kind: "prose",
        text: "A plan is the product. A price is one way to buy it — and one plan can carry several: monthly, annual, a second currency, a per-seat rate. Your application only ever refers to a price code.",
      },
      { kind: "endpoint", method: "GET", path: "/v1/plans" },
      { kind: "endpoint", method: "POST", path: "/v1/plans" },
      { kind: "endpoint", method: "GET", path: "/v1/plans/:planId" },
      { kind: "endpoint", method: "PATCH", path: "/v1/plans/:planId" },
      { kind: "endpoint", method: "GET", path: "/v1/prices" },
      { kind: "endpoint", method: "POST", path: "/v1/prices" },
      { kind: "endpoint", method: "GET", path: "/v1/prices/:priceId" },
      { kind: "endpoint", method: "PATCH", path: "/v1/prices/:priceId" },
      { kind: "heading", text: "Editing a price" },
      {
        kind: "prose",
        text: "This is the part worth reading carefully, because it is where a careless billing system quietly reprices people who never agreed to it.",
      },
      {
        kind: "prose",
        text: "Some fields save in place. Others are **economic** — the amount, the currency, the interval, the metering — and editing one of those does not overwrite anything. A new version of the price is published and the old one is archived, so everybody currently paying the old amount keeps paying it until their period ends.",
      },
      {
        kind: "table",
        head: ["Field", "Behaviour"],
        rows: [
          ["`nickname`, `active`, `trialDays`, `metadata`", "Saved in place. No new version."],
          ["`amount`, `currency`, `interval`, `usageMeterId`, tiers", "Publishes a new version and archives this one."],
        ],
      },
      { kind: "heading", text: "What subscribers do" },
      {
        kind: "list",
        items: [
          "Nobody is charged a new amount in the middle of a period they already paid for.",
          "At their next renewal, a subscription rolls forward to the current version of its price automatically.",
          "Roll-forward only happens when the currency and the interval match. A price that changed from monthly to annual is a plan change, not a version bump, and nobody is moved silently.",
          "A subscription can be pinned to hold it where it is — for the customer you promised a rate to.",
        ],
      },
      { kind: "endpoint", method: "POST", path: "/v1/subscriptions/:subscriptionId/pin-price", summary: "Hold this subscriber on their current price version." },
    ],
  },
  {
    slug: "subscriptions",
    title: "Subscriptions",
    summary: "The lifecycle, the states, and every way to change one.",
    blocks: [
      { kind: "endpoint", method: "POST", path: "/v1/subscriptions", summary: "Create, invoice and collect in one call." },
      { kind: "endpoint", method: "GET", path: "/v1/subscriptions", summary: "Filter with `status`, search with `q`." },
      { kind: "endpoint", method: "GET", path: "/v1/subscriptions/:subscriptionId" },
      { kind: "endpoint", method: "GET", path: "/v1/subscriptions/:subscriptionId/transitions", summary: "Every status change, with the reason it happened." },
      { kind: "endpoint", method: "POST", path: "/v1/subscriptions/:subscriptionId/change-plan", summary: "Upgrade or downgrade, with proration." },
      { kind: "endpoint", method: "POST", path: "/v1/subscriptions/:subscriptionId/quantity", summary: "Change seats, prorated." },
      { kind: "endpoint", method: "POST", path: "/v1/subscriptions/:subscriptionId/pause" },
      { kind: "endpoint", method: "POST", path: "/v1/subscriptions/:subscriptionId/resume" },
      { kind: "endpoint", method: "POST", path: "/v1/subscriptions/:subscriptionId/cancel", summary: "Now, or at the end of the period." },
      { kind: "endpoint", method: "POST", path: "/v1/subscriptions/:subscriptionId/renew", summary: "Force the next period. The worker does this on schedule." },
      {
        kind: "params",
        title: "Create body",
        rows: [
          { name: "customerId", type: "string", note: "Either this or `customer`." },
          { name: "customer", type: "object", note: "Inline customer; resolved or created." },
          { name: "priceId", type: "string", required: true, note: "The price code they are buying." },
          { name: "quantity", type: "integer", note: "Seats. Defaults to 1." },
          { name: "trialDays", type: "integer", note: "0–365. Starts the subscription as `TRIALING`." },
          { name: "paymentMethodId", type: "string", note: "Charge a specific stored card." },
          { name: "collectPayment", type: "boolean", note: "Set false to open the invoice without collecting." },
          { name: "callbackUrl", type: "string", note: "Where hosted checkout returns the customer." },
          { name: "metadata", type: "object", note: "Anything you want to carry along." },
        ],
      },
      { kind: "heading", text: "States" },
      {
        kind: "table",
        head: ["Status", "Means"],
        rows: [
          ["`INCOMPLETE`", "Created, first invoice open, never yet paid. Not the same as lapsed."],
          ["`TRIALING`", "Inside a trial. Nothing has been charged yet."],
          ["`ACTIVE`", "Paid and current."],
          ["`PAST_DUE`", "A payment failed. The retry ladder is running."],
          ["`GRACE_PERIOD`", "Still failing, still inside the window you configured."],
          ["`PAUSED`", "Deliberately suspended. No billing, no expiry."],
          ["`UNPAID`", "Retries and grace are spent, and your policy said mark unpaid."],
          ["`CANCELED`", "Ended by you or by the customer."],
          ["`EXPIRED`", "Reached its natural end."],
        ],
      },
      {
        kind: "note",
        text: "Every transition is written with its reason and is readable on the transitions endpoint. There is one writer of `subscription.status` in the codebase, so a state you see is a state something explicitly decided to set.",
      },
      { kind: "heading", text: "Changing plan" },
      {
        kind: "prose",
        text: "`change-plan` prices the unused remainder of the current period against the new price and returns the net amount, which may be a charge or a credit. An upgrade collects the difference immediately; a downgrade credits it against the next invoice.",
      },
    ],
  },
  {
    slug: "invoices",
    title: "Invoices",
    summary: "What is owed, what was paid, and every attempt in between.",
    blocks: [
      { kind: "endpoint", method: "GET", path: "/v1/invoices", summary: "Filter with `status`." },
      { kind: "endpoint", method: "GET", path: "/v1/invoices/:invoiceId", summary: "Includes line items and every payment attempt." },
      { kind: "endpoint", method: "POST", path: "/v1/invoices/:invoiceId/pay", summary: "Attempt collection now." },
      { kind: "endpoint", method: "POST", path: "/v1/invoices/:invoiceId/void" },
      {
        kind: "table",
        head: ["Status", "Means"],
        rows: [
          ["`DRAFT`", "Being assembled. Not yet owed."],
          ["`OPEN`", "Issued and owed."],
          ["`PAID`", "Settled in full."],
          ["`VOID`", "Cancelled. Never collectable."],
          ["`UNCOLLECTIBLE`", "Written off after recovery failed."],
        ],
      },
      { kind: "heading", text: "Numbering" },
      {
        kind: "prose",
        text: "Invoice numbers are sequential per organization per year — `INV-2026-00066` — and are allocated from a counter, not derived from a row id, so there are no gaps to explain to an auditor.",
      },
      { kind: "heading", text: "Line items" },
      {
        kind: "prose",
        text: "An invoice carries typed lines: the subscription itself, proration credits and charges, metered overage, and coupon discounts once coupons exist. Totals handle negative lines, so a discount appears as its own line rather than quietly reducing the subtotal.",
      },
    ],
  },
  {
    slug: "payments",
    title: "Payments and providers",
    summary: "Attempts, stored methods, routing, and what happens when a webhook never comes.",
    blocks: [
      { kind: "endpoint", method: "GET", path: "/v1/payment-attempts", summary: "Every attempt, with its failure reason." },
      { kind: "endpoint", method: "POST", path: "/v1/payment-attempts/:attemptId/sync", summary: "Ask the provider what really happened." },
      { kind: "endpoint", method: "GET", path: "/v1/payment-methods" },
      { kind: "endpoint", method: "DELETE", path: "/v1/payment-methods/:paymentMethodId" },
      { kind: "endpoint", method: "GET", path: "/v1/payment-providers" },
      { kind: "endpoint", method: "POST", path: "/v1/payment-providers", summary: "Configure a rail. Credentials are encrypted at rest." },
      { kind: "endpoint", method: "PATCH", path: "/v1/payment-providers/:configId" },
      { kind: "endpoint", method: "POST", path: "/v1/payment-providers/:configId/test", summary: "Check the credentials without moving money." },
      { kind: "endpoint", method: "DELETE", path: "/v1/payment-providers/:configId" },
      { kind: "heading", text: "Attempts" },
      {
        kind: "prose",
        text: "One invoice can carry many attempts, numbered. Each records the provider, the amount, the outcome and whatever the provider actually said. That is what makes the retry ladder debuggable, and what lets it decide a particular decline is not worth trying again.",
      },
      {
        kind: "table",
        head: ["Classification", "Means"],
        rows: [
          ["`RETRYABLE`", "Insufficient funds, a generic decline, an issuer timeout. Waiting might work."],
          ["`REQUIRES_ACTION`", "Expired card, invalid card, bad CVV. Waiting will never work — the customer is asked for a different card and the ladder stops."],
          ["`UNKNOWN`", "The provider said nothing useful. Treated as retryable."],
        ],
      },
      { kind: "heading", text: "Reconciliation" },
      {
        kind: "prose",
        text: "Some providers send no webhook at all for a decline. Attempts left pending are reconciled directly against the provider on a schedule, so the invoice ends up reflecting what really happened rather than what was announced.",
      },
      { kind: "heading", text: "Routing" },
      {
        kind: "prose",
        text: "When more than one rail is configured, the engine picks by a score: a provider pinned to the subscription wins, then the one that last succeeded for this customer, then the default, then priority order. An unhealthy provider is pushed down. The mock rail is never chosen as a fallback when a real one exists.",
      },
      {
        kind: "note",
        tone: "warn",
        text: "Card data never touches this system. Only provider-issued references are stored — an authorization code, a last four, an expiry. There is nowhere in the schema to put a PAN.",
      },
    ],
  },
];

const metering: DocPage[] = [
  {
    slug: "entitlements",
    title: "Entitlements",
    summary: "One question your application asks, and a straight answer with a reason.",
    blocks: [
      { kind: "endpoint", method: "POST", path: "/v1/entitlements/check", summary: "Can this customer do this?" },
      { kind: "endpoint", method: "POST", path: "/v1/entitlements/check/batch", summary: "Several features in one call." },
      { kind: "endpoint", method: "GET", path: "/v1/entitlements", summary: "Explicit overrides on record." },
      { kind: "endpoint", method: "POST", path: "/v1/entitlements", summary: "Grant an exception to one customer or one subscription." },
      { kind: "endpoint", method: "DELETE", path: "/v1/entitlements/:entitlementId" },
      { kind: "heading", text: "How an answer is resolved" },
      {
        kind: "prose",
        text: "Most entitlements need no rows at all — a plan's feature flags describe what it includes. A number becomes a limit, `\"unlimited\"` removes the ceiling, a boolean toggles the feature.",
      },
      {
        kind: "prose",
        text: "An explicit entitlement is an exception for one customer or one subscription, and the most specific rule wins: a customer override beats a subscription entitlement, which beats a plan entitlement, which beats the plan's own feature flags. That is the case that breaks every home-made version of this: the one company you granted something to by hand.",
      },
      {
        kind: "code",
        code: `POST /v1/entitlements/check

{ "customerId": "user_83921", "featureKey": "export_pdf" }

{
  "data": {
    "access": false,
    "remainingQuota": null,
    "reason": "FEATURE_DISABLED"
  },
  "error": null,
  "requestId": "req_…"
}`,
      },
      {
        kind: "note",
        text: "The answer accounts for subscription state. A customer inside a grace period is answered according to the access level your grace policy had when they lapsed — not the one you configured afterwards.",
      },
      { kind: "heading", text: "Setting feature flags on a plan" },
      {
        kind: "prose",
        text: "The dashboard's Feature flags field on a plan is plain text, one flag per line — not JSON. Each line is typed by what it looks like, the same rule the resolver above applies:",
      },
      {
        kind: "code",
        code: `api_access
seats=10
projects=unlimited
exports=false
support=priority`,
      },
      {
        kind: "table",
        head: ["Line", "Stored as", "Becomes"],
        rows: [
          ["`api_access`", "`true`", "`BOOLEAN`, granted"],
          ["`exports=false`", "`false`", "`BOOLEAN`, denied"],
          ["`seats=10`", "`10`", "`LIMIT` — a ceiling. See the note below."],
          ["`projects=unlimited`", "`\"unlimited\"`", "`UNLIMITED` — no ceiling"],
          ["`support=priority`", "`\"priority\"`", "`BOOLEAN`, granted — the string itself is not evaluated"],
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text: "A string value that isn't \"unlimited\" becomes a granted boolean — the value is a label, not a gate. Checking `support` on a plan with `support=priority` and one with `support=community` both return `access: true`; neither response tells you which string it was. If your code needs to branch on the tier, give each tier its own boolean line (`priority_support`) instead of encoding it as a value your application has to string-compare.",
      },
      {
        kind: "note",
        tone: "warn",
        text: "A LIMIT flag like `seats=10` is a ceiling your application counts against, not a meter Tierstack tracks. A check against it always reports `used: 0` unless the same feature key is also wired to a usage meter through an explicit entitlement — otherwise, query your own database for the current count and compare it to `limit` yourself.",
      },
      {
        kind: "note",
        text: "Feature flags are not versioned the way prices are. Editing a plan's flags changes what every subscriber on that plan is entitled to immediately — there is no grandfathering. To change flags for new signups only, publish a new plan rather than editing the one existing customers are on.",
      },
    ],
  },
  {
    slug: "usage",
    title: "Usage metering",
    summary: "Record events, define allowances, bill the overage.",
    blocks: [
      { kind: "endpoint", method: "GET", path: "/v1/usage-meters" },
      { kind: "endpoint", method: "POST", path: "/v1/usage-meters" },
      { kind: "endpoint", method: "POST", path: "/v1/events/track", summary: "Record one event." },
      { kind: "endpoint", method: "POST", path: "/v1/events/track/batch", summary: "Record many." },
      { kind: "endpoint", method: "GET", path: "/v1/usage", summary: "Current period totals for a customer." },
      { kind: "endpoint", method: "GET", path: "/v1/usage/events", summary: "The raw events behind a total." },
      { kind: "heading", text: "Meters" },
      {
        kind: "prose",
        text: "A meter decides how its events are added up: `SUM`, `MAX`, `LAST` or `UNIQUE_COUNT`. Give it a code your application can hard-code — `API_CALLS`, `AI_TOKENS` — and a unit label for display.",
      },
      { kind: "heading", text: "Recording usage" },
      {
        kind: "code",
        code: `POST /v1/events/track

{
  "customerId": "user_83921",
  "meter": "AI_TOKENS",
  "units": 18500,
  "eventId": "req_2026_08_27_0001"
}`,
      },
      {
        kind: "note",
        text: "`eventId` is your own id for the event and is what makes tracking safe to retry. Send the same one twice and it is counted once.",
      },
      { kind: "heading", text: "How it reaches the bill" },
      {
        kind: "prose",
        text: "A price can include an allowance and a rate past it. The total is worked out at the moment the invoice is built, from the events themselves — there is no running counter anywhere that can drift away from what the customer is charged. Overage is billed in arrears, on the invoice that opens the next period.",
      },
    ],
  },
];

const customerFacing: DocPage[] = [
  {
    slug: "customer-portal",
    title: "Customer portal",
    summary: "A page your customers use to fix their own billing.",
    blocks: [
      {
        kind: "prose",
        text: "Mint a session for a customer and send them the URL. They can pay what is outstanding, swap a card, read past invoices and cancel — with no password and no account to recover.",
      },
      { kind: "endpoint", method: "POST", path: "/v1/portal-sessions", summary: "Returns a one-time URL and an expiry." },
      { kind: "endpoint", method: "POST", path: "/v1/portal-sessions/:sessionId/revoke" },
      {
        kind: "code",
        code: `POST /v1/portal-sessions

{ "customerId": "cus_…" }

{
  "data": {
    "id": "ps_…",
    "url": "https://billing.example.com/s/95a2576b…",
    "expiresAt": "2026-09-03T15:22:42.702Z"
  },
  "error": null,
  "requestId": "req_…"
}`,
      },
      { kind: "heading", text: "The portal API" },
      {
        kind: "prose",
        text: "These are what the portal itself calls. They take a portal token, not an API key, and none of them takes a customer id — the customer is whoever the token belongs to. That separation runs both ways: an API key is rejected here, and a portal token is rejected everywhere else.",
      },
      { kind: "endpoint", method: "GET", path: "/portal/v1/overview" },
      { kind: "endpoint", method: "POST", path: "/portal/v1/invoices/:invoiceId/pay" },
      { kind: "endpoint", method: "POST", path: "/portal/v1/subscriptions/:subscriptionId/cancel" },
      { kind: "endpoint", method: "POST", path: "/portal/v1/subscriptions/:subscriptionId/resume" },
      {
        kind: "note",
        text: "Paying from the portal always opens a fresh checkout rather than re-charging the card that just failed. The whole reason the customer is there is that the stored card did not work.",
      },
    ],
  },
  {
    slug: "webhooks",
    title: "Webhooks",
    summary: "Provider events coming in, and your own application's events going out.",
    blocks: [
      { kind: "heading", text: "Events coming in, from a provider" },
      {
        kind: "prose",
        text: "Each provider posts to its own path. Point the provider's webhook configuration at the matching URL.",
      },
      {
        kind: "code",
        code: `POST https://your-api.example.com/webhooks/paystack
POST https://your-api.example.com/webhooks/mock`,
      },
      { kind: "endpoint", method: "GET", path: "/v1/webhook-events", summary: "Everything received, with the result of each signature check." },
      { kind: "heading", text: "What happens to one" },
      {
        kind: "list",
        items: [
          "The signature is verified. A failure is recorded and rejected, not processed.",
          "The event is de-duplicated by the provider's own event id.",
          "It is persisted before it is applied, so a crash mid-processing loses nothing.",
          "Applying a payment result is idempotent per attempt — a redelivery is acknowledged and ignored, never applied twice.",
        ],
      },
      { kind: "heading", text: "Events going out, to your own application" },
      {
        kind: "prose",
        text: "A small, curated set of lifecycle events — the ones almost every integration needs to react to, not a 1:1 mirror of every internal state transition.",
      },
      {
        kind: "table",
        head: ["Event", "Fires when"],
        rows: [
          ["`subscription.created`", "A subscription is created — trialing or owing its first invoice."],
          ["`subscription.activated`", "A subscription's first payment (or a renewal after lapsing) settles."],
          ["`subscription.canceled`", "A subscription actually reaches `CANCELED` — immediately, or at the end of a scheduled period."],
          ["`invoice.paid`", "An invoice is fully paid."],
          ["`invoice.payment_failed`", "A payment attempt on an invoice fails, on the first attempt or any retry."],
        ],
      },
      { kind: "endpoint", method: "POST", path: "/v1/webhook-endpoints", summary: "Register a URL. The signing secret is returned once." },
      { kind: "endpoint", method: "GET", path: "/v1/webhook-endpoints" },
      { kind: "endpoint", method: "PATCH", path: "/v1/webhook-endpoints/:endpointId", summary: "Change the URL, or disable it." },
      { kind: "endpoint", method: "DELETE", path: "/v1/webhook-endpoints/:endpointId" },
      { kind: "endpoint", method: "GET", path: "/v1/webhook-deliveries", summary: "The delivery log — filter with `endpointId` or `status`." },
      { kind: "endpoint", method: "POST", path: "/v1/webhook-deliveries/:deliveryId/resend", summary: "Retry now, including one that already gave up." },
      { kind: "heading", text: "Verifying a delivery" },
      {
        kind: "prose",
        text: "Every delivery carries `Tierstack-Signature` and `Tierstack-Timestamp` headers — an HMAC-SHA256 of `${timestamp}.${body}`, keyed with the secret returned when the endpoint was created. This is the exact scheme this platform uses to verify a provider's own webhooks; verify a delivery from it the same way.",
      },
      {
        kind: "code",
        code: `const expected = createHmac("sha256", secret)
  .update(\`\${timestamp}.\${rawBody}\`)
  .digest("hex");

if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
  return res.status(400).send("invalid signature");
}`,
      },
      {
        kind: "note",
        text: "The secret is shown exactly once, in the response to creating the endpoint — only its ciphertext is ever stored. Losing it means registering a new endpoint, the same as a lost API key.",
      },
      { kind: "heading", text: "Delivery and retries" },
      {
        kind: "list",
        items: [
          "The first attempt happens within about a minute of the event — this is a polling worker, not an instant push.",
          "A failed attempt (a non-2xx response, a timeout, an unreachable host) retries at 1 min, 5 min, 30 min, 2 hours, then 6 hours — five attempts in total before the delivery is marked FAILED.",
          "A FAILED delivery is not permanent — POST to its resend endpoint to try again immediately.",
          "Endpoints are not yet scoped to test versus live mode — a registered endpoint receives events from both. Filter on your side if that matters to you today.",
        ],
      },
    ],
  },
  {
    slug: "testing",
    title: "Testing",
    summary: "The mock rail, and how to force a decline.",
    blocks: [
      {
        kind: "prose",
        text: "Test mode runs the entire lifecycle with no provider account and no real card: a plan, a subscription, an invoice, a card that fails, a retry ladder, a recovery.",
      },
      { kind: "heading", text: "Forcing an outcome" },
      {
        kind: "prose",
        text: "On the mock rail, `metadata.mockOutcome` decides what the provider does.",
      },
      {
        kind: "code",
        code: `POST /v1/subscriptions

{
  "customer": { "email": "test@example.com" },
  "priceId": "pro_monthly_ngn",
  "metadata": { "mockOutcome": "FAILED" }
}`,
      },
      {
        kind: "table",
        head: ["`mockOutcome`", "Result"],
        rows: [
          ["`SUCCESS`", "Charged, invoice paid, subscription active."],
          ["`FAILED`", "Declined with a simulated reason. The retry ladder starts."],
          ["omitted", "Hosted checkout, which you can complete by hand."],
        ],
      },
      { kind: "heading", text: "Hosted checkout" },
      {
        kind: "prose",
        text: "With no outcome forced, the mock rail returns a checkout URL that renders a real form. Completing it posts back like a provider would, which is the path worth exercising before you switch a real rail on.",
      },
      { kind: "endpoint", method: "GET", path: "/mock/checkout/:reference" },
      { kind: "endpoint", method: "POST", path: "/mock/checkout/:reference/complete" },
      {
        kind: "note",
        text: "Test and live data never mix. A test key cannot see a live subscription, and a live key cannot see a test one.",
      },
    ],
  },
];

export const DOC_GROUPS: DocGroup[] = [
  { title: "Getting started", pages: gettingStarted },
  { title: "Core", pages: core },
  { title: "Metering", pages: metering },
  { title: "Customer-facing", pages: customerFacing },
];

export const ALL_PAGES: DocPage[] = DOC_GROUPS.flatMap((group) => group.pages);

export function findPage(slug: string): DocPage | undefined {
  return ALL_PAGES.find((page) => page.slug === slug);
}

/** Previous and next in reading order, for the footer links. */
export function neighbours(slug: string): { previous?: DocPage; next?: DocPage } {
  const index = ALL_PAGES.findIndex((page) => page.slug === slug);
  if (index < 0) return {};
  return { previous: ALL_PAGES[index - 1], next: ALL_PAGES[index + 1] };
}
