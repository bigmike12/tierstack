# Tierbase

Billing, subscription and payment-orchestration infrastructure for African
software businesses. Tierbase is the **system of record** for the billing
lifecycle; Paystack, Monnify and Flutterwave are payment rails it drives, not
the source of truth for anything.

> **Branding.** The product is Tierbase, on `gettierbase.com`. The indirection
> is kept anyway: the display name, URLs and email sender are read from
> configuration (`packages/shared/src/config.ts`), never written into the
> engine, so a white-label deployment or a second domain stays an environment
> change. Packages are scoped `@tierbase/*`.

---

## What is built

This repository implements **steps 1–10 of the build order** plus the dashboard:
the billing core, the mock payment rail, usage metering, the entitlement engine,
and a working operator UI on top of them. It is a working system, not a scaffold — the flows below run end to end
against a real database.

| Area | Status |
| --- | --- |
| PostgreSQL schema, migrations, multi-tenancy | Complete |
| Dashboard auth, organizations, members, RBAC | Complete |
| API keys (`sk_`/`pk_`, hashed, revocable) | Complete |
| Organization billing settings and dunning policy | Complete |
| Plans and prices (flat, per-seat, multi-currency, every interval) | Complete |
| Customers, automatic resolution from an external id | Complete |
| Subscriptions, explicit state machine, plan/seat changes, proration | Complete |
| Invoices, line items, immutable payment attempts | Complete |
| Payment provider abstraction, capabilities, routing | Complete |
| Mock payment provider (checkout, tokenization, recurring, refunds, webhooks) | Complete |
| Webhook intake with signature verification and de-duplication | Complete |
| Idempotency on money-moving endpoints | Complete |
| Background worker (renewals, grace expiry, abandoned-checkout expiry, sweeps) | Complete |
| Audit logging, secret redaction, tenant isolation | Complete |
| Usage metering: meters, idempotent ingestion, aggregation, quota and overage | Complete |
| Entitlement engine: boolean, limit, unlimited and usage features, Redis fast path | Complete |
| Metered billing: `USAGE_METERED` and `HYBRID` prices bill consumption in arrears | Complete |
| Dashboard: auth, section-57 navigation, and every page with an API behind it | Complete |
| Paginated, searchable list endpoints and dashboard tables | Complete |
| Plan and price creation, editing and archiving from the dashboard | Complete |
| Paystack adapter: checkout, verification, recurring charge, refunds, payment pages, signed webhooks | Implemented; **not yet exercised against live Paystack** |

**Deliberately not built yet** — and, importantly, not faked:

| Area | Behaviour today |
| --- | --- |
| Monnify / Flutterwave adapters | A configuration can be stored, but instantiating the adapter returns `NOT_IMPLEMENTED` and its capabilities report as `null`. |
| Paystack against the real API | The adapter is written and unit-tested against a recorded transport. It has **not** been run against api.paystack.co — that needs a test-mode secret key and a live transaction, which this build has never had. Treat the first real checkout as the verification step. |
| Paystack direct debit | Mandate creation is not implemented, so the adapter reports `directDebit: false` and the engine never routes to it. |
| Automated dunning retries (phase 4) | Grace periods open and close on the developer's configured policy; the *scheduled* retry ladder is not yet wired. Retry today is `POST /v1/invoices/:id/pay`. |
| Customer portal, TypeScript/React SDKs, `/llms.txt` (phase 5) | Not present. The API they would sit on is. |
| Coupons, referrals, credit ledger (phase 6) | Schema exists; no engine. |

Any capability a provider does not have returns `UNSUPPORTED_PROVIDER_CAPABILITY`.
Nothing pretends to work.

---

## Quick start

Requires Node 20+, Docker (or a local PostgreSQL 16 and Redis 7).

```bash
docker compose up -d     # PostgreSQL + Redis
npm install              # also writes .env with generated secrets
npm run db:reset         # migrate + seed
npm run demo:data        # optional: subscribers across every billing state
npm run dev              # API :4000 · dashboard :3000 · worker
```

