"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BillingError } from "@tierstack/shared";
import { ApiError, apiFetch } from "@/lib/api";

export interface UsageMeterState {
  error?: string;
  message?: string;
  values?: Record<string, string>;
}

function failure(error: unknown, values?: Record<string, string>): UsageMeterState {
  if (error instanceof ApiError || error instanceof BillingError) {
    return { error: error.message, values };
  }
  return { error: "Something went wrong. Check the API logs.", values };
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** Rejects a name or code already used by another meter in the org, rather
 * than silently updating whatever matched — create only ever creates. */
export async function createUsageMeter(
  _prev: UsageMeterState,
  formData: FormData
): Promise<UsageMeterState> {
  const values = {
    code: text(formData, "code"),
    name: text(formData, "name"),
    unitLabel: text(formData, "unitLabel"),
    aggregation: text(formData, "aggregation") || "SUM",
  };

  if (!values.name) return { error: "A meter needs a name.", values };
  if (!values.code) return { error: "A meter needs a code — this is what track events will reference.", values };

  try {
    await apiFetch("/v1/usage-meters", {
      method: "POST",
      body: JSON.stringify({
        code: values.code,
        name: values.name,
        unitLabel: values.unitLabel || undefined,
        aggregation: values.aggregation,
      }),
    });
  } catch (error) {
    return failure(error, values);
  }

  revalidatePath("/usage");
  revalidatePath("/plans");
  return { message: `Meter "${values.code}" created.` };
}

export async function updateUsageMeter(
  _prev: UsageMeterState,
  formData: FormData
): Promise<UsageMeterState> {
  const meterId = text(formData, "meterId");
  const values = {
    name: text(formData, "name"),
    unitLabel: text(formData, "unitLabel"),
    aggregation: text(formData, "aggregation") || "SUM",
  };

  if (!values.name) return { error: "A meter needs a name.", values };

  try {
    await apiFetch(`/v1/usage-meters/${meterId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: values.name,
        unitLabel: values.unitLabel || null,
        aggregation: values.aggregation,
      }),
    });
  } catch (error) {
    return failure(error, values);
  }

  revalidatePath("/usage");
  revalidatePath("/plans");
  redirect("/usage?meterUpdated=1");
}

export async function setMeterActive(_prev: UsageMeterState, formData: FormData): Promise<UsageMeterState> {
  const meterId = text(formData, "meterId");
  const active = formData.get("active") === "true";

  try {
    await apiFetch(`/v1/usage-meters/${meterId}`, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath("/usage");
  revalidatePath("/plans");
  return { message: active ? "Meter restored." : "Meter archived." };
}

export async function deleteUsageMeter(_prev: UsageMeterState, formData: FormData): Promise<UsageMeterState> {
  const meterId = text(formData, "meterId");

  try {
    await apiFetch(`/v1/usage-meters/${meterId}`, { method: "DELETE" });
  } catch (error) {
    return failure(error);
  }

  revalidatePath("/usage");
  revalidatePath("/plans");
  redirect("/usage?meterDeleted=1");
}
