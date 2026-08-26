import { NextResponse, type NextRequest } from "next/server";
import { PORTAL_COOKIE, portalFetch } from "@/lib/api";
import type { PortalOverview } from "@/lib/types";

/**
 * The landing hop.
 *
 * A route handler rather than a page, because this does one job — take the
 * token out of the URL and put it in a cookie — and Next only allows a cookie
 * to be written from a handler or an action. Nothing is rendered here.
 *
 * The token arrives in the URL because it has to travel by email, and it leaves
 * immediately: checked once, moved into an httpOnly cookie, then a redirect to
 * a clean address. What survives in browser history, on a shared screen or in a
 * forwarded link is an address that carries nothing.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const origin = process.env.PORTAL_URL ?? "http://localhost:3001";

  let expiresAt: string | null = null;
  try {
    // Proved before the cookie is set, so an expired link lands on the page
    // that explains itself rather than an empty portal.
    const overview = await portalFetch<PortalOverview>("/portal/v1/overview", {}, token);
    expiresAt = overview.expiresAt;
  } catch {
    // A token that was presented and refused really is a dead link, whatever
    // the reason — there is nothing else it could be.
    return NextResponse.redirect(new URL("/expired", origin));
  }

  const response = NextResponse.redirect(new URL("/", origin));
  response.cookies.set(PORTAL_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
  });
  return response;
}