Use `yarn`, `pnpm` or `bun` if you prefer — every script is package-manager
agnostic, and install records which one you chose (Turborepo needs to be told).

Install creates `.env` from `.env.example` and generates a real
`SESSION_SECRET` and `ENCRYPTION_KEY`; it never touches an existing `.env`, and
it is skipped in CI and production. **Back up `ENCRYPTION_KEY`** — it seals
stored payment-provider credentials, so changing it later makes them
undecryptable.

`npm run dev` starts all three. To run them separately: `npm run dev:api`,
`npm run dev:dashboard`, `npm run dev:worker`.

The seed prints dashboard credentials — sign in at <http://localhost:8181>.

`npm run db:seed` also prints a `sk_test_...` key once. Then:

```bash
curl -s http://localhost:4000/v1/plans -H "Authorization: Bearer sk_test_..."
```

### Verify the whole thing

```bash
npm test        # 139 unit tests: money, intervals, proration, state machine,
                # grace policy, routing, capabilities, mock rail, idempotency,
                # usage aggregation, quota, entitlement resolution, env loading
npm run e2e     # 136 end-to-end checks against real PostgreSQL + Redis
```

`npm run e2e` walks the complete lifecycle: create an organization, configure a
grace period, issue an API key, build a catalogue, auto-create a customer,
subscribe, generate an invoice, pay it through the mock hosted checkout, store
the payment method, renew on the stored method, upgrade with proration, change
seats, take a declined payment into the grace period, recover it, process a
signed webhook (and ignore its replay), expire an abandoned checkout, meter a
customer's consumption to the point of overage and see it land on the next
invoice, and prove another tenant can see none of it.

---

## The dashboard

`apps/dashboard` is a Next.js App Router application. All data is fetched
server-side with the session cookie forwarded to the API, so no secret ever
reaches the browser and there is no CORS credential dance. Mutations are server
actions.

The navigation is the full list from section 57. Sections whose engine exists are
live; the four whose engine does not — Usage, Entitlements, Coupons, Referrals —
say so plainly and name the phase, rather than rendering an empty table that
reads as "no data yet".

| Page | What it does |
| --- | --- |
| Overview | MRR, active subscriptions, revenue, payment success rate, outstanding, grace-period count, new customers, churn — computed straight from PostgreSQL, per currency |
| Customers | List and detail: identity, subscriptions, invoices, stored payment methods |
| Plans | Every plan with its prices, model, amount and interval |
| Subscriptions | Filterable list; detail shows billing, customer, invoices and the full transition history |
| Invoices | Filterable list; detail shows line items, totals and every payment attempt |
| Payments | Every attempt in order, with failure codes |
| Dunning | Your configured policy, who is in a grace period, and what happens when it ends |
| Payment Providers | Configure and test rails; capabilities come from the adapter itself |
| API Keys | Create (shown once), list, revoke |
| Webhooks | Endpoint URLs and the received-event log with signature status |
| Settings | Billing policy, organization, team |

There is no marketing site yet — this is the operator dashboard. The public
`gettierbase.com` site is separate work.

---

## Architecture

```
Developer application
        │  REST API / API key
        ▼
┌───────────────────────┐
│      Billing API      │  Fastify, Zod, idempotency, RBAC, rate limiting
└───────────┬───────────┘
            │
   ┌────────┴────────┐
   ▼                 ▼
Billing engine   Payment router
   │                 │
   ▼                 ▼
PostgreSQL       Provider adapters ──► Paystack · Monnify · Flutterwave · Mock
(source of truth)
```

### Packages

