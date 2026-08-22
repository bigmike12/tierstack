import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** The shape every list endpoint returns. */
export interface Paged<T> extends PageMeta {
  items: T[];
}

/**
 * Plain links, not buttons: paging is a navigation, it works without
 * JavaScript, and each page is addressable. Every other search param is carried
 * across so paging never silently drops an active search or filter.
 */
export function Pagination({
  meta,
  basePath,
  params = {},
  className,
}: {
  meta: PageMeta;
  basePath: string;
  /** The other search params currently in effect. */
  params?: Record<string, string | undefined>;
  className?: string;
}) {
  if (meta.total === 0) return null;

  const href = (page: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "" && key !== "page") search.set(key, value);
    }
    if (page > 1) search.set("page", String(page));
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  const first = (meta.page - 1) * meta.limit + 1;
  const last = Math.min(meta.page * meta.limit, meta.total);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm",
        className
      )}
    >
      <p className="tabular text-muted-foreground">
        {first.toLocaleString()}–{last.toLocaleString()} of {meta.total.toLocaleString()}
      </p>

      {meta.totalPages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <Step href={href(meta.page - 1)} disabled={meta.page <= 1} label="Previous">
            <ChevronLeft className="size-4" aria-hidden />
          </Step>

          {pageWindow(meta.page, meta.totalPages).map((entry, index) =>
            entry === null ? (
              <span key={`gap-${index}`} className="px-1 text-muted-foreground">
                …
              </span>
            ) : (
              <Link
                key={entry}
                href={href(entry)}
                aria-current={entry === meta.page ? "page" : undefined}
                className={cn(
                  "tabular inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs",
                  entry === meta.page
                    ? "bg-secondary font-medium text-secondary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {entry}
              </Link>
            )
          )}

          <Step href={href(meta.page + 1)} disabled={meta.page >= meta.totalPages} label="Next">
            <ChevronRight className="size-4" aria-hidden />
          </Step>
        </nav>
      ) : null}
    </div>
  );
}

function Step({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const classes = "inline-flex h-8 w-8 items-center justify-center rounded-md";
  if (disabled) {
    return (
      <span aria-disabled className={cn(classes, "text-muted-foreground/40")}>
        {children}
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={cn(classes, "text-muted-foreground hover:bg-muted hover:text-foreground")}>
      {children}
    </Link>
  );
}

/**
 * First page, last page, and a window around the current one — `null` marks an
 * elision. Keeps the control a fixed width whether there are 3 pages or 300.
 */
function pageWindow(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set<number>([1, total, current]);
  if (current - 1 > 1) pages.add(current - 1);
  if (current + 1 < total) pages.add(current + 1);
  // Keep the control from jumping about at the ends.
  if (current <= 3) [2, 3, 4].forEach((page) => pages.add(page));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((page) => pages.add(page));

  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) out.push(null);
    out.push(page);
    previous = page;
  }
  return out;
}
