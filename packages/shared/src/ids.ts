import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Cryptographically random, prefix-namespaced public identifier. */
export function generateId(prefix: string, length = 16): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${prefix}_${out}`;
}

export const ID_PREFIXES = {
  organization: "org",
  user: "usr",
  member: "mem",
  apiKey: "key",
  customer: "cus",
  plan: "plan",
  price: "price",
  subscription: "sub",
  invoice: "inv",
  lineItem: "il",
  paymentAttempt: "pay",
  paymentMethod: "pm",
  providerConfig: "ppc",
  usageMeter: "meter",
  usageEvent: "uevt",
  entitlement: "ent",
  coupon: "coup",
  redemption: "red",
  referral: "ref",
  credit: "cr",
  webhookEvent: "whe",
  emailMessage: "em",
  idempotency: "idem",
  portalSession: "ps",
  session: "sess",
  auditLog: "log",
  request: "req",
  checkout: "cs",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export function newId(kind: IdKind): string {
  return generateId(ID_PREFIXES[kind]);
}

export function newRequestId(): string {
  return generateId(ID_PREFIXES.request, 12);
}
