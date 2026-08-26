/**
 * The email layer, behind an interface, for the same reason the payment rails
 * are: the platform owns what gets said and when, and the provider is a wire.
 * Swapping Resend for Postmark should not touch a single line of billing logic.
 */

export type EmailProviderKind = "RESEND" | "LOG";

export interface OutboundEmail {
  to: string;
  from: string;
  /** Display name shown beside the from-address. */
  fromName?: string | null;
  replyTo?: string | null;
  subject: string;
  text: string;
  html: string;
}

export interface SentEmail {
  providerMessageId: string | null;
}

export interface EmailTransport {
  readonly kind: EmailProviderKind;
  send(email: OutboundEmail): Promise<SentEmail>;
}

/** Thrown when the provider refused the message. Never swallowed. */
export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly provider: EmailProviderKind,
    readonly status?: number
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}
