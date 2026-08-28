import Link from "next/link";
import { BRAND } from "@/brand";
import { DOC_GROUPS } from "@/docs/content";

export default function DocsIndex() {
  return (
    <>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">Documentation</p>
      <h1 className="mt-5 max-w-2xl text-balance text-[2.1rem] font-semibold leading-[1.08] tracking-tightest sm:text-[2.7rem]">
        One HTTP API for the whole billing lifecycle.
      </h1>
      <p className="mt-6 max-w-readable text-lg leading-relaxed text-muted">
        No SDK to install and nothing to generate — {BRAND.name} is JSON over HTTP with one response
        envelope and stable error codes. If you can send a POST, you have everything you need.
      </p>

      <div className="mt-9 flex flex-wrap items-center gap-3">
        <Link
          href="/docs/quickstart"
          className="rounded-md bg-ink px-6 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-88"
        >
          Start with the quickstart
        </Link>
        <Link
          href="/docs/responses-and-errors"
          className="rounded-md border border-line px-6 py-3 text-sm font-medium transition-colors hover:border-ink"
        >
          Responses and errors
        </Link>
      </div>

      <div className="mt-16 flex flex-col gap-12">
        {DOC_GROUPS.map((group) => (
          <section key={group.title}>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
              {group.title}
            </h2>
            <ul className="mt-5 border-t border-line">
              {group.pages.map((page) => (
                <li key={page.slug} className="border-b border-line">
                  <Link
                    href={`/docs/${page.slug}`}
                    className="grid gap-1 py-4 transition-opacity hover:opacity-70 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-8"
                  >
                    <span className="font-medium">{page.title}</span>
                    <span className="text-[15px] leading-relaxed text-muted">{page.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-14 max-w-readable border-t border-line pt-6 text-[15px] leading-relaxed text-muted">
        These pages describe what is built. Where something is not built — outbound webhooks, client
        libraries, the Monnify and Flutterwave adapters — the page says so rather than leaving you to
        find out.{" "}
        <Link href="/status" className="border-b border-line text-ink hover:border-ink">
          The full status list
        </Link>
        .
      </p>
    </>
  );
}
