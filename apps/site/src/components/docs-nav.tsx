"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { DOC_GROUPS } from "@/docs/content";

/**
 * The docs sidebar.
 *
 * A client component only so it can mark the current page and collapse on a
 * phone. On a narrow screen the whole thing folds into one disclosure rather
 * than pushing the actual documentation two screens down.
 */
export function DocsNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const current = DOC_GROUPS.flatMap((group) => group.pages).find(
    (page) => pathname === `/docs/${page.slug}`
  );

  return (
    <nav aria-label="Documentation">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-md border border-line px-4 py-3 text-sm lg:hidden"
      >
        <span>{current ? current.title : "Documentation"}</span>
        <span aria-hidden className="font-mono text-[11px] text-muted">
          {open ? "close" : "browse"}
        </span>
      </button>

      <div className={`${open ? "block" : "hidden"} pt-6 lg:block lg:pt-0`}>
        <Link
          href="/docs"
          className={`block text-sm ${pathname === "/docs" ? "text-ink" : "text-muted hover:text-ink"}`}
        >
          Overview
        </Link>

        {DOC_GROUPS.map((group) => (
          <div key={group.title} className="mt-7">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-accent">
              {group.title}
            </p>
            <ul className="mt-3 space-y-2.5">
              {group.pages.map((page) => {
                const href = `/docs/${page.slug}`;
                const active = pathname === href;
                return (
                  <li key={page.slug}>
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      className={`block text-sm leading-snug ${
                        active ? "text-ink" : "text-muted hover:text-ink"
                      }`}
                    >
                      {active ? (
                        <span aria-hidden className="mr-2 text-accent">
                          &mdash;
                        </span>
                      ) : null}
                      {page.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
