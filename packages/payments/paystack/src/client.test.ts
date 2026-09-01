import { describe, expect, it } from "vitest";
import { HttpPaystackTransport } from "./client";

/**
 * A charge that time out or drops mid-request may still have reached
 * Paystack — the caller must verify by reference rather than assume a
 * failure. These tests pin that distinction at the transport boundary: only
 * a genuine, already-answered rejection (HTTP response received) is
 * PROVIDER_ERROR; anything where the outcome is unknown is PROVIDER_TIMEOUT.
 */
describe("HttpPaystackTransport", () => {
  it("reports a timeout as ambiguous, not a known failure", async () => {
    const fetchImpl = (() => {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      return Promise.reject(error);
    }) as unknown as typeof fetch;

    const transport = new HttpPaystackTransport({ secretKey: "sk_test_x", fetchImpl });

    await expect(transport.request("POST", "/transaction/charge_authorization")).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });
  });

  it("reports a dropped connection as ambiguous, not a known failure", async () => {
    const fetchImpl = (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    const transport = new HttpPaystackTransport({ secretKey: "sk_test_x", fetchImpl });

    await expect(transport.request("POST", "/transaction/charge_authorization")).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });
  });

  it("still reports a received-but-unparseable response as a known provider error", async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response("<html>upstream proxy error</html>", { status: 502 })
      )) as unknown as typeof fetch;
    const transport = new HttpPaystackTransport({ secretKey: "sk_test_x", fetchImpl });

    await expect(transport.request("GET", "/transaction/verify/ref")).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });

  it("propagates a real answer from Paystack untouched", async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: true, message: "ok", data: { id: 1 } }), { status: 200 })
      )) as unknown as typeof fetch;
    const transport = new HttpPaystackTransport({ secretKey: "sk_test_x", fetchImpl });

    const result = await transport.request("GET", "/transaction/verify/ref");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: true, message: "ok", data: { id: 1 } });
  });
});
