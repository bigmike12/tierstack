import { LogEmailTransport } from "./log";
import { ResendTransport } from "./resend";
import type { EmailTransport } from "./types";

export interface EmailTransportOptions {
  /** Resend API key. Absent means no provider is configured. */
  resendApiKey?: string | null;
}

/**
 * Picks the transport from what is configured.
 *
 * With no key, this returns the log transport rather than throwing or silently
 * doing nothing. A developer who has not set `RESEND_API_KEY` yet should still
 * see every message the engine decided to send, in their terminal, with the
 * provider recorded as LOG so nobody later mistakes it for delivered mail.
 */
export function createEmailTransport(options: EmailTransportOptions = {}): EmailTransport {
  const key = options.resendApiKey?.trim();
  return key ? new ResendTransport(key) : new LogEmailTransport();
}
