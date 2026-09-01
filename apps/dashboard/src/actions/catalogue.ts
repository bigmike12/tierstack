"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BillingError, parseMoney } from "@tierstack/shared";
import { ApiError, apiFetch } from "@/lib/api";

export interface CatalogueState {
  error?: string;
  message?: string;
  /** Echoed back so a rejected form does not lose what was typed. */
  values?: Record<string, string>;
}

function failure(error: unknown, values?: Record<string, string>): CatalogueState {
  if (error instanceof ApiError || error instanceof BillingError) {
    return { error: error.message, values };
  }
  return { error: "Something went wrong. Check the API logs.", values };
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/**
 * Feature flags are typed by what they look like, which is the same rule the
 * entitlement resolver applies: a number is a limit, `unlimited` removes the
 * ceiling, `true`/`false` toggles the feature, anything else is a string.
 */
function parseFeatures(raw: string): Record<string, boolean | number | string> {
  const features: Record<string, boolean | number | string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      // A bare key is the common case for an on/off feature.
      features[trimmed] = true;
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!key) continue;

    if (value === "true" || value === "") features[key] = true;
    else if (value === "false") features[key] = false;
    else if (/^\d+$/.test(value)) features[key] = Number.parseInt(value, 10);
    else features[key] = value;
  }
  return features;
}

export async function createPlan(_prev: CatalogueState, formData: FormData): Promise<CatalogueState> {
  const values = {
    code: text(formData, "code"),
    name: text(formData, "name"),
    description: text(formData, "description"),
    features: text(formData, "features"),
  };

  if (!values.name) return { error: "A plan needs a name.", values };
  if (!values.code) return { error: "A plan needs a code — this is what your API calls will use.", values };

  let planId: string;
  try {
    const plan = await apiFetch<{ id: string }>("/v1/plans", {
      method: "POST",
      body: JSON.stringify({
        code: values.code,
        name: values.name,
        description: values.description || undefined,
        features: parseFeatures(values.features),
      }),
    });
    planId = plan.id;
  } catch (error) {
    return failure(error, values);
  }

  revalidatePath("/plans");
  revalidatePath("/entitlements");
  // A plan with no price cannot be subscribed to, so land on the detail page
  // where the next step — adding a price — is the obvious thing to do.
  redirect(`/plans/${planId}?created=1`);
}