| Path | What lives there |
| --- | --- |
| `packages/shared` | Money (integer minor units, BigInt scaling), currency table, billing intervals, error codes, response envelope, redaction, id generation, branding config |
| `packages/database` | Prisma client wrapper and generated types |
| `packages/billing` | Pricing, proration, invoice engine, subscription state machine, customer resolution, payment orchestration, grace-period policy, provider registry |
| `packages/usage` | Meters, idempotent event ingestion, aggregation, quota and overage arithmetic |
| `packages/entitlements` | Feature resolution, the Redis fast path, and cache invalidation |
| `packages/payments/core` | `PaymentProvider` interface, capability model, credential encryption, payment router |
| `packages/payments/mock` | A complete simulated rail: hosted checkout, tokenization, recurring charges, declines, refunds, signed webhooks |
| `apps/api` | HTTP surface, authentication, tenancy, idempotency, mock checkout page, webhook intake |
| `apps/dashboard` | Next.js App Router operator UI: auth, the section-57 navigation, and a page per capability |
| `workers/billing-worker` | Renewals, grace expiry, idempotency and session sweeps (BullMQ) |

---

## Design decisions worth knowing

**Money is never a float.** Amounts are integers in the currency's smallest
unit, always paired with a currency code. Proration and percentage maths run in
`BigInt` and round explicitly. `packages/shared/src/money.test.ts` covers the
cases where naive arithmetic loses a kobo.

**The platform owns the billing schedule.** Intervals are stored canonically as
`{unit, count}`, so `BI_WEEKLY`, `QUARTERLY` and `CUSTOM_DAYS: 90` are the same
mechanism. No provider is asked whether it supports an interval; the engine
drives the cycle and asks a provider only to move money on a given day. Month-end
anchors clamp (Jan 31 → Feb 28) and then return to the anchor day (→ Mar 31).

**Status only ever changes through the state machine.** `applyTransition` is the
single writer of `subscription.status`; it validates the move against an explicit
table and appends a `SubscriptionTransition` row with the reason. Nothing else in
the codebase assigns a status.

**Grace periods come from the developer, not from us.** There is no default
baked into the engine. When a payment fails, the organization's current policy is
read *and frozen onto the subscription*, so changing settings later cannot
retroactively shorten or extend a grace period that is already running.

**A subscription that owes money is not ACTIVE, and one that has never paid is
not PAST_DUE either.** A new subscription starts `INCOMPLETE` (or `TRIALING`) and
reaches `ACTIVE` only when a payment settles. `INCOMPLETE` is deliberately
distinct from `PAST_DUE`: a customer who abandoned checkout has not lapsed, so
they get no grace period, no dunning ladder chasing a payment method they never
had, and no entitlements regardless of your grace-access policy. Abandoned
checkouts expire on a configurable window and their invoice is voided, so they
do not sit on the books as receivable.

**Usage is aggregated over the events, never from a counter.** Consumption is
computed with an indexed aggregate in PostgreSQL at read time. A materialised
per-period counter would be faster still, and it would be one more thing that
can silently drift away from the events it claims to summarise — and a drifted
counter is a wrong invoice you only discover when a customer disputes it. The
events *are* the financial record; the number is derived from them.

**Usage is billed in arrears, the base fee in advance.** You cannot invoice for
tokens before they are spent. A hybrid renewal invoice therefore carries next
period's base fee alongside last period's overage, and each line states the
window it covers. Overage is charged by whole priced blocks — 1,500 units
against a 1,000-unit block is two blocks — which is a pricing decision, so it
lives in one tested function rather than inside an invoice calculation.

**Entitlement definitions are cached; consumption never is.** Redis holds the
resolved plan, overrides and subscription status, which change rarely. Live
usage is read from PostgreSQL on every check, because a stale quota becomes a
wrong charge. Organization-wide invalidation bumps a version counter rather than
scanning keys, and every subscription status change in the system — from the
API, the worker or a webhook — invalidates through a single hook on
`applyTransition`, so a customer whose payment just cleared is never told no.

**Payment attempts are append-only.** Every retry writes a new row; nothing
overwrites a previous attempt. The attempt id doubles as the payment reference,
so a provider webhook resolves to exactly one attempt with no lookup table.

**Webhooks are verified, then re-verified.** The signature is checked against the
raw request bytes, the event is de-duplicated on
`(organizationId, provider, providerEventId)`, and then the engine asks the
provider what actually happened instead of believing the payload.

