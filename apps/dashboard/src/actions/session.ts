"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiFetch, apiPostRaw, ORG_COOKIE, SESSION_COOKIE } from "@/lib/api";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * The API sets its own session cookie; the dashboard re-issues it on its own
 * origin so every subsequent request is same-origin and no CORS credential
 * dance is needed.
 */
async function persistSession(setCookie: string | null): Promise<void> {
  if (!setCookie) return;
  const value = setCookie.split(";")[0]?.split("=").slice(1).join("=");
  if (!value) return;
  const store = await cookies();
  store.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const payload = {
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    organizationName: String(formData.get("organizationName") ?? "").trim(),
  };

  if (payload.password.length < 12) {
    return { fieldErrors: { password: "Use at least 12 characters." } };
  }

  const { envelope, setCookie, ok } = await apiPostRaw("/v1/auth/register", payload);
  if (!ok || envelope.error) {
    return { error: envelope.error?.message ?? "Could not create the account." };
  }

  await persistSession(setCookie);
  const data = envelope.data as { organization: { id: string } };
  const store = await cookies();
  store.set(ORG_COOKIE, data.organization.id, { sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/overview");
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const payload = {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };

  const { envelope, setCookie, ok } = await apiPostRaw("/v1/auth/login", payload);
  if (!ok || envelope.error) {
    return { error: envelope.error?.message ?? "Could not sign in." };
  }

  await persistSession(setCookie);
  const data = envelope.data as { organizations: { id: string }[] };
  const first = data.organizations[0];
  if (first) {
    const store = await cookies();
    store.set(ORG_COOKIE, first.id, { sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  redirect("/overview");
}

export async function logoutAction(): Promise<void> {
  await apiFetch("/v1/auth/logout", { method: "POST" }).catch(() => undefined);
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(ORG_COOKIE);
  redirect("/login");
}

export async function switchOrganization(organizationId: string): Promise<void> {
  const store = await cookies();
  store.set(ORG_COOKIE, organizationId, { sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/overview");
}
