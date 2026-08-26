import { EmailDeliveryError, type EmailTransport, type OutboundEmail, type SentEmail } from "./types";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Resend, over its REST API rather than the SDK.
 *
 * One dependency fewer, and the failure modes stay visible: a non-2xx, a
 * non-JSON body and a timeout are three different problems and the caller is
 * told which one happened. A send that did not happen never reports success.
 */
export class ResendTransport implements EmailTransport {
  readonly kind = "RESEND" as const;

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 15_000,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    if (!apiKey) throw new Error("A Resend API key is required.");
  }

  async send(email: OutboundEmail): Promise<SentEmail> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: email.fromName ? `${email.fromName} <${email.from}>` : email.from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          html: email.html,
          ...(email.replyTo ? { reply_to: [email.replyTo] } : {}),
        }),
        signal: controller.signal,
      });

      const raw = await response.text();
      let body: { id?: string; message?: string; name?: string } = {};
      if (raw) {
        try {
          body = JSON.parse(raw) as typeof body;
        } catch {
          throw new EmailDeliveryError(
            `Resend returned a non-JSON response (HTTP ${response.status}).`,
            this.kind,
            response.status
          );
        }
      }

      if (!response.ok) {
        throw new EmailDeliveryError(
          body.message ?? `Resend rejected the message (HTTP ${response.status}).`,
          this.kind,
          response.status
        );
      }

      return { providerMessageId: body.id ?? null };
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new EmailDeliveryError(`Resend did not respond within ${this.timeoutMs}ms.`, this.kind);
      }
      throw new EmailDeliveryError(
        error instanceof Error ? error.message : "Resend could not be reached.",
        this.kind
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
