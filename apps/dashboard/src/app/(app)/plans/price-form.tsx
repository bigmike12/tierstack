"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createPrice, type CatalogueState } from "@/actions/catalogue";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Alert } from "./plan-form";

const MODELS = [
  { value: "FLAT_RECURRING", label: "Flat recurring", hint: "One amount every period." },
  { value: "PER_SEAT", label: "Per seat", hint: "The amount is multiplied by the seat count." },
  {
    value: "USAGE_METERED",
    label: "Usage metered",
    hint: "No recurring amount — consumption is billed in arrears.",
  },
  {
    value: "HYBRID",
    label: "Hybrid",
    hint: "A base fee in advance plus metered overage in arrears.",
  },
];

const INTERVALS = [
  "DAILY",
  "WEEKLY",
  "BI_WEEKLY",
  "MONTHLY",
  "BI_MONTHLY",
  "QUARTERLY",
  "SEMI_ANNUALLY",
  "ANNUALLY",
  "CUSTOM_DAYS",
];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Adding…" : "Add price"}
    </Button>
  );
}

/**
 * Amounts are entered in major units — 10000 for ₦10,000 — and converted to
 * integer minor units on the server, once. The form never does the arithmetic,
 * because a number typed into a browser and multiplied in JavaScript is exactly
 * how a rounding error reaches an invoice.
 */
export function CreatePriceForm({
  planId,
  currencies,
  meters,
}: {
  planId: string;
  currencies: string[];
  meters: { code: string; name: string; unitLabel: string | null }[];
}) {
  const [state, action] = useActionState<CatalogueState, FormData>(createPrice, {});
  const [model, setModel] = useState(state.values?.model ?? "FLAT_RECURRING");
  const [interval, setInterval] = useState(state.values?.interval ?? "MONTHLY");

  const metered = model === "USAGE_METERED" || model === "HYBRID";
  const hasRecurringAmount = model !== "USAGE_METERED";
  const modelHint = MODELS.find((entry) => entry.value === model)?.hint;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="planId" value={planId} />
      <Alert state={state} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Price code" hint="Unique within the plan.">
          <Input name="code" required placeholder="growth-monthly-ngn" defaultValue={state.values?.code} />
        </Field>
        <Field label="Nickname" hint="Optional, for your own reference.">
          <Input name="nickname" placeholder="Monthly, Naira" defaultValue={state.values?.nickname} />
        </Field>
      </div>

      <Field label="Pricing model" hint={modelHint}>
        <Select name="model" value={model} onChange={(event) => setModel(event.target.value)}>
          {MODELS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Currency">
          <Select name="currency" defaultValue={state.values?.currency ?? currencies[0]}>
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </Field>

        {hasRecurringAmount ? (
          <Field
            label={model === "PER_SEAT" ? "Amount per seat" : "Recurring amount"}
            hint="In major units — 10000 means ten thousand, not ten thousand kobo."
          >
            <Input
              name="amount"
              required
              inputMode="decimal"
              pattern="[0-9]+([.][0-9]+)?"
              placeholder="10000"
              defaultValue={state.values?.amount}
            />
          </Field>
        ) : (
          <div className="flex items-end pb-1 text-sm text-muted-foreground">
            A usage-metered price has no recurring amount.
          </div>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Billing interval">
          <Select name="interval" value={interval} onChange={(event) => setInterval(event.target.value)}>
            {INTERVALS.map((entry) => (
              <option key={entry} value={entry}>
                {entry.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>

        {interval === "CUSTOM_DAYS" ? (
          <Field label="Days per period">
            <Input
              name="intervalDays"
              required
              type="number"
              min={1}
              max={3650}
              placeholder="45"
              defaultValue={state.values?.intervalDays}
            />
          </Field>
        ) : null}

        <Field label="Trial days" hint="Blank for no trial.">
          <Input name="trialDays" type="number" min={0} max={365} defaultValue={state.values?.trialDays} />
        </Field>
      </div>

      {metered ? (
        <fieldset className="space-y-5 rounded-md border border-border p-4">
          <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Metered charge
          </legend>

          {meters.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No usage meters exist yet. Create one with <code className="font-mono">POST /v1/usage-meters</code>{" "}
              before pricing against consumption — a metered price with no meter can never be billed, so the
              API rejects it rather than accepting a price that quietly charges nothing.
            </p>
          ) : (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Meter">
                  <Select name="usageMeterCode" defaultValue={state.values?.usageMeterCode ?? meters[0]?.code}>
                    {meters.map((meter) => (
                      <option key={meter.code} value={meter.code}>
                        {meter.name} ({meter.code})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Rate per block" hint="In major units, charged per block below.">
                  <Input
                    name="usageAmount"
                    inputMode="decimal"
                    pattern="[0-9]+([.][0-9]+)?"
                    placeholder="50"
                    defaultValue={state.values?.usageAmount}
                  />
                </Field>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Block size"
                  hint="Units per billed block. A started block bills in full, so 1000 means 1001 units costs two blocks."
                >
                  <Input
                    name="usageUnitSize"
                    type="number"
                    min={1}
                    placeholder="1000"
                    defaultValue={state.values?.usageUnitSize ?? "1"}
                  />
                </Field>
                <Field label="Included units" hint="The allowance before overage starts. Blank means none.">
                  <Input
                    name="includedUnits"
                    type="number"
                    min={0}
                    placeholder="100000"
                    defaultValue={state.values?.includedUnits}
                  />
                </Field>
              </div>
            </>
          )}
        </fieldset>
      ) : null}

      <div className="flex items-center gap-3">
        <Submit />
        <p className="text-xs text-muted-foreground">
          Amounts cannot be edited afterwards — an existing subscriber is bound to the price they signed up
          on. Add a new price and change them onto it instead.
        </p>
      </div>
    </form>
  );
}
