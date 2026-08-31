"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";

export interface ActionState {
  error?: string;
  message?: string;
  /** Present exactly once, right after a key is created. */
  secret?: string;
}

function failure(error: unknown): ActionState {
  if (error instanceof ApiError) return { error: error.message };
  return { error: "Something went wrong. Check the API logs." };
}

export async function updateBillingSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const retryIntervals = String(formData.get("retryIntervals") ?? "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0);

  try {
    await apiFetch("/v1/billing-settings", {
      method: "PUT",
      body: JSON.stringify({
        gracePeriodDays: Number(formData.get("gracePeriodDays")),
        maxRetryAttempts: Number(formData.get("maxRetryAttempts")),
        retryIntervals,
        accessDuringGracePeriod: String(formData.get("accessDuringGracePeriod")),
        failureAction: String(formData.get("failureAction")),
        invoiceDueDays: Number(formData.get("invoiceDueDays")),
        incompleteExpiryHours: Number(formData.get("incompleteExpiryHours")),
        autoCollect: formData.get("autoCollect") === "on",
        notificationsEnabled: formData.get("notificationsEnabled") === "on",
        priceChangeNoticeDays: Number(formData.get("priceChangeNoticeDays")),
        trialEndingNoticeDays: Number(formData.get("trialEndingNoticeDays")),
        supportEmail: String(formData.get("supportEmail") ?? "").trim() || null,
        senderName: String(formData.get("senderName") ?? "").trim() || null,
        emailSender: String(formData.get("emailSender") ?? "").trim() || null,
        invoiceNumberPrefix: String(formData.get("invoiceNumberPrefix") ?? "").trim() || null,
        defaultCurrency: String(formData.get("defaultCurrency") ?? "").trim().toUpperCase() || undefined,
      }),
    });
    revalidatePath("/settings");
    revalidatePath("/dunning");
    return { message: "Billing policy saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await apiFetch("/v1/auth/me", {
      method: "PATCH",
      body: JSON.stringify({ name: String(formData.get("name") ?? "").trim() }),
    });
    revalidatePath("/settings");
    return { message: "Profile updated." };
  } catch (error) {
    return failure(error);
  }
}

export async function changePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (newPassword !== confirmPassword) {
    return { error: "New password and confirmation do not match." };
  }

  try {
    await apiFetch("/v1/auth/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: String(formData.get("currentPassword") ?? ""),
        newPassword,
      }),
    });
    return { message: "Password changed." };
  } catch (error) {
    return failure(error);
  }
}

export async function createApiKey(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const created = await apiFetch<{ secret: string }>("/v1/api-keys", {
      method: "POST",
      body: JSON.stringify({
        name: String(formData.get("name") ?? "Untitled key"),
        type: String(formData.get("type") ?? "SECRET"),
        environment: String(formData.get("environment") ?? "TEST"),
      }),
    });
    revalidatePath("/api-keys");
    return { secret: created.secret, message: "Key created. This is the only time it is shown." };
  } catch (error) {
    return failure(error);
  }
}

export async function revokeApiKey(formData: FormData): Promise<void> {
  await apiFetch(`/v1/api-keys/${String(formData.get("keyId"))}`, { method: "DELETE" }).catch(() => undefined);
  revalidatePath("/api-keys");
}

export async function configureProvider(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const credentials: Record<string, string> = {};
  const raw = String(formData.get("credentials") ?? "").trim();
  if (raw) {
    for (const line of raw.split("\n")) {
      const [key, ...rest] = line.split("=");
      if (key && rest.length > 0) credentials[key.trim()] = rest.join("=").trim();
    }
  }
  if (String(formData.get("provider")) === "MOCK" && !credentials.webhookSecret) {
    credentials.webhookSecret = "whsec_mock_local";
  }

  try {
    await apiFetch("/v1/payment-providers", {
      method: "POST",
      body: JSON.stringify({
        provider: String(formData.get("provider")),
        environment: String(formData.get("environment") ?? "TEST"),
        credentials,
        isDefault: formData.get("isDefault") === "on",
        enabled: true,
      }),
    });
    revalidatePath("/payment-providers");
    return { message: "Provider saved. Credentials were encrypted before storage." };
  } catch (error) {
    return failure(error);
  }
}

