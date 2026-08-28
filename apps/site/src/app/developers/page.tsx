import type { Metadata } from "next";
import { BRAND } from "@/brand";
import { LifecycleArt } from "@/components/art/lifecycle";
import { StatesArt } from "@/components/art/states";
import { Reveal } from "@/components/reveal";
import { Shot } from "@/components/shot";
import { Band, ClosingCta, PageHero, Statement } from "@/components/ui";

export const metadata: Metadata = {
  title: "Developers",
  description:
    "One HTTP API for the billing lifecycle: subscriptions, invoices, payment attempts, entitlements and usage. Idempotent, integer money, real subscription states, and no faked provider capabilities.",
};

const SAMPLE = "Real dashboard, test mode, sample data";

export default function Developers() {
  return (
    <>
      <PageHero
        eyebrow="For developers"
        title="One billing API. Less billing code."
        lede={`Your application should not need to understand a payment provider's behaviour. Create the customer, create the price, create the subscription — ${BRAND.name} runs the rest of the lifecycle.`}
      />

      {/* -- The call ------------------------------------------------------- */}
      <Band>
        <Reveal>
          <div className="overflow-x-auto rounded-xl bg-ink p-7 text-paper">
            <pre className="font-mono text-[13px] leading-relaxed">
              <code>
                <span className="text-accent">POST</span> /v1/subscriptions{"\n"}
                <span className="text-paper/45">Authorization: Bearer sk_test_…</span>
                {"\n"}
                <span className="text-paper/45">Idempotency-Key: sub_7f21c0</span>
                {"\n\n"}
                {"{\n"}
                {'  "customer": {\n'}
                {'    "externalId": '}
                <span className="text-[#8FD3B8]">&quot;user_83921&quot;</span>
                {",\n"}
                {'    "email": '}
                <span className="text-[#8FD3B8]">&quot;customer@example.com&quot;</span>
                {",\n"}
                {'    "name": '}
                <span className="text-[#8FD3B8]">&quot;Customer&quot;</span>
                {"\n  },\n"}
                {'  "priceId": '}
                <span className="text-[#8FD3B8]">&quot;pro_monthly_ngn&quot;</span>
                {"\n}"}
              </code>
            </pre>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <p className="mt-8 max-w-readable text-lg leading-relaxed text-muted">
            That resolves or creates the customer, opens the subscription, issues the first invoice
            and starts collection — under one idempotency key. Everything after it happens without
            another call from you.
          </p>
          <div className="mt-12 overflow-x-auto">
            <LifecycleArt className="w-full min-w-[560px]" />
          </div>
        </Reveal>
      </Band>

      {/* -- States ---------------------------------------------------------- */}
      <Band tone="raised">
        <Reveal>
          <h2 className="max-w-readable text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Billing has states. Your application should not have to invent them.
          </h2>
          <p className="mt-5 max-w-readable text-lg leading-relaxed text-muted">
            Subscriptions change state, invoices change state, and one invoice can carry many payment
            attempts. Past due, inside a grace period, recovered and gone are four different things,
            and an application that models only paid and cancelled has nowhere to put three of them.
          </p>
        </Reveal>

        <Reveal delay={120}>
          <div className="mt-12 overflow-x-auto rounded-xl border border-line bg-white/50 p-7">
            <StatesArt className="w-full min-w-[620px]" />
          </div>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            These are the values the API returns, not a simplified version
          </p>
        </Reveal>
      </Band>

      {/* -- Attempts --------------------------------------------------------- */}
      <Band>
        <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
          <Reveal>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
              Payment attempts
            </p>
            <h2 className="mt-5 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Every attempt is a row, with the reason it failed.
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="max-w-readable text-lg leading-relaxed text-muted">
              One invoice can carry many attempts, numbered, each against a named provider and each
              keeping whatever the provider actually said. That is what makes the retry ladder
              debuggable — and what lets it decide that a particular decline is not worth trying
              again.
            </p>
          </Reveal>
        </div>

        <Reveal delay={160} className="mt-12">
          <Shot
            src="/product/attempts.webp"
            alt="One invoice: its line items and totals, the customer and subscription it belongs to, and three numbered payment attempts against the same provider, each failed, each keeping the reason the provider gave."
            width={1992}
            height={1164}
            caption={SAMPLE}
          />
        </Reveal>
      </Band>

      {/* -- How it behaves ---------------------------------------------------- */}
      <Band tone="raised">
        <Reveal>
          <h2 className="max-w-readable text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            How it behaves when things go wrong.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-x-12 gap-y-10 sm:grid-cols-2">
          {[
            {
              title: "Money is never a float",
              body: "Amounts are integers in the currency's smallest unit, with the number of minor units stored per currency. Nothing in the billing path does decimal arithmetic on money.",
            },
            {
              title: "Every money-moving call is idempotent",
              body: "Send an Idempotency-Key and a retry replays the original response rather than charging twice. Reusing a key with a different body is rejected instead of quietly doing something else.",
            },
            {
              title: "Duplicate webhooks are processed once",
              body: "Inbound provider webhooks are signature-verified, then de-duplicated by the provider's own event id, so a redelivery is acknowledged without being applied again.",
            },
            {
              title: "A missing webhook is not a lost payment",
              body: "Some declines produce no webhook at all. Attempts left pending are reconciled directly against the provider on a schedule, so the invoice reflects what really happened.",
            },
            {
              title: "Unsupported is an error, not a stub",
              body: "Ask a provider adapter for something it cannot do and you get UNSUPPORTED_PROVIDER_CAPABILITY or NOT_IMPLEMENTED. Nothing returns a plausible-looking success it did not perform.",
            },
            {
              title: "Test and live are separate",
              body: "Keys, provider credentials and data are scoped to an environment. Test mode runs the full lifecycle — subscription, invoice, a decline, a recovery — with no provider account and no real card.",
            },
          ].map((item, index) => (
            <Reveal key={item.title} delay={index * 60}>
              <div className="border-t border-line pt-5">
                <h3 className="font-semibold tracking-tight">{item.title}</h3>
                <p className="mt-2 max-w-readable leading-relaxed text-muted">{item.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Band>

      {/* -- AI builders --------------------------------------------------------- */}
      <Band tone="ink">
        <div className="grid gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          <Reveal>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
              Built for the AI building era
            </p>
            <h2 className="mt-5 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Let AI build your product. Don&apos;t make it build your billing infrastructure.
            </h2>
            <div className="mt-6 max-w-readable space-y-4 text-lg leading-relaxed text-paper/70">
              <p>
                A coding assistant will happily produce two thousand lines of subscription logic. It
                will look right. The parts that are wrong — the double charge on a retry, the anchor
                that slips a day every month, the webhook applied twice — surface in month three,
                with real money attached.
              </p>
              <p className="text-paper">Give it one API to call instead of a subsystem to invent.</p>
            </div>
            <div className="mt-8">
              <Statement>
                Your AI-built app calls {BRAND.name}. {BRAND.name} handles the billing.
              </Statement>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-1">
              {[
                "Plans and prices",
                "Subscriptions and renewals",
                "Invoices",
                "Failed-payment recovery",
                "Grace periods",
                "Usage-based billing",
                "Entitlement checks",
                "Customer billing portal",
              ].map((item) => (
                <li key={item} className="border-b border-paper/15 py-2.5 text-[15px] leading-relaxed">
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </Band>

      <ClosingCta
        title="Take one payment and see."
        body="Test mode runs the whole lifecycle — a plan, a subscription, an invoice, a card that fails and then recovers — without a provider account or a real card."
        secondary={{ href: "/status", label: "What's built today" }}
      />
    </>
  );
}