export async function updatePlan(_prev: CatalogueState, formData: FormData): Promise<CatalogueState> {
  const planId = text(formData, "planId");
  const values = {
    name: text(formData, "name"),
    description: text(formData, "description"),
    features: text(formData, "features"),
  };

  try {
    await apiFetch(`/v1/plans/${planId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: values.name,
        description: values.description || undefined,
        features: parseFeatures(values.features),
      }),
    });
  } catch (error) {
    return failure(error, values);
  }

  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  revalidatePath("/entitlements");
  return { message: "Plan saved. Existing subscribers see the new feature flags immediately." };
}

/**
 * Creating a price. The form collects major units — nobody types 1000000 for
 * ₦10,000 — and this converts once, here, with the same integer parser the
 * billing engine uses. No float ever touches an amount.
 */
export async function createPrice(_prev: CatalogueState, formData: FormData): Promise<CatalogueState> {
  const planId = text(formData, "planId");
  const model = text(formData, "model") || "FLAT_RECURRING";
  const currency = text(formData, "currency") || "NGN";

  const values: Record<string, string> = {
    code: text(formData, "code"),
    nickname: text(formData, "nickname"),
    model,
    currency,
    amount: text(formData, "amount"),
    interval: text(formData, "interval") || "MONTHLY",
    intervalDays: text(formData, "intervalDays"),
    trialDays: text(formData, "trialDays"),
    usageMeterCode: text(formData, "usageMeterCode"),
    usageAmount: text(formData, "usageAmount"),
    usageUnitSize: text(formData, "usageUnitSize"),
    includedUnits: text(formData, "includedUnits"),
  };

  if (!values.code) return { error: "A price needs a code.", values };

  const body: Record<string, unknown> = {
    planId,
    code: values.code,
    nickname: values.nickname || undefined,
    model,
    currency,
    interval: values.interval,
    ...(values.interval === "CUSTOM_DAYS" && values.intervalDays
      ? { intervalDays: Number.parseInt(values.intervalDays, 10) }
      : {}),
    ...(values.trialDays ? { trialDays: Number.parseInt(values.trialDays, 10) } : {}),
  };

  try {
    // USAGE_METERED has no recurring amount at all; every other model must have
    // one, even if it is zero.
    if (model !== "USAGE_METERED") {
      if (!values.amount) {
        return { error: "This pricing model needs a recurring amount.", values };
      }
      body.unitAmount = parseMoney(values.amount, currency).amount;
    }

    if (model === "USAGE_METERED" || model === "HYBRID") {
      if (!values.usageMeterCode) {
        return { error: "A metered price must name the meter it bills against.", values };
      }
      if (!values.usageAmount) {
        return { error: "A metered price needs a rate per block, or it can never be billed.", values };
      }
      body.usageMeterCode = values.usageMeterCode;
      body.usageUnitAmount = parseMoney(values.usageAmount, currency).amount;
      body.usageUnitSize = values.usageUnitSize ? Number.parseInt(values.usageUnitSize, 10) : 1;
      if (values.includedUnits) body.includedUnits = Number.parseInt(values.includedUnits, 10);
    }
  } catch (error) {
    return failure(error, values);
  }

  try {
    await apiFetch("/v1/prices", { method: "POST", body: JSON.stringify(body) });
  } catch (error) {
    return failure(error, values);
  }

  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  return { message: `Price ${values.code} added.` };
}

/** Updates the billable details of an existing price. Amounts enter the form in
 * major units and are converted here, exactly as they are when a price is made. */
export async function updatePrice(_prev: CatalogueState, formData: FormData): Promise<CatalogueState> {
  const priceId = text(formData, "priceId");
  const planId = text(formData, "planId");
  const model = text(formData, "model") || "FLAT_RECURRING";
  const currency = text(formData, "currency") || "NGN";
  const values: Record<string, string> = {
    nickname: text(formData, "nickname"),
    model,
    currency,
    amount: text(formData, "amount"),
    interval: text(formData, "interval") || "MONTHLY",
    intervalDays: text(formData, "intervalDays"),
    trialDays: text(formData, "trialDays"),
    usageMeterCode: text(formData, "usageMeterCode"),
    usageAmount: text(formData, "usageAmount"),
    usageUnitSize: text(formData, "usageUnitSize"),
    includedUnits: text(formData, "includedUnits"),
  };
  const metered = model === "USAGE_METERED" || model === "HYBRID";
  const body: Record<string, unknown> = {
    nickname: values.nickname || null,
    model,
    currency,
    interval: values.interval,
    intervalDays: values.interval === "CUSTOM_DAYS" ? Number.parseInt(values.intervalDays, 10) : undefined,
    trialDays: values.trialDays ? Number.parseInt(values.trialDays, 10) : null,
  };

  try {
    if (model !== "USAGE_METERED") {
      if (!values.amount) return { error: "This pricing model needs a recurring amount.", values };
      body.unitAmount = parseMoney(values.amount, currency).amount;
    } else {
      body.unitAmount = null;
    }

    if (metered) {
      if (!values.usageMeterCode) return { error: "A metered price must name the meter it bills against.", values };
      if (!values.usageAmount) return { error: "A metered price needs a rate per block.", values };
      body.usageMeterCode = values.usageMeterCode;
      body.usageUnitAmount = parseMoney(values.usageAmount, currency).amount;
      body.usageUnitSize = values.usageUnitSize ? Number.parseInt(values.usageUnitSize, 10) : 1;
      body.includedUnits = values.includedUnits ? Number.parseInt(values.includedUnits, 10) : null;
    } else {
      body.usageMeterCode = null;
      body.usageUnitAmount = null;
      body.usageUnitSize = null;
      body.includedUnits = null;
    }
  } catch (error) {
    return failure(error, values);
  }

  let result: {
    id: string;
    supersededPriceId?: string | null;
    subscribersRetained?: number;
  };
  try {
    result = await apiFetch(`/v1/prices/${priceId}`, { method: "PATCH", body: JSON.stringify(body) });
  } catch (error) {
    return failure(error, values);
  }

  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  revalidatePath("/subscriptions");

  // A supersede means the row being edited no longer exists as the current
  // version, so staying on its URL would leave you editing an archived price.
  if (result.supersededPriceId) {
    redirect(`/plans/${planId}/prices/${result.id}/edit?superseded=${result.subscribersRetained ?? 0}`);
  }
  return { message: "Price saved. New billing uses these details." };
}

/**
 * Prices are archived, never deleted: a subscriber is bound to the price row
 * they signed up on, and removing it would orphan their subscription and every
 * invoice already issued against it.
 */
export async function archivePrice(_prev: CatalogueState, formData: FormData): Promise<CatalogueState> {
  const priceId = String(formData.get("priceId"));
  const planId = String(formData.get("planId"));
  const active = formData.get("active") === "true";

  try {
    await apiFetch(`/v1/prices/${priceId}`, { method: "PATCH", body: JSON.stringify({ active }) });
  } catch (error) {
    return failure(error);
  }

  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  return { message: active ? "Price restored." : "Price archived." };
}

export async function setPlanActive(_prev: CatalogueState, formData: FormData): Promise<CatalogueState> {
  const planId = String(formData.get("planId"));
  const active = formData.get("active") === "true";

  try {
    await apiFetch(`/v1/plans/${planId}`, { method: "PATCH", body: JSON.stringify({ active }) });
  } catch (error) {
    return failure(error);
  }

  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  return { message: active ? "Plan restored." : "Plan archived." };
}

/**
 * Deleting a plan can genuinely fail — "3 subscriptions are still active" is
 * something the operator needs to actually see, not a click that silently did
 * nothing, so this reports through CatalogueState rather than swallowing the
 * error the way the archive/restore toggle above does.
 */
export async function deletePlan(_prev: CatalogueState, formData: FormData): Promise<CatalogueState> {
  const planId = String(formData.get("planId"));

  try {
    await apiFetch(`/v1/plans/${planId}`, { method: "DELETE" });
  } catch (error) {
    return failure(error);
  }

  revalidatePath("/plans");
  redirect("/plans?deleted=1");
}
