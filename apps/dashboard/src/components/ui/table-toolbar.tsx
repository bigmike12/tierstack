"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Search that lives in the URL rather than in component state.
 *
 * The tables are rendered on the server, so the query has to travel as a search
 * param — which also means a filtered view is a link someone can bookmark or
 * paste into a ticket. Typing is debounced so a five-letter search is one
 * request, not five, and `page` is dropped on every keystroke because being
 * left on page 4 of a result set that now has one page shows an empty table.
 */
export function SearchInput({
  placeholder = "Search…",
  paramName = "q",
  className,
}: {
  placeholder?: string;
  paramName?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = React.useTransition();

  const urlValue = searchParams.get(paramName) ?? "";
  const [value, setValue] = React.useState(urlValue);

  // Keep the box in step when the URL changes underneath us — a back button, or
  // the clear control below.
  React.useEffect(() => {
    setValue(urlValue);
  }, [urlValue]);

  const commit = React.useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.trim()) params.set(paramName, next.trim());
      else params.delete(paramName);
      params.delete("page");

      const query = params.toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [paramName, pathname, router, searchParams]
  );

  React.useEffect(() => {
    if (value === urlValue) return;
    const timer = setTimeout(() => commit(value), 300);
    return () => clearTimeout(timer);
  }, [value, urlValue, commit]);

  return (
    <div className={cn("relative w-full sm:w-72", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="flex h-9 w-full rounded-md border border-input bg-card pl-9 pr-9 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => setValue("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
      {isPending ? (
        <span className="absolute -bottom-px left-0 h-px w-full animate-pulse bg-foreground/30" aria-hidden />
      ) : null}
    </div>
  );
}
