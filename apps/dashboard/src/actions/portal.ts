"use server";

import { BillingError } from "@tierstack/shared";
import { ApiError, apiFetch } from "@/lib/api";

export interface PortalLinkState {
  url?: string;
  expiresLabel?: string;
  error?: string;
}

export async function createPortalLink(
  _prev: PortalLinkState,
  formData: FormData
): Promise<PortalLinkState> {
  const customerId = String(formData.get("customerId") ?? "");

  try {
    const session = await apiFetch<{ url: string; expiresAt: string }>("/v1/portal-sessions", {
      method: "POST",
      body: JSON.stringify({ customerId }),
    });

    return {
      url: session.url,
      expiresLabel: new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        day: "numeric",
        month: "short",
      }).format(new Date(session.expiresAt)),
    };
  } catch (error) {
    if (error instanceof ApiError || error instanceof BillingError) return { error: error.message };
    return { error: "Could not create a billing link." };
  }
}
