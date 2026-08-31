import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

const KEY_LENGTH = 64;

/**
 * Set on a user created by an invite before they exist for real. Not a valid
 * scrypt hash — `verifyPassword` rejects it unconditionally, so an invitee
 * cannot log in until they accept the invite and set a real password.
 */
export const PLACEHOLDER_PASSWORD_HASH = "invited$$";

/** scrypt with a per-password salt. Passwords are never stored or logged. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltPart, hashPart] = stored.split("$");
  if (scheme !== "scrypt" || !saltPart || !hashPart) return false;
  const salt = Buffer.from(saltPart, "base64");
  const expected = Buffer.from(hashPart, "base64");
  const derived = await scrypt(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
