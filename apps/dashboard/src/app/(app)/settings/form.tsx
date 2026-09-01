"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateBillingSettings, type ActionState } from "@/actions/billing";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ActionToast } from "@/components/ui/toast";
import type { BillingSettings } from "@/lib/types";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save policy"}
    </Button>
  );
}

export function BillingPolicyForm({ settings }: { settings: BillingSettings }) {
  const [state, action] = useActionState<ActionState, FormData>(updateBillingSettings, {});

  return (
    <form action={action} className="space-y-5">
      <ActionToast state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Grace period (days)" hint="How long a failed subscription stays recoverable. Zero means no grace at all.">
          <Input
            name="gracePeriodDays"
            type="number"
            min={0}
            max={365}
            defaultValue={settings.gracePeriodDays}
            required
          />
        </Field>

        <Field label="Access during grace" hint="Whether a customer keeps service while you chase payment.">
          <Select name="accessDuringGracePeriod" defaultValue={settings.accessDuringGracePeriod}>
            <option value="FULL_ACCESS">Full access</option>
            <option value="RESTRICTED_ACCESS">Restricted access</option>
            <option value="NO_ACCESS">No access</option>
          </Select>
        </Field>

        <Field label="Maximum retry attempts">
          <Input
            name="maxRetryAttempts"
            type="number"
            min={0}
            max={20}
            defaultValue={settings.maxRetryAttempts}
            required
          />
        </Field>

        <Field label="Retry schedule" hint="Days after the first failure, comma separated. 0 means immediately.">
          <Input name="retryIntervals" defaultValue={settings.retryIntervals.join(", ")} placeholder="0, 1, 3, 5" />
        </Field>

        <Field label="When recovery fails" hint="Applied when the grace period runs out.">
          <Select name="failureAction" defaultValue={settings.failureAction}>
            <option value="MARK_UNPAID">Mark unpaid</option>
            <option value="CANCEL">Cancel</option>
            <option value="PAUSE">Pause</option>
          </Select>
        </Field>

        <Field label="Invoice due (days)" hint="Zero means due on issue.">
          <Input name="invoiceDueDays" type="number" min={0} max={365} defaultValue={settings.invoiceDueDays} required />
        </Field>

        <Field label="Invoice number prefix" hint="e.g. ACME produces ACME-2026-00001. Blank uses the platform default.">
          <Input name="invoiceNumberPrefix" defaultValue={settings.invoiceNumberPrefix ?? ""} placeholder="INV" maxLength={20} />
        </Field>

        <Field label="Default currency" hint="Used for new invoices and subscriptions unless a price sets its own.">
          <Select name="defaultCurrency" defaultValue={settings.defaultCurrency}>
            <option value="NGN">NGN — Nigerian Naira</option>
            <option value="USD">USD — United States Dollar</option>
            <option value="KES">KES — Kenyan Shilling</option>
            <option value="GHS">GHS — Ghanaian Cedi</option>
            <option value="ZAR">ZAR — South African Rand</option>
          </Select>
        </Field>

        <Field
          label="Abandoned checkout expiry (hours)"
          hint="An unpaid first invoice is voided and its subscription expired after this long. Zero disables it."
        >
          <Input
            name="incompleteExpiryHours"
            type="number"
            min={0}
            max={720}
            defaultValue={settings.incompleteExpiryHours}
            required
          />
        </Field>

        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <Input type="checkbox" name="autoCollect" className="size-4" defaultChecked={settings.autoCollect} />
            Collect automatically when an invoice is finalized
          </label>
        </div>
      </div>

      <fieldset className="mt-6 space-y-5 rounded-md border border-border p-4">
        <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Customer email
        </legend>

        <label className="flex items-center gap-2 text-sm">
          <Input
            type="checkbox"
            name="notificationsEnabled"
            className="size-4"
            defaultChecked={settings.notificationsEnabled}
          />
          Email customers about failed payments, price changes and trials ending
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Price-change notice"
            hint="Days of warning before a new price applies at renewal. A rise a customer learns about from their bank statement is a chargeback."
          >
            <Input
              name="priceChangeNoticeDays"
              type="number"
              min={0}
              max={90}
              defaultValue={settings.priceChangeNoticeDays}
              required
            />
          </Field>
          <Field label="Trial-ending notice" hint="Days of warning before a trial becomes a charge.">
            <Input
              name="trialEndingNoticeDays"
              type="number"
              min={0}
              max={90}
              defaultValue={settings.trialEndingNoticeDays}
              required
            />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Sender name" hint="Who the email appears to be from. Defaults to your organization name.">
            <Input name="senderName" defaultValue={settings.senderName ?? ""} placeholder="Kola Labs" />
          </Field>
          <Field label="Sender address" hint="The from-address itself. Blank uses the platform default.">
            <Input
              name="emailSender"
              type="email"
              defaultValue={settings.emailSender ?? ""}
              placeholder="billing@yourcompany.com"
            />
          </Field>
          <Field label="Support address" hint="Where replies go. Blank means replies come back to the sender.">
            <Input
              name="supportEmail"
              type="email"
              defaultValue={settings.supportEmail ?? ""}
              placeholder="help@yourcompany.com"
            />
          </Field>
        </div>
      </fieldset>

      <Submit />
    </form>
  );
}
