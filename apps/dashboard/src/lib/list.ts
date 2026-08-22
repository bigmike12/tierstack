import type { Paged } from "@/components/ui/pagination";

export type { Paged };

/** What a page renders when the API call failed — an empty table, not a crash. */
export function emptyPage<T>(limit = 25): Paged<T> {
  return { items: [], page: 1, limit, total: 0, totalPages: 1 };
}

/**
 * Builds the query string for a list endpoint, dropping anything unset so the
 * URL stays readable and two equivalent views produce the same cache key.
 */
export function listQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}
