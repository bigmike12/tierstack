import { cookies } from "next/headers";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export const SESSION_COOKIE = "tb_session";
export const ORG_COOKIE = "tb_org";

export interface ApiEnvelope<T> {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
  requestId: string;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * All dashboard data is fetched server-side and the session cookie is forwarded
 * from the incoming request. Nothing reaches the browser that a browser should
 * not hold — in particular, no secret API key is ever sent to the client.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit & { organizationId?: string } = {}
): Promise<T> {
  const store = await cookies();
  const session = store.get(SESSION_COOKIE)?.value;
  const organizationId = init.organizationId ?? store.get(ORG_COOKIE)?.value;

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(session ? { cookie: `${SESSION_COOKIE}=${session}` } : {}),
      ...(organizationId ? { "x-organization-id": organizationId } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  const envelope = (await response.json().catch(() => ({
    data: null,
    error: { code: "INTERNAL_ERROR", message: "The API returned an unreadable response." },
    requestId: "req_unknown",
  }))) as ApiEnvelope<T>;

  if (!response.ok || envelope.error) {
    throw new ApiError(
      envelope.error?.code ?? "INTERNAL_ERROR",
      envelope.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      envelope.error?.details
    );
  }
  return envelope.data as T;
}

/** Returns null instead of throwing, for pages that render an empty state. */
export async function apiFetchOrNull<T>(path: string): Promise<T | null> {
  try {
    return await apiFetch<T>(path);
  } catch {
    return null;
  }
}

/** Used by the login and register actions, which have no cookie to forward yet. */
export async function apiPostRaw(
  path: string,
  body: unknown
): Promise<{ envelope: ApiEnvelope<unknown>; setCookie: string | null; ok: boolean }> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const envelope = (await response.json().catch(() => ({
    data: null,
    error: { code: "INTERNAL_ERROR", message: "The API is unreachable. Is it running on " + API_URL + "?" },
    requestId: "req_unknown",
  }))) as ApiEnvelope<unknown>;
  return { envelope, setCookie: response.headers.get("set-cookie"), ok: response.ok };
}

export function apiUrl(): string {
  return API_URL;
}
