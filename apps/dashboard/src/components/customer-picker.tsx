"use client";

import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface PickerCustomer {
  id: string;
  externalId: string | null;
  email: string;
  name: string | null;
}

/**
 * Picks one customer out of however many the organization has.
 *
 * The obvious version — render every customer as a chip — stops working at the
 * second screenful, so this searches on the server instead and never holds more
 * than a page of results. The selection travels as a search param so the page
 * itself stays a server component and the URL remains shareable.
 */
export function CustomerPicker({
  basePath,
  selected,
  selectedLabel,
  total,
  initialCustomers = [],
  /** Customers worth surfacing first — e.g. the ones with usage recorded. */
  highlighted = [],
}: {
  basePath: string;
  selected: string | null;
  selectedLabel: string | null;
  total?: number;
  initialCustomers?: PickerCustomer[];
  highlighted?: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<PickerCustomer[]>(initialCustomers);
  const [loading, setLoading] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const highlightedSet = React.useMemo(() => new Set(highlighted), [highlighted]);

  // Click-away and Escape both close, because a dropdown you cannot dismiss is
  // worse than the chips it replaced.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/customers/search?q=${encodeURIComponent(query)}`);
        const body = (await response.json()) as { items: PickerCustomer[] };
        if (!cancelled) setResults(body.items ?? []);
      } catch {
        // A failed lookup leaves the previous results on screen rather than
        // blanking the list; the user can retype.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  const choose = (customer: PickerCustomer) => {
    const key = customer.externalId ?? customer.id;
    setOpen(false);
    router.push(`${basePath}?customerId=${encodeURIComponent(key)}`);
  };

  return (
    <div ref={containerRef} className="relative w-full sm:w-96">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-sm shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={cn("truncate", !selectedLabel && "text-muted-foreground")}>
          {selectedLabel ?? "Select a customer"}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {open ? (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
          <div className="relative border-b border-border">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by id, email or name…"
              aria-label="Search customers"
              className="h-9 w-full bg-transparent pl-9 pr-9 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
            />
            {loading ? (
              <Loader2
                className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
                aria-hidden
              />
            ) : null}
          </div>

          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {results.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                {loading ? "Searching…" : "No customers match that search."}
              </li>
            ) : (
              results.map((customer) => {
                const key = customer.externalId ?? customer.id;
                const active = key === selected || customer.id === selected;
                return (
                  <li key={customer.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => choose(customer)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted",
                        active && "bg-primary/10"
                      )}
                    >
                      <Check
                        className={cn("size-4 shrink-0", active ? "opacity-100" : "opacity-0")}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-xs">
                          {customer.externalId ?? customer.id}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {customer.name ? `${customer.name} · ` : ""}
                          {customer.email}
                        </span>
                      </span>
                      {highlightedSet.has(customer.id) ? (
                        <span
                          title="Has recorded usage"
                          className="size-1.5 shrink-0 rounded-full bg-success"
                        />
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          {typeof total === "number" && total > results.length ? (
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              Showing {results.length} of {total.toLocaleString()} — narrow the search to find more.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
