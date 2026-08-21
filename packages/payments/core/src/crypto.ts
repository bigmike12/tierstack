import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function loadKey(rawKey = process.env.ENCRYPTION_KEY): Buffer {
  if (!rawKey) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32"
    );
  }
  const key = Buffer.from(rawKey, "hex");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters.");
  }
  return key;
}

/**
 * Provider credentials are sealed with AES-256-GCM before they touch the
 * database. The organization id is bound in as additional authenticated data,
 * so a ciphertext copied into another tenant's row fails to decrypt.
 */
export function encryptCredentials(
  plaintext: Record<string, unknown>,
  associatedData: string,
  rawKey?: string
): string {
  const key = loadKey(rawKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(plaintext), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptCredentials<T = Record<string, unknown>>(
  ciphertext: string,
  associatedData: string,
  rawKey?: string
): T {
  const key = loadKey(rawKey);
  const [ivPart, tagPart, dataPart] = ciphertext.split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Malformed credential ciphertext.");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, "base64"), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

/** Constant-time comparison for signatures and tokens. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
