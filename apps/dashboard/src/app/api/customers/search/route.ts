import { NextResponse } from "next/server";
import { apiFetchOrNull } from "@/lib/api";
import type { Customer } from "@/lib/types";

/**
 * The customer picker searches as you type, which means a request from the
 * browser — but `apiFetch` forwards the session cookie and must stay
 * server-side. This handler is the seam: the browser talks to the dashboard's
 * own origin, and the dashboard talks to the API with the session it already
 * holds. No key or cookie for the billing API ever reaches the client.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  const result = await apiFetchOrNull<{ items: Customer[] }>(
    `/v1/customers?limit=20${q ? `&q=${encodeURIComponent(q)}` : ""}`
  );

  return NextResponse.json({
    items: (result?.items ?? []).map((customer) => ({
      id: customer.id,
      externalId: customer.externalId,
      email: customer.email,
      name: customer.name,
    })),
  });
}