**Routing never invalidates a payment method.** When charging a stored token,
routing is pinned to the provider that issued it — a Paystack authorization means
nothing to Flutterwave, so failover is refused rather than attempted.

**Tenant isolation is structural.** Every business row carries `organizationId`.
API-key requests take their tenant from the key; dashboard sessions may name an
organization by header, but only to *select* among the caller's own memberships.
A cross-tenant read returns 404, never 403 — the API does not confirm that
another tenant's resource exists.

**Secrets never round-trip.** API keys are stored as SHA-256 with a short display
prefix and shown once. Provider credentials are sealed with AES-256-GCM, with the
organization id bound in as additional authenticated data, so a ciphertext copied
into another tenant's row fails to decrypt. Logs and audit metadata are passed
through a redactor.

---

## API surface

Every response uses the same envelope:

```json
{ "data": { }, "error": null, "requestId": "req_..." }
```

```
POST   /v1/auth/register            POST   /v1/plans
POST   /v1/auth/login               GET    /v1/plans
POST   /v1/auth/logout              GET    /v1/plans/:planIdOrCode
GET    /v1/auth/me                  PATCH  /v1/plans/:planIdOrCode

POST   /v1/organizations            POST   /v1/prices
GET    /v1/organizations            GET    /v1/prices
GET    /v1/organizations/current    GET    /v1/prices/:priceIdOrCode
GET    /v1/organizations/current/members
POST   /v1/organizations/current/members
PATCH  /v1/organizations/current/members/:memberId
DELETE /v1/organizations/current/members/:memberId

POST   /v1/api-keys                 POST   /v1/customers
GET    /v1/api-keys                 GET    /v1/customers
DELETE /v1/api-keys/:keyId          GET    /v1/customers/:idOrExternalId
                                    PATCH  /v1/customers/:idOrExternalId
GET    /v1/billing-settings         DELETE /v1/customers/:idOrExternalId
PUT    /v1/billing-settings
                                    GET    /v1/payment-methods
GET    /v1/payment-providers        DELETE /v1/payment-methods/:id
POST   /v1/payment-providers
PATCH  /v1/payment-providers/:id    POST   /v1/subscriptions
POST   /v1/payment-providers/:id/test    GET    /v1/subscriptions
DELETE /v1/payment-providers/:id    GET    /v1/subscriptions/:id
                                    POST   /v1/subscriptions/:id/change-plan
GET    /v1/invoices                 POST   /v1/subscriptions/:id/quantity
GET    /v1/invoices/:idOrNumber     POST   /v1/subscriptions/:id/cancel
POST   /v1/invoices/:id/pay         POST   /v1/subscriptions/:id/resume
POST   /v1/invoices/:id/void        POST   /v1/subscriptions/:id/pause
GET    /v1/payment-attempts         POST   /v1/subscriptions/:id/renew
                                    GET    /v1/subscriptions/:id/transitions

POST   /v1/events/track             POST   /v1/entitlements/check
POST   /v1/events/track/batch       POST   /v1/entitlements/check/batch
GET    /v1/usage                    GET    /v1/entitlements
GET    /v1/usage/events             POST   /v1/entitlements
GET    /v1/usage-meters             DELETE /v1/entitlements/:id
POST   /v1/usage-meters

GET    /v1/metrics/overview         GET    /v1/webhook-events

POST   /webhooks/{mock,paystack,monnify,flutterwave}
GET    /mock/checkout/:reference          (simulated hosted checkout page)
POST   /mock/checkout/:reference/complete
GET    /v1/mock/transactions
GET    /health
```

### The one call most developers need

```http
POST /v1/subscriptions
Authorization: Bearer sk_test_...
Idempotency-Key: sub_2026_08_21_user_83921
Content-Type: application/json

{
  "customer": { "externalId": "user_83921", "email": "customer@example.com", "name": "Jonathan" },
  "priceId": "pro_monthly_ngn"
}
```

The customer is created if it does not exist and reused if it does, the
subscription opens, an invoice is generated, and collection starts — all under
one idempotency key. The developer's own user id stays the join key; there is no
need to track a separate customer id.

