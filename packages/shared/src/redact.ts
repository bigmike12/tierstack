const SENSITIVE_KEY_PATTERN =
  /(secret|password|token|authorization|api[-_]?key|signature|cvv|pan|card[-_]?number|encrypted|credential|session)/i;

const SECRET_VALUE_PATTERN = /\b(sk_(?:test|live)_[A-Za-z0-9]+)\b/g;

/**
 * Recursively strips anything that must never reach a log sink. Applied to
 * request bodies, provider payloads and error details before logging.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[redacted:depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.replace(SECRET_VALUE_PATTERN, "[redacted]");
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : redact(item, depth + 1);
  }
  return out;
}

/** Card-safe display form: never store or log more than the last four digits. */
export function maskLast4(value: string): string {
  const last4 = value.slice(-4);
  return `••••${last4}`;
}
