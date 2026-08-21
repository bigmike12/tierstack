import { createHash, randomBytes, randomUUID } from "node:crypto";

export type ApiKeyType = "PUBLIC" | "SECRET";
export type ApiEnvironment = "TEST" | "LIVE";

export interface GeneratedApiKey {
  /** Shown to the developer exactly once. Never persisted. */
  secret: string;
  /** Non-secret leading segment kept for display and support. */
  prefix: string;
  keyHash: string;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomToken(length = 32): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

/**
 * Keys look like `sk_test_<32 chars>`. Only the SHA-256 of the full key is
 * stored; the raw value is returned once at creation and is unrecoverable
 * afterwards.
 */
export function generateApiKey(type: ApiKeyType, environment: ApiEnvironment): GeneratedApiKey {
  const kind = type === "SECRET" ? "sk" : "pk";
  const env = environment === "LIVE" ? "live" : "test";
  const secret = `${kind}_${env}_${randomToken(32)}`;
  return {
    secret,
    prefix: secret.slice(0, `${kind}_${env}_`.length + 4),
    keyHash: hashApiKey(secret),
  };
}

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export interface ParsedApiKey {
  type: ApiKeyType;
  environment: ApiEnvironment;
}

export function parseApiKey(secret: string): ParsedApiKey | null {
  const match = /^(sk|pk)_(test|live)_[A-Za-z0-9]{16,}$/.exec(secret);
  if (!match) return null;
  return {
    type: match[1] === "sk" ? "SECRET" : "PUBLIC",
    environment: match[2] === "live" ? "LIVE" : "TEST",
  };
}

export function generateSessionToken(): { token: string; tokenHash: string } {
  const token = `${randomUUID().replace(/-/g, "")}${randomToken(24)}`;
  return { token, tokenHash: createHash("sha256").update(token, "utf8").digest("hex") };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
