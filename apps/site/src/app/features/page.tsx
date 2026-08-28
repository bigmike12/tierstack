import type { Metadata } from "next";
import { BRAND } from "@/brand";
import { Reveal } from "@/components/reveal";
import { Shot } from "@/components/shot";
import { Band, ClosingCta, PageHero, Statement } from "@/components/ui";
import { CAPABILITIES } from "@/content";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Plans and pricing, subscriptions, payments, revenue recovery, usage billing and the customer portal — everything Tierstack handles after the payment goes through, shown in the real product.",
};

const SAMPLE = "Real dashboard, test mode, sample data";

/**
 * Six things the product does, each one shown doing it.
 *
 * The images alternate between full width and a column beside the text, which
 * is a legibility decision rather than a rhythm one: a capture of a whole page
 * is unreadable at half width, and a capture of a single card looks lost at
 * full width. Whichever way round it goes, the screenshot is a real capture at
 * roughly its native size, because an illegible screenshot is decoration.
 */
export default function Features() {
  return (
    <>
      <PageHero
        eyebrow="Features"
        title="Everything that happens after “payment successful”."
        lede="Taking a payment is one moment. Running a subscription business is the six things below — every month, for every customer, for as long as they stay."
      />

      {/* -- 01 Recurring billing --------------------------------------------- */}
      <Band>
        <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
          <Reveal>
            <p className="font-mono text-[11px] tracking-[0.18em] text-accent">01</p>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Plans and prices live here, not in your code.
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="max-w-readable text-lg leading-relaxed text-muted">
              A plan is the product; a price is one way to buy it, and one plan can carry several —
              monthly, annual, a second currency, a per-seat rate. Define them once and your
              application only ever refers to a price code.
            </p>
          </Reveal>
        </div>

        <Reveal delay={160} className="mt-12">
          <Shot
            src="/product/plans.webp"
            alt="The plans screen: a Starter plan with monthly naira and dollar prices, and a Pro plan with monthly, annual and dollar prices, each showing its price code, model, amount and billing interval."
            width={1992}
            height={1172}
            caption={SAMPLE}
          />
        </Reveal>
      </Band>

      {/* -- 02 Revenue recovery ----------------------------------------------- */}
      <Band tone="ink">
        <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
          <Reveal>
            <p className="font-mono text-[11px] tracking-[0.18em] text-accent">02</p>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              A failed payment gets a second chance, and a third.
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <div className="max-w-readable space-y-4 text-lg leading-relaxed text-paper/70">
              <p>
                Set how long somebody keeps access after a payment fails and how often to try again.
                Each attempt emails the customer a link to fix it themselves.
              </p>
              <p className="text-paper">
                When the card is one that waiting cannot fix — expired, withdrawn, barred from online
                use — it stops and asks for a different one instead of spending the rest of the
                ladder on a card that is dead.
              </p>
            </div>
          </Reveal>
        </div>

        <Reveal delay={160} className="mt-12">
          <Shot
            src="/product/recovery.webp"
            alt="The recovery screen: three customers in a grace period, the configured seven-day grace period and the retry schedule of immediately, day 1, day 3 and day 5, and what happens when the retries run out."
            width={1992}
            height={1396}
            caption={SAMPLE}
          />
        </Reveal>
      </Band>

      {/* -- 03 Pricing changes ------------------------------------------------ */}
      <Band tone="raised">
        <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
          <Reveal>
            <p className="font-mono text-[11px] tracking-[0.18em] text-accent">03</p>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Change what you charge without shipping your product.
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="max-w-readable text-lg leading-relaxed text-muted">
              Change a price and a new version publishes while the old one is kept for the people on
              it. Nobody is charged a new amount in the middle of a month they already paid for —
              they move across at their next renewal. And if you promised one customer a rate
              forever, pin them and they stay there.
            </p>
          </Reveal>
        </div>

        <Reveal delay={160} className="mt-12">
          <Shot
            src="/product/subscription.webp"
            alt="One subscription: its plan, price code, amount and interval, the grace period it is currently in, whether it follows the current price version or is pinned, and its invoices."
            width={1992}
            height={1524}
            caption={SAMPLE}
          />
        </Reveal>
      </Band>

      {/* -- 04 and 05, the two that fit beside their text ---------------------- */}
      <Band>
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          <Reveal>
            <p className="font-mono text-[11px] tracking-[0.18em] text-accent">04</p>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Charge for what people actually use.
            </h2>
            <p className="mt-6 max-w-readable text-lg leading-relaxed text-muted">
              An allowance, then a rate past it. Counted from the events your application already
              sends and totalled when the invoice is built, so the number on the bill is the number
              that happened. Billed in arrears, on the invoice that opens the next period.
            </p>
          </Reveal>
          <Reveal delay={140}>
            <Shot
              src="/product/usage.webp"
              alt="A customer who has used 161,600 tokens of a 100,000 allowance, with the overage in blocks and its cost."
              width={1072}
              height={596}
              caption={SAMPLE}
            />
          </Reveal>
        </div>
      </Band>

      <Band tone="raised">
        <div className="grid items-center gap-14 lg:grid-cols-[0.95fr_1.05fr]">
          <Reveal>
            <p className="font-mono text-[11px] tracking-[0.18em] text-accent">05</p>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Customers fix their own billing.
            </h2>
            <p className="mt-6 max-w-readable text-lg leading-relaxed text-muted">
              Pay what is outstanding, swap a card, read past invoices, cancel. Every billing email
              carries a link straight into it — no password, no account to recover, no support
              ticket to open a conversation you could have avoided.
            </p>
            <p className="mt-4 max-w-readable text-lg leading-relaxed text-ink">
              Your team builds the product. {BRAND.name} handles the billing experience.
            </p>
          </Reveal>
          <Reveal delay={140}>
            <Shot
              src="/product/portal.webp"
              alt="The customer billing portal: an outstanding invoice with a Pay now button, the subscription and when access ends, and a note that they can pay with a different card."
              width={1310}
              height={1010}
              caption="Real customer portal, test mode"
            />
          </Reveal>
        </div>
      </Band>

      {/* -- 06 Entitlements ---------------------------------------------------- */}
      <Band>
        <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
          <Reveal>
            <p className="font-mono text-[11px] tracking-[0.18em] text-accent">06</p>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              One question, one answer: can this customer do this?
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="max-w-readable text-lg leading-relaxed text-muted">
              Your plans say what is included; your application asks and gets a straight answer, with
              the reason attached. That includes the exception you granted one company by hand, which
              is the case that breaks every home-made version of this.
            </p>
          </Reveal>
        </div>

        <Reveal delay={160} className="mt-12">
          <Shot
            src="/product/entitlements.webp"
            alt="Entitlements resolved for one customer: each feature, whether it is allowed or denied, how much of the allowance is left, and why — turned off on this plan, or granted by a plan feature flag."
            width={1992}
            height={900}
            caption={SAMPLE}
          />
        </Reveal>
      </Band>

      {/* -- What you see ------------------------------------------------------- */}
      <Band tone="ink">
        <div className="grid gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          <Reveal>
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              See your billing business, not just your transactions.
            </h2>
            <p className="mt-6 max-w-readable text-lg leading-relaxed text-paper/70">
              A payment dashboard tells you what was charged yesterday. Yours has to answer harder
              questions than that — and answer them about your plans, not your provider&apos;s
              transaction list.
            </p>
            <div className="mt-8">
              <Statement>Payment providers move money. {BRAND.name} runs the billing.</Statement>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              {[
                "Monthly recurring revenue",
                "Active subscriptions",
                "Revenue collected",
                "Payment success rate",
                "Outstanding invoices",
                "Customers",
                "Payment attempts",
                "Grace periods",
                "Dunning",
                "Subscription states",
              ].map((item) => (
                <li key={item} className="border-b border-paper/15 py-2.5 text-[15px] leading-relaxed">
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </Band>

      {/* -- The full grid ------------------------------------------------------- */}
      <Band tone="raised">
        <Reveal>
          <h2 className="max-w-readable text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            The whole surface, in one list.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((capability, index) => (
            <Reveal key={capability.group} delay={index * 60}>
              <div className="border-t border-line pt-5">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
                  {capability.group}
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed">{capability.line}</p>
                <ul className="mt-4 space-y-1.5 leading-relaxed text-muted">
                  {capability.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </Band>

      <ClosingCta secondary={{ href: "/status", label: "What's built today" }} />
    </>
  );
}
