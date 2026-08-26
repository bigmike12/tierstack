import { cookies } from "next/headers";

/**
 * The portal talks to the API from the server only.
 *
 * The session token never reaches the browser as anything but an httpOnly
 * cookie, and never appears in a URL after the first hop. A customer forwarding
 * the page they are looking at forwards nothing that works.
 */
const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");

export const PORTAL_COOKIE = "tb_portal";

export class PortalError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function portalToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(PORTAL_COOKIE)?.value ?? null;
}

export async function portalFetch<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
  token?: string
): Promise<T> {
  const authorization = token ?? (await portalToken());
  if (!authorization) throw new PortalError("No portal session.", "UNAUTHENTICATED", 401);

  const response = await fetch(`${API_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${authorization}`,
      "content-type": "application/json",
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | { data?: T; error?: { code: string; message: string } }
    | null;

  if (!response.ok || !payload || payload.error) {
    throw new PortalError(
      payload?.error?.message ?? "Something went wrong.",
      payload?.error?.code ?? "UNKNOWN",
      response.status
    );
  }
  return payload.data as T;
}
