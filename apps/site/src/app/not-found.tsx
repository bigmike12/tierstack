import Link from "next/link";
import { BRAND } from "@/brand";

/**
 * Without this file a mistyped URL lands on Next's unstyled default: no nav,
 * no footer, no way back. `/pricing` is the one people guess, and it does not
 * exist on purpose, so this page names that rather than shrugging.
 */
export default function NotFound() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-24 sm:py-32">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">404</p>
      <h1 className="mt-5 max-w-2xl text-balance text-[2.2rem] font-semibold leading-[1.06] tracking-tightest sm:text-[3rem]">
        There is nothing at this address.
      </h1>
      <p className="mt-6 max-w-readable text-lg leading-relaxed text-muted">
        Either the link is wrong, or it points at something that has not been built. Both happen;
        the second one is the whole reason this site has a page listing what does and does not
        exist.
      </p>

      <ul className="mt-12 max-w-2xl border-t border-line">
        {[
          { href: "/", title: "Home", note: `What ${BRAND.name} is, in one screen.` },
          { href: "/how-it-works", title: "How it works", note: "The same thing, without jargon." },
          { href: "/features", title: "Features", note: "Everything it handles." },
          { href: "/docs", title: "Documentation", note: "The API, endpoint by endpoint." },
          { href: "/status", title: "What's built", note: "And what is not. Including pricing." },
        ].map((item) => (
          <li key={item.href} className="border-b border-line">
            <Link
              href={item.href}
              className="grid gap-1 py-4 transition-opacity hover:opacity-70 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-8"
            >
              <span className="font-medium">{item.title}</span>
              <span className="text-[15px] leading-relaxed text-muted">{item.note}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
