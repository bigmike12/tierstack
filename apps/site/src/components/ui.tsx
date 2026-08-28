import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND } from "@/brand";
import { Reveal } from "@/components/reveal";

/** The top of every page except the homepage. One eyebrow, one claim, one line. */
export function PageHero({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede: string;
}) {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-4 pt-16 sm:pt-20">
      <Reveal>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">{eyebrow}</p>
        <h1 className="mt-5 max-w-3xl text-balance text-[2.2rem] font-semibold leading-[1.06] tracking-tightest sm:text-[3rem]">
          {title}
        </h1>
        <p className="mt-6 max-w-readable text-lg leading-relaxed text-muted">{lede}</p>
      </Reveal>
    </section>
  );
}

/** A full-width band. `tone` picks the three backgrounds the site uses. */
export function Band({
  children,
  tone = "paper",
  id,
  className = "",
}: {
  children: ReactNode;
  tone?: "paper" | "raised" | "ink";
  id?: string;
  className?: string;
}) {
  const shell =
    tone === "ink"
      ? "bg-ink text-paper"
      : tone === "raised"
        ? "border-y border-line bg-white/40"
        : "";

  return (
    <section id={id} className={`${shell} ${id ? "scroll-mt-20" : ""}`}>
      <div className={`mx-auto w-full max-w-6xl px-6 py-20 sm:py-24 ${className}`}>{children}</div>
    </section>
  );
}

/** One sentence, set large. Used sparingly — it stops meaning anything past twice a page. */
export function Statement({ children }: { children: ReactNode }) {
  return (
    <p className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{children}</p>
  );
}

export function PrimaryLink({ children = "Start building" }: { children?: ReactNode }) {
  return (
    <a
      href={`${BRAND.appUrl}/register`}
      className="rounded-md bg-ink px-6 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-88"
    >
      {children}
    </a>
  );
}

export function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  const className =
    "rounded-md border border-line px-6 py-3 text-sm font-medium transition-colors hover:border-ink";
  return href.startsWith("/") ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

/** The closing ask, identical on every page so it never needs a decision. */
export function ClosingCta({
  title = `Build your product. Let ${BRAND.name} run the billing.`,
  body = "Your payment provider moves the money. Tierstack manages everything around it.",
  secondary,
}: {
  title?: string;
  body?: string;
  secondary?: { href: string; label: string };
}) {
  const second = secondary ?? { href: "/docs", label: "Read the docs" };

  return (
    <section className="border-t border-line">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
        <Reveal>
          <h2 className="max-w-readable text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h2>
          <p className="mt-5 max-w-readable text-lg leading-relaxed text-muted">{body}</p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <PrimaryLink />
            <SecondaryLink href={second.href}>{second.label}</SecondaryLink>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
