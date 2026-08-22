/**
 * Page-based listing, shared by every list endpoint.
 *
 * Page numbers rather than cursors: these endpoints back a dashboard where a
 * human wants to jump to page 4 and see a total, and the row counts involved
 * (one organization's customers, invoices, webhook deliveries) are small enough
 * that OFFSET is not the wrong tool. A cursor would be the right answer for an
 * export API over millions of rows; it is the wrong answer for a table with a
 * page number under it.
 */

export interface PageQuery {
  page: number;
  limit: number;
  /** Rows to skip — the offset Prisma wants. */
  skip: number;
  /** Free-text search term, already trimmed. Empty searches are treated as absent. */
  q: string | null;
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PageQueryOptions {
  defaultLimit?: number;
  maxLimit?: number;
}

/**
 * Reads `page`, `limit` and `q` off a query string. Anything unparseable falls
 * back to the default rather than erroring: a malformed `?page=abc` in a URL a
 * user typed should show page one, not a 400.
 */
export function parsePageQuery(
  query: Record<string, unknown>,
  options: PageQueryOptions = {}
): PageQuery {
  const defaultLimit = options.defaultLimit ?? 25;
  const maxLimit = options.maxLimit ?? 100;

  const page = Math.max(1, toInt(query.page, 1));
  const limit = Math.min(Math.max(1, toInt(query.limit, defaultLimit)), maxLimit);
  const raw = typeof query.q === "string" ? query.q.trim() : "";

  return { page, limit, skip: (page - 1) * limit, q: raw.length > 0 ? raw : null };
}

export function paginated<T>(items: T[], query: PageQuery, total: number): Page<T> {
  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    // A page count of zero would make "page 1 of 0" render; an empty list is
    // still one (empty) page.
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

/**
 * A case-insensitive contains filter across several columns, as Prisma expects
 * it. Returns undefined when there is nothing to search for, so it can be
 * spread into a `where` unconditionally.
 */
export function searchFilter<F extends string>(
  q: string | null,
  fields: readonly F[]
): { OR: Record<string, { contains: string; mode: "insensitive" }>[] } | undefined {
  if (!q) return undefined;
  return {
    OR: fields.map((field) => ({ [field]: { contains: q, mode: "insensitive" as const } })),
  };
}

function toInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
