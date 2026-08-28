import Link from "next/link";
import { BRAND } from "@/brand";
import { StackArt } from "@/components/art/stack";
import { Reveal } from "@/components/reveal";
import { Shot } from "@/components/shot";
import { Band, PrimaryLink, SecondaryLink, Statement } from "@/components/ui";
import { BILLING_WORK } from "@/content";

/**
 * The homepage, built on the rhythm Recurly uses: a claim, then the product;
 * three short value props; then alternating rows where a sentence sits beside
 * a picture of the thing actually doing it.
 *
 * Two deliberate departures from that reference. Recurly opens on a logo
 * carousel and spends roughly two of every five sections on social proof —
 * customer counts, renewal-event totals, four named case studies. There are no
 * customers here yet, and inventing the shape of proof without the substance
 * is the fastest way to lose a developer's trust. Those slots carry the
 * product itself instead: real captures of the real dashboard and the real
 * customer portal, running against a real database, captioned as sampled data.
 *
 * The second departure is the palette. Recurly is white, blue and rounded
 * cards, which is what this whole category looks like; the ground stays
 * off-white and monochrome with one warm accent, so the page is recognisably
 * not the same page as everybody else's.
 */
const SAMPLE = "Real dashboard, test mode, sample data";

export default function Home() {
  return (
    <>
      {/* -- Hero ---------------------------------------------------------- */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-16 pt-14 sm:pt-20">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
            Billing infrastructure for African software
          </p>
          <h1 className="mt-5 max-w-4xl text-balance text-[2.6rem] font-semibold leading-[1.03] tracking-tightest sm:text-[3.6rem]">
            Your payment provider moves the money. {BRAND.name} runs the billing.
          </h1>
          <p className="mt-6 max-w-readable text-lg leading-relaxed text-muted">
            Paystack can charge a card. It cannot decide who to charge, how much, or when — and it
            does nothing at all when the card fails. {BRAND.name} does all of that, and keeps the
            record of who owes you what.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <PrimaryLink />
            <SecondaryLink href="/how-it-works">See how it works</SecondaryLink>
          </div>
          <p className="mt-4 text-sm text-muted">Keep your payment provider. Add a billing layer.</p>
        </Reveal>

        <Reveal delay={160} className="mt-14">
          <Shot
            src="/product/dashboard.webp"
            alt="The Tierstack dashboard: monthly recurring revenue, active subscriptions, revenue collected, payment success rate, customers in a grace period, and the most recent subscriptions and invoices."
            width={2300}
            height={1689}
            caption={SAMPLE}
            priority
          />
        </Reveal>
      </section>

      {/* -- Where it sits -------------------------------------------------- */}
      <Band tone="raised">
        <div className="grid items-center gap-14 lg:grid-cols-[1.15fr_0.85fr]">
          <Reveal>
            <h2 className="max-w-readable text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              A payment gateway is not a billing system.
            </h2>
            <p className="mt-6 max-w-readable text-lg leading-relaxed text-muted">
              A gateway takes one payment, once. Everything that decides whether there should be a
              payment at all — who is on which plan, what they owe this month, whether they are still
              allowed in, what happens when the card fails — has to live somewhere. Usually that
              somewhere is code your team writes and then maintains forever.
            </p>
            <p className="mt-4 max-w-readable text-lg leading-relaxed text-ink">
              {BRAND.name} is that layer, so it is not a folder in your codebase.
            </p>
            <p className="mt-7 text-[15px]">
              <Link href="/how-it-works" className="border-b border-line text-ink hover:border-ink">
                The whole thing explained without jargon
              </Link>
            </p>
          </Reveal>

          <Reveal delay={140}>
            <StackArt className="mx-auto w-full max-w-[330px]" />
          </Reveal>
        </div>
      </Band>

      {/* -- Three things --------------------------------------------------- */}
      <Band>
        <div className="grid gap-x-12 gap-y-10 md:grid-cols-3">
          {[
            {
              title: "Bill on a schedule, without anyone remembering to",
              body: "Plans, prices, intervals and renewals. It opens each period, draws up the bill and collects it — including the awkward cases, like a customer who signed up on the 31st.",
              href: "/features",
              cta: "See what it handles",
            },
            {
              title: "Recover the payments that fail",
              body: "Set a grace period and a retry schedule. Each attempt emails the customer a link to fix it. When a card cannot be fixed by waiting, it stops and asks for a different one.",
              href: "/how-it-works",
              cta: "How recovery works",
            },
            {
              title: "Change what you charge without shipping code",
              body: "Prices live in the billing layer. Change one and a new version publishes; everyone already subscribed moves across at their next renewal, never mid-period.",
              href: "/features",
              cta: "Pricing and plans",
            },
          ].map((item, index) => (
            <Reveal key={item.title} delay={index * 80}>
              <div className="flex h-full flex-col border-t border-line pt-5">
                <h3 className="text-xl font-semibold tracking-tight">{item.title}</h3>
                <p className="mt-3 flex-1 leading-relaxed text-muted">{item.body}</p>
                <p className="mt-5 text-[15px]">
                  <Link href={item.href} className="border-b border-line text-ink hover:border-ink">
                    {item.cta}
                  </Link>
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </Band>

      {/* -- Subscriptions -------------------------------------------------- */}
      <Band tone="raised">
        <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
          <Reveal>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
              Subscriptions
            </p>
            <h2 className="mt-5 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Every state, not just paid and failed.
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="max-w-readable text-lg leading-relaxed text-muted">
              Trialing, active, past due, in a grace period, recovered, gone. Those are six different
              things, and a customer in the fourth is not the same as a customer in the sixth.
              {" "}{BRAND.name} owns those transitions, records every one with its reason, and gives
              your application one straight answer when it asks what somebody may do.
            </p>
          </Reveal>
        </div>

        <Reveal delay={160} className="mt-12">
          <Shot
            src="/product/subscriptions.webp"
            alt="The subscriptions list: customer name and id, plan, amount, status and the date each period ends, filtered by status."
            width={1992}
            height={1432}
            caption={SAMPLE}
          />
        </Reveal>
      </Band>

      {/* -- Recovery -------------------------------------------------------- */}
      <Band tone="ink">
        <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
          <Reveal>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
              Failed payments
            </p>
            <h2 className="mt-5 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              A declined card is not a lost customer.
            </h2>
            <div className="mt-6 max-w-readable">
              <Statement>Recover the payment before you lose the customer.</Statement>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="max-w-readable space-y-4 text-lg leading-relaxed text-paper/70">
              <p>
                Cards expire, banks block first online charges, spending limits reset tomorrow. You
                decide how long somebody keeps access and how often to try again; every attempt
                emails them a link to pay with a different card.
              </p>
              <p className="text-paper">
                And when the card is one that waiting will never fix, it stops and asks for a new one
                rather than emailing four more times about a card that is dead.
              </p>
            </div>
          </Reveal>
        </div>

        <Reveal delay={160} className="mt-12">
          <Shot
            src="/product/recovery.webp"
            alt="The recovery screen: how many customers are in a grace period, the configured grace period and retry schedule, and the customers currently being retried with the date each grace period ends."
            width={1992}
            height={1396}
            caption={SAMPLE}
          />
        </Reveal>
      </Band>

      {/* -- Usage ------------------------------------------------------------ */}
      <Band>
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          <Reveal>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
              Usage billing
            </p>
            <h2 className="mt-5 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Charge for what customers actually use.
            </h2>
            <p className="mt-6 max-w-readable text-lg leading-relaxed text-muted">
              An allowance, then a rate past it. Consumption is counted from the events your
              application already sends and totalled when the invoice is built — so no running tally
              anywhere can drift away from what the customer is billed, and there is no argument at
              the end of the month about whose number is right.
            </p>
          </Reveal>

          <Reveal delay={140}>
            <Shot
              src="/product/usage.webp"
              alt="A customer who has used 161,600 tokens of a 100,000 allowance, with the overage worked out in blocks and priced."
              width={1072}
              height={596}
              caption={SAMPLE}
            />
          </Reveal>
        </div>
      </Band>

      {/* -- Portal ------------------------------------------------------------ */}
      <Band tone="raised">
        <div className="grid items-center gap-14 lg:grid-cols-[0.95fr_1.05fr]">
          <Reveal>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
              Customer portal
            </p>
            <h2 className="mt-5 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Don&rsquo;t build another billing page for your customers.
            </h2>
            <p className="mt-6 max-w-readable text-lg leading-relaxed text-muted">
              Your customers can pay what they owe, swap a card, read past invoices and cancel — on a
              page you did not build and do not support. Every billing email carries a link straight
              into it. No password, no account to recover, no ticket.
            </p>
            <p className="mt-4 max-w-readable text-lg leading-relaxed text-ink">
              Your team builds the product. {BRAND.name} handles the billing experience.
            </p>
          </Reveal>

          <Reveal delay={140}>
            <Shot
              src="/product/portal.webp"
              alt="The customer billing portal: an outstanding invoice with a Pay now button, the subscription and when access ends, the saved card, and the invoice history."
              width={1310}
              height={1010}
              caption="Real customer portal, test mode"
            />
          </Reveal>
        </div>
      </Band>

      {/* -- The comparison ----------------------------------------------------- */}
      <Band>
        <Reveal>
          <h2 className="max-w-readable text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            There are two ways to build subscriptions.
          </h2>
        </Reveal>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Reveal delay={80}>
            <div className="h-full rounded-xl border border-line p-7">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                Without {BRAND.name}
              </p>
              <div className="mt-6 space-y-1.5">
                <Row label="Your application" />
                <Arrow />
                <Row label="Paystack" />
              </div>
              <p className="mt-7 text-sm font-medium">Your team builds and maintains:</p>
              <Chips items={BILLING_WORK} tone="muted" />
              <p className="mt-6 border-t border-line pt-5 text-sm leading-relaxed text-muted">
                Then keeps all of it working, every time a provider changes something.
              </p>
            </div>
          </Reveal>

          <Reveal delay={160}>
            <div className="h-full rounded-xl border border-ink p-7">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
                With {BRAND.name}
              </p>
              <div className="mt-6 space-y-1.5">
                <Row label="Your application" />
                <Arrow />
                <Row label={BRAND.name} filled />
                <Arrow />
                <Row label="Paystack" />
              </div>
              <p className="mt-7 text-sm font-medium">{BRAND.name} handles:</p>
              <Chips items={BILLING_WORK} tone="ink" />
            </div>
          </Reveal>
        </div>
      </Band>

      {/* -- Ask ------------------------------------------------------------------ */}
      <section className="border-t border-line">
        <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
          <Reveal>
            <h2 className="max-w-readable text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Build your product. Let {BRAND.name} run the billing.
            </h2>
            <p className="mt-5 max-w-readable text-lg leading-relaxed text-muted">
              Test mode runs the whole lifecycle — a plan, a subscription, an invoice, a card that
              fails and then recovers — with no provider account and no real card. Built for
              engineers, founders and AI-assisted builders in Africa.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <PrimaryLink />
              <SecondaryLink href="/features">See everything it does</SecondaryLink>
            </div>
            <p className="mt-10 max-w-readable border-t border-line pt-6 text-[15px] leading-relaxed text-muted">
              Paystack is verified end to end. Monnify and Flutterwave are not written yet, and the
              client libraries do not exist.{" "}
              <Link href="/status" className="border-b border-line text-ink hover:border-ink">
                The full list of what is and is not built
              </Link>
              .
            </p>
          </Reveal>
        </div>
      </section>
    </>
  );
}

/** One layer in the little stacks inside the comparison cards. */
function Row({ label, filled = false }: { label: string; filled?: boolean }) {
  return (
    <div
      className={
        filled
          ? "rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-paper"
          : "rounded-md border border-line px-3.5 py-2 text-sm"
      }
    >
      {label}
    </div>
  );
}

function Arrow() {
  return (
    <div aria-hidden className="pl-3.5 font-mono text-[13px] leading-none text-muted">
      ↓
    </div>
  );
}

function Chips({ items, tone }: { items: string[]; tone: "muted" | "ink" }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className={
            tone === "ink"
              ? "rounded border border-ink px-2.5 py-1 text-[13px]"
              : "rounded border border-dashed border-line px-2.5 py-1 text-[13px] text-muted"
          }
        >
          {item}
        </span>
      ))}
    </div>
  );
}
