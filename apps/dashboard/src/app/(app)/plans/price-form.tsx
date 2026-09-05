"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createPrice, updatePrice, type CatalogueState } from "@/actions/catalogue";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ActionToast } from "@/components/ui/toast";
import type { Price } from "@/lib/types";

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

/**
 * What one billing period is called, for the cap's label. The cap is stored per
 * period, so an annual price must say "per year" — a merchant who reads "per
 * month" on an annual price and types 50,000 has capped a year at that, not a
 * month, and would not find out until the first invoice.
 */
const CAP_PERIODS: Record<string, string> = {
  DAILY: "day",
  WEEKLY: "week",
  BI_WEEKLY: "2 weeks",
  MONTHLY: "month",
  BI_MONTHLY: "2 months",
  QUARTERLY: "quarter",
  SEMI_ANNUALLY: "6 months",
  ANNUALLY: "year",
  CUSTOM_DAYS: "billing period",
};

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

/** Whether a price already carries the percentage display hint. */
function readsAsPercentage(metadata: Record<string, unknown> | null | undefined): boolean {
  const hint = metadata?.usageDisplay as { kind?: unknown } | undefined;
  return hint?.kind === "PERCENTAGE";
}

/**
 * The rate a block pair works out to, for the readout under the checkbox.
 *
 * Presentation only — the server recomputes nothing from this, and the invoice
 * derives its own percentage from the stored minor-unit values. It exists so a
 * merchant who means 2.5% and types the wrong pair sees that before saving,
 * rather than on the first invoice of the month.
 */
function derivePercentage(rate: string, blockSize: string): string | null {
  const amount = Number.parseFloat(rate);
  const size = Number.parseFloat(blockSize);
  if (!Number.isFinite(amount) || !Number.isFinite(size) || size <= 0 || amount <= 0) return null;
  const percent = (amount / size) * 100;
  if (percent > 100) return null;
  return `${Number(percent.toFixed(4))}%`;
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

  // A percentage fee is an ordinary block price whose meter counts money: at
  // 2.5% the rate is 1 per 40 units of volume. Only the invoice wording differs,
  // so this is a display flag rather than a fifth pricing model — but the flag
  // has to be set somewhere, and a merchant should not have to PATCH metadata
  // to get an invoice that says "2.5%" instead of "85,000 × 40".
  const [percentage, setPercentage] = useState(
    state.values?.percentageFee === "on" || readsAsPercentage(price?.metadata)
  );
  const [rate, setRate] = useState(state.values?.usageAmount ?? majorAmount(price?.usageUnitAmount));
  const [blockSize, setBlockSize] = useState(
    state.values?.usageUnitSize ?? (price?.usageUnitSize?.toString() ?? "1")
  );
  const derivedRate = percentage ? derivePercentage(rate, blockSize) : null;

  // The cap covers one billing period. On a monthly price that is what anyone
  // means by "capped at ₦50,000 a month"; on an annual one it is emphatically
  // not, so the label names the interval on screen rather than leaving the
  // merchant to assume and be wrong by a factor of twelve.
  const [capped, setCapped] = useState(
    state.values?.usageCapped === "on" || (price?.usageMaxAmount ?? null) !== null
  );
  const capPeriod = CAP_PERIODS[interval] ?? "period";

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="planId" value={planId} />
      {price ? <input type="hidden" name="priceId" value={price.id} /> : null}
      <ActionToast state={state} />

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
              No usage meters exist yet.{" "}
              <Link href="/usage" className="underline underline-offset-4">
                Create one on the Usage page
              </Link>{" "}
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
                    value={rate}
                    onChange={(event) => setRate(event.target.value)}
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
                    value={blockSize}
                    onChange={(event) => setBlockSize(event.target.value)}
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

              <div className="space-y-2 border-t border-border pt-4">
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    name="percentageFee"
                    className="mt-0.5 h-4 w-4 rounded border-border accent-foreground"
                    checked={percentage}
                    onChange={(event) => setPercentage(event.target.checked)}
                  />
                  <span>
                    <span className="font-medium">This meter counts money</span>
                    <span className="block text-xs text-muted-foreground">
                      For percentage fees — a meter recording payment volume rather than a number of
                      things. Invoices read &ldquo;2.5% of ₦3,400,000.00&rdquo; instead of the block
                      arithmetic. It changes the wording only; the amount charged is the same either way.
                    </span>
                  </span>
                </label>
                {percentage ? (
                  <p className="text-xs text-muted-foreground">
                    {derivedRate ? (
                      <>
                        Bills as <strong className="text-foreground">{derivedRate}</strong> of metered
                        volume. Record volume in {price?.currency ?? "major"} units, not minor ones — the
                        units column is a 32-bit integer, so a meter counting kobo overflows on a single
                        large payment.
                      </>
                    ) : (
                      "Set a rate and a block size that work out to the percentage you mean — 1 per 40 is 2.5%."
                    )}
                  </p>
                ) : null}
              </div>

              <div className="space-y-3 border-t border-border pt-4">
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    name="usageCapped"
                    className="mt-0.5 h-4 w-4 rounded border-border accent-foreground"
                    checked={capped}
                    onChange={(event) => setCapped(event.target.checked)}
                  />
                  <span>
                    <span className="font-medium">Cap the metered charge</span>
                    <span className="block text-xs text-muted-foreground">
                      A ceiling on what consumption can cost in one billing period. Usage keeps being
                      recorded past it — only the charge stops rising.
                    </span>
                  </span>
                </label>
                {capped ? (
                  <Field
                    label={`Maximum per ${capPeriod}`}
                    hint={
                      <>
                        In major units, like every other amount on this form. This price bills{" "}
                        {(CAP_PERIODS[interval] ?? "per period") === "billing period"
                          ? "on a custom interval"
                          : `every ${capPeriod}`}
                        , so the cap covers that whole window — not a calendar month.
                      </>
                    }
                  >
                    <Input
                      name="usageMaxAmount"
                      inputMode="decimal"
                      pattern="[0-9]+([.][0-9]+)?"
                      placeholder="50000"
                      defaultValue={state.values?.usageMaxAmount ?? majorAmount(price?.usageMaxAmount)}
                    />
                  </Field>
                ) : null}
              </div>
            </>
          )}
        </fieldset>
      ) : null}
      {/* Metadata is replaced wholesale on update, so the keys the form does not
          manage ride along and come back unchanged. */}
      {editing ? (
        <input type="hidden" name="existingMetadata" value={JSON.stringify(price?.metadata ?? {})} />
      ) : null}

      <div className="flex items-center gap-3">
        <Submit editing={editing} />
        <p className="text-xs text-muted-foreground">
          {editing
            ? versioned
              ? "Changing the billing interval will not move anyone on its own — that is a plan change."
              : "Editing what they pay takes effect at their next renewal."
            : "You can edit this later. Once someone is subscribed, an edit takes effect at their next renewal."}
        </p>
      </div>
    </form>
  );
}
