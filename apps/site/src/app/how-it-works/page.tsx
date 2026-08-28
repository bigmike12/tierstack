import type { Metadata } from "next";
import { BRAND } from "@/brand";
import { LadderArt } from "@/components/art/ladder";
import { LifecycleArt } from "@/components/art/lifecycle";
import { MeterArt } from "@/components/art/meter";
import { StackArt } from "@/components/art/stack";
import { Reveal } from "@/components/reveal";
import { Band, ClosingCta, PageHero, Statement } from "@/components/ui";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Where Tierstack sits between your product and Paystack, and what it does on its own — explained without jargon.",
};

/**
 * The page for someone who is not going to read /developers.
 *
 * Every section answers "and then what happens?" in the order a real business
 * hits those questions. No endpoints, no state names, no acronyms — the four
 * diagrams do the structural work and the prose stays at the level of a
 * conversation with a founder.
 */
export default function HowItWorks() {
  return (
    <>
      <PageHero
        eyebrow="How it works"
        title="Where Tierstack sits, and what it does while you are asleep."
        lede="No code on this page. If you can describe what you sell and how often you charge for it, you can follow all of this."
      />

      {/* -- The three layers ---------------------------------------------- */}
      <Band>
        <div className="grid items-start gap-14 lg:grid-cols-[0.85fr_1.15fr]">
          <Reveal>
            <StackArt className="mx-auto w-full max-w-[340px]" />
          </Reveal>

          <Reveal delay={120}>
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Three layers, and only the middle one is new.
            </h2>
            <ol className="mt-8 space-y-7">
              {[
                {
                  n: "1",
                  title: "Your product",
                  body: "The thing your customers actually signed up for. It keeps doing what it does. It just asks one question when it needs to: is this customer allowed to do this?",
                },
                {
                  n: "2",
                  title: BRAND.name,
                  body: "Who is on which plan. What they owe. When they get charged next. What happened last time you tried. It decides all of that and then tells the payment provider what to collect.",
                },
                {
                  n: "3",
                  title: "Your payment provider",
                  body: "Paystack, or whichever rail you already use. It moves money between a card and your bank account. That is all it does, and all it is for.",
                },
              ].map((layer) => (
                <li key={layer.n} className="flex gap-5">
                  <span className="mt-1 font-mono text-[11px] tracking-[0.18em] text-accent">{layer.n}</span>
                  <div>
                    <h3 className="text-lg font-semibold tracking-tight">{layer.title}</h3>
                    <p className="mt-2 max-w-readable leading-relaxed text-muted">{layer.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </Band>

      {/* -- Someone subscribes --------------------------------------------- */}
      <Band tone="raised">
        <Reveal>
          <h2 className="max-w-readable text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            What happens when somebody subscribes.
          </h2>
          <p className="mt-5 max-w-readable text-lg leading-relaxed text-muted">
            Your product does the first step. Everything after it happens on its own, for as long as
            that customer stays.
          </p>
        </Reveal>

        <Reveal delay={100}>
          <div className="mt-12 overflow-x-auto">
            <LifecycleArt className="w-full min-w-[560px]" />
          </div>
        </Reveal>

        <div className="mt-12 grid gap-x-12 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: "You say who and what",
              body: "A customer, and the plan they picked. One message from your product, and that is the last thing you have to do.",
            },
            {
              title: "The bill is drawn up",
              body: "The right amount, in the right currency, for the right stretch of time — including the awkward cases, like somebody who joins on the 31st.",
            },
            {
              title: "The money is collected",
              body: "Through your payment provider. If they have a card saved, nobody needs to be at their desk for it to work.",
            },
            {
              title: "They get access",
              body: "Your product asks what this customer is allowed to do and gets a straight answer, including any exception you made for them by hand.",
            },
            {
              title: "It happens again next period",
              body: "Same day next month, or next year, or every ninety days. Nobody schedules it and nobody remembers it.",
            },
            {
              title: "You see all of it",
              body: "Revenue, active subscriptions, who is behind on payment, and what was tried. In your dashboard, not your provider's.",
            },
          ].map((step, index) => (
            <Reveal key={step.title} delay={index * 60}>
              <div className="border-t border-line pt-5">
                <h3 className="font-semibold tracking-tight">{step.title}</h3>
                <p className="mt-2 leading-relaxed text-muted">{step.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Band>

      {/* -- A card fails ----------------------------------------------------- */}
      <Band tone="ink">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          <Reveal>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
              When a payment fails
            </p>
            <h2 className="mt-5 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              A declined card is usually not somebody leaving.
            </h2>
            <div className="mt-6 max-w-readable space-y-4 text-lg leading-relaxed text-paper/70">
              <p>
                It is a spending limit that resets tomorrow, a bank blocking a first online charge, or
                a card that was reissued last week. Ask again in two days and a good share of them go
                through.
              </p>
              <p>
                So {BRAND.name} asks again — on a schedule you set — and emails the customer a link to
                pay with a different card. You decide how long they keep access while that is going
                on.
              </p>
              <p className="text-paper">
                And when the card is one that waiting will never fix, it stops and asks for a new one,
                rather than emailing somebody four more times about a card that is dead.
              </p>
            </div>
            <div className="mt-8">
              <Statement>Recover the payment before you lose the customer.</Statement>
            </div>
          </Reveal>

          <Reveal delay={140}>
            <div className="rounded-xl border border-paper/15 p-8">
              <LadderArt className="w-full" />
            </div>
          </Reveal>
        </div>
      </Band>

      {/* -- Prices and usage --------------------------------------------------- */}
      <Band>
        <div className="grid gap-16 lg:grid-cols-2">
          <Reveal>
            <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              What happens when you put your prices up.
            </h2>
            <div className="mt-5 max-w-readable space-y-4 leading-relaxed text-muted">
              <p>
                You change the price. A new version is published and the old one is kept, because
                people are still on it.
              </p>
              <p className="text-ink">
                Nobody is charged the new amount in the middle of a month they already paid for.
                Everyone moves to it at their next renewal — and if you promised somebody the old
                price forever, you can hold them there.
              </p>
              <p>
                None of that involves your engineers, and none of it involves shipping a new version
                of your product.
              </p>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              What happens when you charge for usage.
            </h2>
            <p className="mt-5 max-w-readable leading-relaxed text-muted">
              Some plans include an allowance — a number of requests, seats, messages, gigabytes —
              and charge a rate past it. The counting comes from your product&apos;s own events, and
              the total is worked out when the bill is drawn up, so there is no separate running
              tally to disagree with the invoice.
            </p>
            <MeterArt className="mt-8 w-full" />
          </Reveal>
        </div>
      </Band>

      <ClosingCta
        title="That is the whole idea."
        body={`Your payment provider moves the money. ${BRAND.name} decides who owes what, collects it, and chases it when it fails.`}
        secondary={{ href: "/features", label: "See everything it does" }}
      />
    </>
  );
}
