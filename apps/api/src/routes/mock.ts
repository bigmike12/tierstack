import { instantiateProvider, applyPaymentResult } from "@billing-platform/billing";
import type { PrismaClient } from "@billing-platform/database";
import { MockPaymentProvider, RedisMockStore } from "@billing-platform/payments-mock";
import { BillingError, formatMoney, money, assertCurrency, success } from "@billing-platform/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../env";
import type { RedisClient } from "../lib/redis";

const completeSchema = z.object({
  outcome: z.enum(["SUCCESS", "FAILED", "PENDING", "EXPIRED"]).default("SUCCESS"),
});

/**
 * The local stand-in for a provider's hosted checkout page. It is served by the
 * API itself so `npm run dev` gives a developer a complete, clickable payment
 * flow with no provider account and no credentials.
 */
export function registerMockRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  config: AppConfig,
  redis: RedisClient
): void {
  const store = new RedisMockStore(redis);

  async function providerFor(organizationId: string): Promise<MockPaymentProvider> {
    const stored = await prisma.paymentProviderConfig.findFirst({
      where: { organizationId, provider: "MOCK" },
    });
    if (!stored) {
      throw new BillingError(
        "PROVIDER_CONFIG_NOT_FOUND",
        "This organization has no MOCK provider configured."
      );
    }
    return instantiateProvider(
      {
        id: stored.id,
        organizationId,
        provider: "MOCK",
        environment: stored.environment as "TEST" | "LIVE",
        encryptedCredentials: stored.encryptedCredentials,
        enabled: stored.enabled,
        isDefault: stored.isDefault,
        priority: stored.priority,
        routingRules: stored.routingRules,
      },
      { redis, checkoutBaseUrl: config.API_URL, encryptionKey: config.ENCRYPTION_KEY }
    ) as MockPaymentProvider;
  }

  app.get("/mock/checkout/:reference", async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const txn = await store.get(reference);
    if (!txn) {
      return reply.status(404).type("text/html").send(page("Unknown checkout", "<p>No such mock checkout.</p>"));
    }

    const amount = formatMoney(money(txn.amount, assertCurrency(txn.currency)));
    const body = `
      <dl>
        <dt>Amount</dt><dd class="amount">${amount}</dd>
        <dt>Reference</dt><dd><code>${escapeHtml(txn.reference)}</code></dd>
        <dt>Customer</dt><dd>${escapeHtml(txn.customerEmail)}</dd>
        <dt>Description</dt><dd>${escapeHtml(txn.description ?? "—")}</dd>
        <dt>Status</dt><dd><strong>${txn.status}</strong></dd>
      </dl>
      ${
        txn.status === "PENDING"
          ? `<form method="post" action="/mock/checkout/${encodeURIComponent(txn.reference)}/complete">
               <button name="outcome" value="SUCCESS" class="ok">Pay ${amount}</button>
               <button name="outcome" value="FAILED" class="fail">Simulate a decline</button>
             </form>`
          : `<p class="done">This checkout is settled. You can close the page.</p>`
      }
      <p class="note">This is a simulated payment page. No money moves and no card details are collected.</p>`;
    return reply.type("text/html").send(page("Complete your payment", body));
  });

  app.post("/mock/checkout/:reference/complete", async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const parsed = completeSchema.parse(request.body ?? {});

    const txn = await store.get(reference);
    if (!txn) throw BillingError.notFound("PAYMENT_ATTEMPT_NOT_FOUND", "Mock checkout");

    const provider = await providerFor(txn.organizationId);
    const { transaction } = await provider.completeCheckout(reference, parsed.outcome);

    // Confirm the outcome with the provider rather than trusting the click, and
    // route it through the same code path a real webhook would take.
    const verified = await provider.verifyPayment(reference);
    await applyPaymentResult(prisma, {
      organizationId: txn.organizationId,
      attemptId: reference,
      result: verified,
    });

    const wantsHtml = (request.headers.accept ?? "").includes("text/html");
    if (wantsHtml) {
      return reply
        .type("text/html")
        .send(
          page(
            transaction.status === "SUCCEEDED" ? "Payment complete" : "Payment declined",
            `<p class="done">Status: <strong>${transaction.status}</strong></p>
             <p class="note">You can close this page and return to the application.</p>`
          )
        );
    }
    return success({ status: transaction.status, reference }, request.requestId);
  });

  /** Lists simulated transactions so a developer can see what the rail did. */
  app.get("/v1/mock/transactions", async (request) => {
    const organizationId = request.organizationId;
    if (!organizationId) throw new BillingError("FORBIDDEN", "No organization in scope.");
    const provider = await providerFor(organizationId);
    return success(await provider.listTransactions(), request.requestId);
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
  );
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --fg:#101418; --card:#fff; --muted:#5b6470; --line:#e3e6ea; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0e1116; --fg:#e8eaed; --card:#161a21; --muted:#9aa4b2; --line:#252b34; } }
  body { margin:0; font:16px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--fg);
         display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; }
  main { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:28px; max-width:460px; width:100%; }
  h1 { font-size:1.25rem; margin:0 0 20px; }
  dl { display:grid; grid-template-columns:auto 1fr; gap:8px 16px; margin:0 0 24px; }
  dt { color:var(--muted); font-size:.875rem; }
  dd { margin:0; font-size:.875rem; word-break:break-all; }
  .amount { font-size:1.35rem; font-weight:600; }
  form { display:flex; flex-direction:column; gap:10px; }
  button { font:inherit; padding:11px 16px; border-radius:9px; border:1px solid transparent; cursor:pointer; }
  .ok { background:#1a7f4b; color:#fff; }
  .fail { background:transparent; color:var(--fg); border-color:var(--line); }
  .note { color:var(--muted); font-size:.8125rem; margin:20px 0 0; }
  .done { font-size:.9375rem; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.8125em; }
</style></head>
<body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}
