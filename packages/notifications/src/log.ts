import type { EmailTransport, OutboundEmail, SentEmail } from "./types";

/**
 * Prints the message instead of sending it.
 *
 * This is what runs when no email provider is configured, and it is deliberate:
 * a developer running locally should be able to see the exact subject and body
 * a customer would have received, rather than either nothing at all or a silent
 * pretence that mail was delivered. Every message it "sends" is still recorded
 * as SENT against the LOG provider, so the trail is honest about which rail
 * carried it.
 */
export class LogEmailTransport implements EmailTransport {
  readonly kind = "LOG" as const;
  readonly sent: OutboundEmail[] = [];

  constructor(private readonly write: (line: string) => void = (line) => console.log(line)) {}

  async send(email: OutboundEmail): Promise<SentEmail> {
    this.sent.push(email);
    this.write(
      `\n[email:log] to=${email.to} subject=${JSON.stringify(email.subject)}\n${email.text}\n`
    );
    return { providerMessageId: `log_${this.sent.length}` };
  }
}
