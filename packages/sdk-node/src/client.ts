import { TierstackError } from "./errors";
import type { RequestOptions } from "./types";

export interface TierstackClientOptions {
  /** A secret key (`sk_test_...` or `sk_live_...`) from API Keys in the dashboard. */
  apiKey: string;
  /**
   * The API's base URL, e.g. `https://api.gettierstack.com`. Required rather
   * than defaulted — this SDK does not guess at infrastructure that may not
   * exist yet for your organization.
   */
  baseUrl: string;
  /** Injectable for tests and for runtimes without a global `fetch`. */
  fetch?: typeof fetch;
  /** Milliseconds before a request is abandoned. Defaults to 30s. */
  timeoutMs?: number;
}

interface ApiEnvelope<T> {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
  requestId: string;
}

// `object`, not `Record<string, unknown>` — the latter demands an index
// signature on every caller's type, which a plain params interface never has.
type Query = object;

/**
 * The one thing every resource shares: turning a method, a path and a body
 * into a request, and an envelope back into either a value or a thrown
 * `TierstackError`. No resource talks to `fetch` directly.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

export class TierstackHttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: TierstackClientOptions) {
    if (!options.apiKey) throw new Error("Tierstack: apiKey is required.");
    if (!options.baseUrl) throw new Error("Tierstack: baseUrl is required.");
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!this.fetchImpl) {
      throw new Error(
        "Tierstack: no global fetch is available in this runtime. Pass one explicitly via the `fetch` option."
      );
    }
  }

  async request<T>(
    method: string,
    path: string,
    params?: { body?: unknown; query?: Query; options?: RequestOptions }
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params?.query ?? ({} as Record<string, unknown>))) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        url.searchParams.set(key, String(value));
      }
    }

    // A hung request otherwise waits on whatever default the runtime happens
    // to have (often none at all) — a caller integrating this SDK into a
    // request handler should never have that decided for them implicitly.
    const controller = new AbortController();
    const timeoutMs = params?.options?.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
          ...(params?.options?.idempotencyKey
            ? { "idempotency-key": params.options.idempotencyKey }
            : {}),
        },
        ...(params?.body === undefined ? {} : { body: JSON.stringify(params.body) }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new TierstackError(
          `Tierstack API did not respond within ${timeoutMs}ms.`,
          "REQUEST_TIMEOUT",
          0,
          null
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const envelope = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

    if (!response.ok || !envelope || envelope.error) {
      throw new TierstackError(
        envelope?.error?.message ?? `Tierstack API returned HTTP ${response.status} with no readable body.`,
        envelope?.error?.code ?? "UNKNOWN_ERROR",
        response.status,
        envelope?.requestId ?? null,
        envelope?.error?.details
      );
    }

    return envelope.data as T;
  }
}
