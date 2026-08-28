/**
 * What a decline actually means for what to do next.
 *
 * Every rail returns its own free-text reason, and left as text every failure
 * gets treated the same: four attempts over five days, four emails, and a
 * customer whose card expired in March being told four times that "this is
 * usually temporary". It is not usually temporary. Some declines will never
 * clear on their own no matter how patiently they are retried, and the only
 * thing that helps is a different card.
 *
 * So the reason is classified once, at the adapter, and the engine acts on the
 * class rather than on the prose.
 */
export type FailureClass =
  /** The same instrument may well work later — funds, limits, issuer trouble. */
  | "RETRYABLE"
  /** Retrying changes nothing. Only a new card or method will settle this. */
  | "REQUIRES_ACTION"
  /** Not recognised. Treated as retryable, and recorded as unrecognised. */
  | "UNKNOWN";

/**
 * Reasons that will never clear by waiting.
 *
 * Matched as substrings against the provider's lowercased text, because rails
 * are inconsistent about casing, punctuation and whether a message is a phrase
 * or a sentence. Order does not matter: a hit on any of these is decisive.
 */
const REQUIRES_ACTION_PATTERNS = [
  "expired card",
  "card expired",
  "invalid card",
  "invalid card number",
  "incorrect number",
  "no such card",
  "restricted card",
  "lost card",
  "stolen card",
  "pick up card",
  "pickup card",
  "closed account",
  "invalid account",
  "account closed",
  "not permitted",
  "transaction not permitted",
  "security violation",
  "fraud",
  "revocation",
  "stop payment",
  "3ds",
  "authentication failed",
  "incorrect pin",
  "allowable pin tries exceeded",
  "pin tries exceeded",
  "invalid cvv",
  "incorrect cvc",
];

/** Reasons that are worth another go later. */
const RETRYABLE_PATTERNS = [
  "insufficient funds",
  "insufficient balance",
  "do not honour",
  "do not honor",
  "declined",
  "issuer",
  "switch inoperative",
  "system malfunction",
  "timeout",
  "timed out",
  "try again",
  "temporarily",
  "limit exceeded",
  "exceeds withdrawal",
  "transaction limit",
  "unable to process",
  "network",
];

/**
 * Classify a provider's decline text.
 *
 * Unrecognised text is `UNKNOWN` rather than either answer, and the engine
 * treats unknown as retryable — guessing "give up" on a reason nobody has seen
 * would abandon a recoverable customer, which is the more expensive mistake.
 * The lists grow as real responses are observed; nothing here is invented from
 * a rail nobody has run.
 */
export function classifyFailure(reason: string | null | undefined): FailureClass {
  const text = (reason ?? "").toLowerCase().trim();
  if (!text) return "UNKNOWN";

  // Checked first: "expired card" must not be caught by the generic "declined"
  // that a rail may append to the same message.
  if (REQUIRES_ACTION_PATTERNS.some((pattern) => text.includes(pattern))) return "REQUIRES_ACTION";
  if (RETRYABLE_PATTERNS.some((pattern) => text.includes(pattern))) return "RETRYABLE";
  return "UNKNOWN";
}

/** Whether the dunning ladder should keep trying the instrument on file. */
export function isWorthRetrying(failureClass: FailureClass | null | undefined): boolean {
  return failureClass !== "REQUIRES_ACTION";
}
