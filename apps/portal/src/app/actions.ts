"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PortalError, portalFetch } from "@/lib/api";

/**
 * Pay an outstanding invoice.
 *
 * Redirects straight to the provider's checkout rather than rendering a page in
 * between. The customer came here to settle one number; anything else on the
 * way is a chance to lose them.
 */
export async function payInvoice(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get("invoiceId"));
  let checkoutUrl: string | null = null;

  try {
    const result = await portalFetch<{ checkoutUrl: string | null }>(
      `/portal/v1/invoices/${invoiceId}/pay`,
      { method: "POST" }
    );
    checkoutUrl = result.checkoutUrl;
  } catch (error) {
    const code = error instanceof PortalError ? error.code : "UNKNOWN";
    redirect(`/?problem=${encodeURIComponent(code)}`);
  }

  if (!checkoutUrl) redirect("/?problem=NO_CHECKOUT");
  redirect(checkoutUrl);
}

export async function cancelSubscription(formData: FormData): Promise<void> {
  const subscriptionId = String(formData.get("subscriptionId"));
  try {
    await portalFetch(`/portal/v1/subscriptions/${subscriptionId}/cancel`, {
      method: "POST",
      body: { atPeriodEnd: true },
    });
  } catch (error) {
    const code = error instanceof PortalError ? error.code : "UNKNOWN";
    redirect(`/?problem=${encodeURIComponent(code)}`);
  }
  revalidatePath("/");
  redirect("/?done=canceled");
}

export async function keepSubscription(formData: FormData): Promise<void> {
  const subscriptionId = String(formData.get("subscriptionId"));
  try {
    await portalFetch(`/portal/v1/subscriptions/${subscriptionId}/resume`, { method: "POST" });
  } catch (error) {
    const code = error instanceof PortalError ? error.code : "UNKNOWN";
    redirect(`/?problem=${encodeURIComponent(code)}`);
  }
  revalidatePath("/");
  redirect("/?done=kept");
}