export async function updateProvider(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const rawCredentials = String(formData.get("credentials") ?? "").trim();
  const credentials: Record<string, string> = {};

  if (rawCredentials) {
    for (const line of rawCredentials.split("\n")) {
      const [key, ...rest] = line.split("=");
      if (key && rest.length > 0) credentials[key.trim()] = rest.join("=").trim();
    }
  }

  try {
    await apiFetch(`/v1/payment-providers/${String(formData.get("configId"))}`, {
      method: "PATCH",
      body: JSON.stringify({
        enabled: formData.get("enabled") === "on",
        isDefault: formData.get("isDefault") === "on",
        priority: Number(formData.get("priority")),
        // Credentials are write-only. Omitting them preserves the sealed value.
        ...(rawCredentials ? { credentials } : {}),
      }),
    });
    revalidatePath("/payment-providers");
    return { message: "Provider updated." };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteProvider(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await apiFetch(`/v1/payment-providers/${String(formData.get("configId"))}`, {
      method: "DELETE",
    });
    revalidatePath("/payment-providers");
    return { message: "Provider removed." };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Hold a subscription on the price it is on, or let it go.
 *
 * The default is that everyone rolls forward onto the current version of their
 * price at their next renewal. Pinning is the exception, for the customer who
 * was promised the rate they signed up on.
 */
export async function setPricePinned(formData: FormData): Promise<void> {
  const subscriptionId = String(formData.get("subscriptionId"));
  const pinned = formData.get("pinned") === "true";

  await apiFetch(`/v1/subscriptions/${subscriptionId}/pin-price`, {
    method: "POST",
    body: JSON.stringify({ pinned }),
  }).catch(() => undefined);

  revalidatePath("/subscriptions");
  revalidatePath(`/subscriptions/${subscriptionId}`);
}

export async function testProvider(formData: FormData): Promise<void> {
  await apiFetch(`/v1/payment-providers/${String(formData.get("configId"))}/test`, {
    method: "POST",
  }).catch(() => undefined);
  revalidatePath("/payment-providers");
}

export async function cancelSubscription(formData: FormData): Promise<void> {
  await apiFetch(`/v1/subscriptions/${String(formData.get("subscriptionId"))}/cancel`, {
    method: "POST",
    body: JSON.stringify({ atPeriodEnd: formData.get("atPeriodEnd") === "true" }),
  }).catch(() => undefined);
  revalidatePath("/subscriptions");
}

export async function resumeSubscription(formData: FormData): Promise<void> {
  await apiFetch(`/v1/subscriptions/${String(formData.get("subscriptionId"))}/resume`, {
    method: "POST",
    body: JSON.stringify({}),
  }).catch(() => undefined);
  revalidatePath("/subscriptions");
}

export async function retryInvoice(formData: FormData): Promise<void> {
  const invoiceId = String(formData.get("invoiceId"));
  const returnTo = String(formData.get("returnTo") ?? "/invoices");

  try {
    await apiFetch(`/v1/invoices/${invoiceId}/pay`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  } catch (error) {
    revalidatePath("/invoices");
    revalidatePath("/dunning");
    // A thrown redirect propagates past this catch, so it always reaches the
    // caller — the operator sees why the attempt failed instead of a click
    // that silently did nothing.
    redirect(`${returnTo}?problem=${encodeURIComponent(failure(error).error ?? "The payment attempt failed.")}`);
  }

  revalidatePath("/invoices");
  revalidatePath("/dunning");
}

export async function voidInvoice(formData: FormData): Promise<void> {
  await apiFetch(`/v1/invoices/${String(formData.get("invoiceId"))}/void`, {
    method: "POST",
    body: JSON.stringify({}),
  }).catch(() => undefined);
  revalidatePath("/invoices");
}

export async function inviteMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "MEMBER");

  try {
    await apiFetch("/v1/organizations/current/members", {
      method: "POST",
      body: JSON.stringify({ email, name: name || undefined, role }),
    });
    revalidatePath("/settings");
    return { message: `Invited ${email}.` };
  } catch (error) {
    return failure(error);
  }
}

export async function removeMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const memberId = String(formData.get("memberId") ?? "");

  try {
    await apiFetch(`/v1/organizations/current/members/${memberId}`, { method: "DELETE" });
    revalidatePath("/settings");
    return { message: "Removed." };
  } catch (error) {
    return failure(error);
  }
}
