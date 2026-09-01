/** Every list endpoint returns this shape. */
export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListParams {
  page?: number;
  limit?: number;
  /** Free-text search — the fields it matches vary by resource, see the docs for each. */
  q?: string;
}

/** Passed to a create/mutate call. Reused verbatim as the `Idempotency-Key` header. */
export interface RequestOptions {
  idempotencyKey?: string;
  /** Overrides the client's default request timeout for this call only. */
  timeoutMs?: number;
}
