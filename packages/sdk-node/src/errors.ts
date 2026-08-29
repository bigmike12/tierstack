/**
 * Thrown for every non-2xx response and every response the client could not
 * parse. `code` is the same stable string the API returns — safe to switch on
 * — and `requestId` is worth logging: it is what support looks up first.
 */
export class TierstackError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
    readonly requestId: string | null,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "TierstackError";
  }
}
