import type { Metadata } from "next";
import { BRAND } from "@/brand";
import { RailsArt } from "@/components/art/rails";
import { Reveal } from "@/components/reveal";
import { Band, ClosingCta, PageHero } from "@/components/ui";
import { NOT_YET, WORKING } from "@/content";

export const metadata: Metadata = {
  title: "What's built",
  description:
    "An honest list of what Tierstack does today and what it does not: Paystack is verified end to end, Monnify and Flutterwave are not written, and there are no client libraries yet.",
};

export default function Status() {
  return (
    <>
      <PageHero
        eyebrow="Product status"
        title="What works today, and what does not."
        lede="You are going to run your revenue through this. You should know exactly where the edge is before you start, rather than finding it by walking into it."
      />

      <Band>
        <div className="grid gap-12 sm:grid-cols-2">
          <Reveal>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-settled">Working</h2>
            <ul className="mt-5 space-y-3 leading-relaxed text-muted">
              {WORKING.map((item) => (
                <li key={item} className="flex gap-3">
                  <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-settled" />
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={120}>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Not yet</h2>
            <ul className="mt-5 space-y-3 leading-relaxed text-muted">
              {NOT_YET.map((item) => (
                <li key={item} className="flex gap-3">
                  <span
                    aria-hidden
                    className="mt-[9px] size-1.5 shrink-0 rounded-full border border-line bg-transparent"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </Band>

      <Band tone="raised">
        <div className="grid items-start gap-14 lg:grid-cols-[1.1fr_0.9fr]">
          <Reveal>
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Nothing on that list is pretending to work in the meantime.
            </h2>
            <div className="mt-6 max-w-readable space-y-4 text-lg leading-relaxed text-muted">
              <p>
                Ask {BRAND.name} for something a provider cannot do and it returns an error saying
                so. It does not return a plausible-looking success it did not perform, and it does
                not silently fall back to a different rail to make a call appear to work.
              </p>
              <p className="text-ink">
                A provider is only listed here once it has been run end to end against the live
                service: checkout, webhooks, a stored card, an unattended renewal, and a real decline
                recovered.
              </p>
              <p>
                {BRAND.name} is early. That is a reason to be told the truth about it, not a reason to
                be sold a longer list.
              </p>
            </div>
          </Reveal>

          <Reveal delay={140}>
            <RailsArt className="w-full" />
          </Reveal>
        </div>
      </Band>

      <ClosingCta
        title="Start in test mode. Nothing is at stake."
        body="The full lifecycle runs without a provider account and without a real card — so you can find out whether this fits your business before any money is involved."
        secondary={{ href: "/how-it-works", label: "How it works" }}
      />
    </>
  );
}
