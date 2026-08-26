"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createPrice, updatePrice, type CatalogueState } from "@/actions/catalogue";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import type { Price } from "@/lib/types";
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

function Submit({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (editing ? "Saving…" : "Adding…") : editing ? "Save price" : "Add price"}
    </Button>
  );
}

function intervalFor(price: Price): string {
  const key = `${price.intervalUnit}:${price.intervalCount}`;
  return (
    {
      "DAY:1": "DAILY",
      "WEEK:1": "WEEKLY",
      "WEEK:2": "BI_WEEKLY",
      "MONTH:1": "MONTHLY",
      "MONTH:2": "BI_MONTHLY",
      "MONTH:3": "QUARTERLY",
      "MONTH:6": "SEMI_ANNUALLY",
      "YEAR:1": "ANNUALLY",
    }[key] ?? "CUSTOM_DAYS"
  );
}

function majorAmount(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "";
  // All dashboard-supported currencies currently use two minor digits. Keep
  // this browser component free of the shared package barrel, which also
  // exports Node-only ID helpers.
  const decimals = 2;
  // Integer division and a padded remainder rather than `amount / 100`. The
  // division would be the only place in the codebase where an amount becomes a
  // float, and the rule against that does not stop being worth keeping because
  // this particular one happens to round-trip.
  const factor = 10 ** decimals;
  const whole = Math.trunc(amount / factor);
  const fraction = Math.abs(amount % factor);
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(decimals, "0")}`;
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
  meters: { id?: string; code: string; name: string; unitLabel: string | null }[];
}) {
  return <PriceForm planId={planId} currencies={currencies} meters={meters} />;
}

export function EditPriceForm({
  planId,
  price,
  currencies,
  meters,
  subscribers,
}: {
  planId: string;
  price: Price;
  currencies: string[];
  meters: { id?: string; code: string; name: string; unitLabel: string | null }[];
  /** Live subscriptions bound to this price — what decides edit vs. version. */
  subscribers: number;
}) {
  return (
    <PriceForm
      planId={planId}
      price={price}
      currencies={currencies}
      meters={meters}
      subscribers={subscribers}
    />
  );
}

function PriceForm({
  planId,
  price,
  currencies,
  meters,
  subscribers = 0,
}: {
  planId: string;
  price?: Price;
  currencies: string[];
  meters: { id?: string; code: string; name: string; unitLabel: string | null }[];
  subscribers?: number;
}) {
  const editing = Boolean(price);
  const versioned = editing && subscribers > 0;
  const [state, action] = useActionState<CatalogueState, FormData>(editing ? updatePrice : createPrice, {});
  const initialInterval = price ? intervalFor(price) : "MONTHLY";
  const [model, setModel] = useState(state.values?.model ?? price?.model ?? "FLAT_RECURRING");
  const [interval, setInterval] = useState(state.values?.interval ?? initialInterval);

  const metered = model === "USAGE_METERED" || model === "HYBRID";
  const hasRecurringAmount = model !== "USAGE_METERED";
  const modelHint = MODELS.find((entry) => entry.value === model)?.hint;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="planId" value={planId} />
      {price ? <input type="hidden" name="priceId" value={price.id} /> : null}
      <Alert state={state} />

      {editing ? (
        versioned ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            {subscribers} live subscription{subscribers === 1 ? "" : "s"} on this price. Changing the amount
            or metering publishes <strong>version {(price?.version ?? 1) + 1}</strong> and archives this one.
            Nobody is repriced mid-period — the period they are in was already invoiced — but each of them
            moves to the new amount at their <strong>next renewal</strong>. Pin a subscription from its own
            page to hold that customer on what they signed up for. Nickname, trial length and the active flag
            save in place.
          </p>
        ) : (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Nobody is subscribed to this price, so every field saves in place.
          </p>
        )
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        {price ? (
          <Field label="Price code" hint="Immutable — integrations can reference it.">
            <Input value={price.code} disabled />
          </Field>
        ) : (
          <Field label="Price code" hint="Unique within the plan.">
            <Input name="code" required placeholder="growth-monthly-ngn" defaultValue={state.values?.code} />
          </Field>
        )}
        <Field label="Nickname" hint="Optional, for your own reference.">
          <Input name="nickname" placeholder="Monthly, Naira" defaultValue={state.values?.nickname ?? price?.nickname ?? ""} />
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
        <Field
          label="Currency"
          hint={versioned ? "Add a separate price for another currency." : undefined}
        >
          {versioned ? <input type="hidden" name="currency" value={price?.currency ?? ""} /> : null}
          <Select
            name={versioned ? undefined : "currency"}
            defaultValue={state.values?.currency ?? price?.currency ?? currencies[0]}
            disabled={versioned}
          >
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
              defaultValue={state.values?.amount ?? majorAmount(price?.unitAmount)}
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
              defaultValue={state.values?.intervalDays ?? (price?.intervalUnit === "DAY" && price.intervalCount > 1 ? String(price.intervalCount) : "")}
            />
          </Field>
        ) : null}

        <Field label="Trial days" hint="Blank for no trial.">
          <Input name="trialDays" type="number" min={0} max={365} defaultValue={state.values?.trialDays ?? (price?.trialDays?.toString() ?? "")} />
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
                  <Select name="usageMeterCode" defaultValue={state.values?.usageMeterCode ?? meters.find((meter) => meter.id === price?.usageMeterId)?.code ?? meters[0]?.code}>
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
                    defaultValue={state.values?.usageAmount ?? majorAmount(price?.usageUnitAmount)}
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
                    defaultValue={state.values?.usageUnitSize ?? (price?.usageUnitSize?.toString() ?? "1")}
                  />
                </Field>
                <Field label="Included units" hint="The allowance before overage starts. Blank means none.">
                  <Input
                    name="includedUnits"
                    type="number"
                    min={0}
                    placeholder="100000"
                    defaultValue={state.values?.includedUnits ?? (price?.includedUnits?.toString() ?? "")}
                  />
                </Field>
              </div>
            </>
          )}
        </fieldset>
      ) : null}

      <div className="flex items-center gap-3">
        <Submit editing={editing} />
        <p className="text-xs text-muted-foreground">
          {editing
            ? versioned
              ? "Changing the billing interval is the exception: it will not roll anyone forward on its own, because moving somebody from monthly to annual is a plan change, not a price rise."
              : "Once someone subscribes, editing what they pay publishes a new version that takes effect at their next renewal."
            : "You can edit this later. Once someone is subscribed, an edit publishes a new version that takes effect at their next renewal."}
        </p>
      </div>
    </form>
  );
}