### Idempotency

Send `Idempotency-Key` on any money-moving call. The same key with the same body
replays the stored response; the same key with a *different* body is rejected
with `IDEMPOTENCY_KEY_REUSE` rather than answered from cache.

### Testing payments locally

The mock rail reads `metadata.mockOutcome` — `SUCCESS`, `FAILED`, `PENDING` or
`EXPIRED` — so any outcome is reproducible without clicking through a page:

```json
{ "customer": { "email": "x@example.test" }, "priceId": "pro_monthly_ngn",
  "metadata": { "mockOutcome": "FAILED" } }
```

Without a directive, a checkout stays pending and can be completed at
`GET /mock/checkout/:reference`, which serves a real page with pay and decline
buttons. Tokens minted as `mock_pm_fail_*` decline on their *next* charge, which
is how the recovery path is exercised.

---

## Database

29 tables. `prisma/schema.prisma` is the source of truth and carries the
reasoning inline. Highlights: integer money columns paired with a currency,
`organizationId` on every business row, append-only `PaymentAttempt`,
`SubscriptionTransition`, `WebhookEvent`, `CreditLedgerEntry` and `AuditLog`, and
a per-organization-per-year invoice number counter.

### A note on the initial migration

`prisma/migrations/20260821000000_init/migration.sql` was authored as SQL rather
than by `prisma migrate dev`, because the sandbox this was built in could not
reach Prisma's engine CDN. It has been applied to a live PostgreSQL 16 instance
and exercised by the full test suite through the generated Prisma Client, so it
is known-good. If you would rather have Prisma author it, delete the migrations
directory and run `npx prisma migrate dev --name init` against an empty database.

The Prisma client is generated in its Rust-free configuration (`engineType =
"client"` with the `@prisma/adapter-pg` driver adapter), which also means
`npm install` never downloads a platform-specific engine binary.

---

## Repository layout

```
tierbase/
├── apps/
│   ├── api/                   Fastify HTTP API
│   └── dashboard/             Next.js operator UI
├── packages/
│   ├── shared/                money, intervals, errors, config, redaction
│   ├── database/              Prisma client wrapper
│   ├── billing/               the billing engine
│   └── payments/
│       ├── core/              provider interface, capabilities, router, crypto
│       └── mock/              complete simulated payment rail
├── workers/billing-worker/    renewals, grace expiry, sweeps
├── prisma/                    schema, migrations, seed
├── scripts/e2e.ts             end-to-end lifecycle suite
└── docker-compose.yml
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API, dashboard and worker together |
| `npm run dev:api` | API only, with reload |
| `npm run dev:dashboard` | Dashboard only |
| `npm run dev:worker` | Background worker only |
| `npm run db:deploy` | Apply migrations |
| `npm run db:migrate` | Create a migration from schema changes |
| `npm run setup` | Recreate `.env` and re-detect the package manager |
| `npm run db:seed` | Seed an organization, catalogue, mock provider, API key |
| `npm run demo:data` | Populate subscribers across every billing state |
| `npm run db:reset` | Drop, re-migrate, re-seed |
| `npm test` | Unit tests |
| `npm run e2e` | Full lifecycle against real infrastructure |
| `npm run typecheck` | `tsc` across the monorepo |

## Next steps

The build order continues at step 11. Recommended order, which deviates from the
spec in one place:

1. **Verify Paystack against the real API.** Put a test-mode secret key into
   the dashboard, run one checkout end to end, and point a Paystack test webhook
   at `/webhooks/paystack`. Everything below waits on what that turns up —
   recorded fixtures are not evidence that a live integration works.
2. **Step 11 — the scheduled retry ladder.** Dunning only earns its keep once
   real payments fail, so it is worth doing after a real rail is proven.
3. **Steps 16–20** — the customer portal, the SDKs, coupons and referrals.

Not in the specification but needed before launch: transactional email (dunning
that cannot tell a customer their card failed is decorative), a platform
back-office for Tierbase itself, and an NDPR/PCI scope review.
