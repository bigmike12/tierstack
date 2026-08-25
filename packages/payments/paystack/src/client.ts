import { BillingError } from "@tierstack/shared";

/**
 * The thin HTTP layer between the adapter and api.paystack.co.
 *
 * It is a separate object from the provider for one reason: the adapter's logic
 * — how a Paystack response maps onto a PaymentResult, what counts as a
 * failure, which fields are safe to keep — is the part worth testing, and it can
 * only be tested if the transport can be replaced. `PaystackTransport` is that
 * seam.
 */
export interface PaystackTransport {
  request(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<{ status: number; body: PaystackEnvelope }>;
}

/** Every Paystack response has this envelope, success or failure. */
export interface PaystackEnvelope {
  status?: boolean;
  message?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface HttpTransportOptions {
  secretKey: string;
  baseUrl?: string;
  /** Milliseconds before a request is abandoned. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export const PAYSTACK_BASE_URL = "https://api.paystack.co";

export class HttpPaystackTransport implements PaystackTransport {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpTransportOptions) {
    this.baseUrl = (options.baseUrl ?? PAYSTACK_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<{ status: number; body: PaystackEnvelope }> {
    // A payment call that hangs holds an invoice open; bound it explicitly
    // rather than inheriting whatever the platform default happens to be.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.options.secretKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });

      const text = await response.text();
      let parsed: PaystackEnvelope;
      try {
        parsed = text ? (JSON.parse(text) as PaystackEnvelope) : {};
      } catch {
        // An HTML error page from a proxy is not a Paystack answer. Surface it
        // as a provider error instead of letting a JSON parse error escape.
        throw new BillingError(
          "PROVIDER_ERROR",
          `Paystack returned a non-JSON response (HTTP ${response.status}).`,
          { status: response.status }
        );
      }
      return { status: response.status, body: parsed };
    } catch (error) {
      if (error instanceof BillingError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        // Deliberately not treated as a failed payment: a timed-out request may
        // still have been processed by Paystack. The caller must verify by
        // reference rather than assume either outcome.
        throw new BillingError(
          "PROVIDER_ERROR",
          `Paystack did not respond within ${this.timeoutMs}ms. Verify the reference before retrying.`
        );
      }
      throw new BillingError(
        "PROVIDER_ERROR",
        `Could not reach Paystack: ${error instanceof Error ? error.message : "unknown error"}.`
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Unwraps the envelope. Paystack signals application-level failure with
 * `status: false` and HTTP 200 in some cases, so the HTTP code alone is not
 * enough to decide whether a call worked.
 */
export function unwrap(
  result: { status: number; body: PaystackEnvelope },
  operation: string
): Record<string, unknown> {
  const ok = result.status >= 200 && result.status < 300 && result.body.status !== false;
  if (!ok) {
    throw new BillingError(
      "PROVIDER_ERROR",
      `Paystack rejected ${operation}: ${result.body.message ?? `HTTP ${result.status}`}`,
      { status: result.status, message: result.body.message }
    );
  }
  if (result.body.data === null || typeof result.body.data !== "object") {
    throw new BillingError("PROVIDER_ERROR", `Paystack returned no data for ${operation}.`);
  }
  return result.body.data as Record<string, unknown>;
}
