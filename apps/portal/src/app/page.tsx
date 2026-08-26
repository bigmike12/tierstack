import { redirect } from "next/navigation";
import { cancelSubscription, keepSubscription, payInvoice } from "./actions";
import { portalFetch, PortalError } from "@/lib/api";
import { day, interval, money } from "@/lib/format";
import type { PortalOverview, PortalSubscription } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<PortalSubscription["status"], { label: string; tone: string }> = {
  INCOMPLETE: { label: "Awaiting first payment", tone: "text-warn" },
  TRIALING: { label: "Trial", tone: "text-ink" },
  ACTIVE: { label: "Active", tone: "text-good" },
  PAST_DUE: { label: "Payment overdue", tone: "text-danger" },
  GRACE_PERIOD: { label: "Payment overdue", tone: "text-danger" },
  PAUSED: { label: "Paused", tone: "text-muted" },
  UNPAID: { label: "Unpaid", tone: "text-danger" },
  CANCELED: { label: "Cancelled", tone: "text-muted" },
  EXPIRED: { label: "Ended", tone: "text-muted" },
};

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string; done?: string }>;
}) {
  const { problem, done } = await searchParams;

  let overview: PortalOverview;
  try {
    overview = await portalFetch<PortalOverview>("/portal/v1/overview");
  } catch (error) {
    // Two different situations, and telling somebody their link expired when
    // they never had one sends them looking for an email that does not exist.
    if (error instanceof PortalError && error.code === "PORTAL_LINK_EXPIRED") redirect("/expired");
    if (error instanceof PortalError && error.status === 401) redirect("/no-link");
    throw error;
  }

  const outstanding = overview.invoices.filter(
    (invoice) => invoice.status === "OPEN" && invoice.amountDue > 0
  );
  const owed = outstanding.reduce((total, invoice) => total + invoice.amountDue, 0);
  const currency = outstanding[0]?.currency ?? overview.subscriptions[0]?.price.currency ?? "NGN";
  const card = overview.paymentMethods.find((method) => method.isDefault) ?? overview.paymentMethods[0];

  return (
    <main className="space-y-4">
      <header className="pb-2">
        <p className="text-sm text-muted">{overview.merchant.name}</p>
        <h1 className="mt-1 text-xl font-semibold">Your billing</h1>
      </header>

      {done === "canceled" ? (
        <Notice tone="warn">
          Your subscription will end when the current period does. You keep access until then.
        </Notice>
      ) : null}
      {done === "kept" ? <Notice tone="good">Your subscription will continue as normal.</Notice> : null}
      {problem ? (
        <Notice tone="danger">
          That did not work. {problem === "INVOICE_ALREADY_PAID" ? "This invoice is already paid." : "Try again, or contact support."}
        </Notice>
      ) : null}

      {/* The reason most people are here, so it goes first and says one number. */}
      {owed > 0 ? (
        <section className="rounded-lg border border-danger/30 bg-surface p-5">
          <h2 className="text-base font-semibold">You have {money(owed, currency)} outstanding</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {outstanding.length === 1
              ? "One invoice has not been paid. Paying it restores your subscription straight away."
              : `${outstanding.length} invoices have not been paid.`}
          </p>
          <div className="mt-4 space-y-2">
            {outstanding.map((invoice) => (
              <form
                key={invoice.id}
                action={payInvoice}
                className="flex items-center justify-between gap-4 rounded-md border border-line px-3 py-2.5"
              >
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <span className="text-sm">
                  <span className="font-mono text-xs text-muted">{invoice.invoiceNumber}</span>
                  <span className="tabular ml-3 font-medium">
                    {money(invoice.amountDue, invoice.currency)}
                  </span>
                </span>
                <button
                  type="submit"
                  className="rounded-md bg-ink px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
                >
                  Pay now
                </button>
              </form>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            You can pay with a different card — you do not have to use the one that failed.
          </p>
        </section>
      ) : null}

      {overview.subscriptions.length === 0 ? (
        <section className="rounded-lg border border-line bg-surface p-5">
          <p className="text-sm text-muted">You have no subscriptions.</p>
        </section>
      ) : null}

      {overview.subscriptions.map((subscription) => {
        const status = STATUS_COPY[subscription.status];
        const amount =
          subscription.price.unitAmount === null
            ? null
            : money(
                subscription.price.unitAmount * (subscription.price.model === "PER_SEAT" ? subscription.quantity : 1),
                subscription.price.currency
              );
        const ended = subscription.status === "CANCELED" || subscription.status === "EXPIRED";
        const overdue =
          subscription.status === "PAST_DUE" ||
          subscription.status === "GRACE_PERIOD" ||
          subscription.status === "UNPAID";

        return (
          <section key={subscription.id} className="rounded-lg border border-line bg-surface p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">{subscription.price.plan.name}</h2>
                <p className={`mt-0.5 text-sm ${status.tone}`}>{status.label}</p>
              </div>
              {amount ? (
                <p className="tabular text-right text-sm">
                  <span className="font-medium">{amount}</span>
                  <span className="block text-xs text-muted">
                    {interval(subscription.price.intervalUnit, subscription.price.intervalCount)}
                  </span>
                </p>
              ) : null}
            </div>

            <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
              {subscription.status === "TRIALING" && subscription.trialEnd ? (
                <Row label="Trial ends" value={day(subscription.trialEnd)} />
              ) : null}
              {/*
                A customer whose payment has failed does not care when the next
                charge is; they care how long they have. Show the deadline that
                is actually operating on them.
              */}
              {!ended && overdue && subscription.gracePeriodEnd ? (
                <Row label="Access ends" value={day(subscription.gracePeriodEnd)} />
              ) : !ended ? (
                <Row
                  label={subscription.cancelAtPeriodEnd ? "Access ends" : "Next charge"}
                  value={day(subscription.currentPeriodEnd)}
                />
              ) : null}
              {subscription.price.model === "PER_SEAT" ? (
                <Row label="Seats" value={String(subscription.quantity)} />
              ) : null}
            </dl>

            {subscription.cancelAtPeriodEnd && !ended ? (
              <form action={keepSubscription} className="mt-4 border-t border-line pt-4">
                <input type="hidden" name="subscriptionId" value={subscription.id} />
                <p className="text-sm text-muted">
                  This subscription is set to end on {day(subscription.currentPeriodEnd)}.
                </p>
                <button
                  type="submit"
                  className="mt-2 rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-canvas"
                >
                  Keep my subscription
                </button>
              </form>
            ) : null}

            {!subscription.cancelAtPeriodEnd && !ended ? (
              <form action={cancelSubscription} className="mt-4 border-t border-line pt-4">
                <input type="hidden" name="subscriptionId" value={subscription.id} />
                <button
                  type="submit"
                  className="text-sm text-muted underline underline-offset-4 hover:text-ink"
                >
                  Cancel subscription
                </button>
                <span className="ml-2 text-xs text-muted">
                  You keep access until {day(subscription.currentPeriodEnd)}.
                </span>
              </form>
            ) : null}
          </section>
        );
      })}

      <section className="rounded-lg border border-line bg-surface p-5">
        <h2 className="text-base font-semibold">Payment method</h2>
        {card ? (
          <p className="mt-2 text-sm">
            {(card.brand ?? card.type).toUpperCase()} ending {card.last4 ?? "????"}
            {card.expMonth && card.expYear
              ? ` · expires ${String(card.expMonth).padStart(2, "0")}/${card.expYear}`
              : ""}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">No card saved.</p>
        )}
        <p className="mt-2 text-xs text-muted">
          Paying with a different card saves it for next time.
        </p>
      </section>

      {overview.invoices.length > 0 ? (
        <section className="rounded-lg border border-line bg-surface p-5">
          <h2 className="text-base font-semibold">Invoices</h2>
          <ul className="mt-3 divide-y divide-line text-sm">
            {overview.invoices.map((invoice) => (
              <li key={invoice.id} className="flex items-center justify-between gap-4 py-2.5">
                <span>
                  <span className="font-mono text-xs text-muted">{invoice.invoiceNumber}</span>
                  <span className="block text-xs text-muted">
                    {day(invoice.paidAt ?? invoice.finalizedAt ?? invoice.createdAt)}
                  </span>
                </span>
                <span className="tabular text-right">
                  {money(invoice.total, invoice.currency)}
                  <span
                    className={`block text-xs ${
                      invoice.status === "PAID"
                        ? "text-good"
                        : invoice.status === "OPEN"
                          ? "text-danger"
                          : "text-muted"
                    }`}
                  >
                    {invoice.status === "PAID"
                      ? "Paid"
                      : invoice.status === "OPEN"
                        ? "Unpaid"
                        : invoice.status === "VOID"
                          ? "Cancelled"
                          : invoice.status.toLowerCase()}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="pt-2 text-xs text-muted">
        {overview.merchant.supportEmail ? (
          <>
            Questions? Email{" "}
            <a href={`mailto:${overview.merchant.supportEmail}`} className="underline underline-offset-4">
              {overview.merchant.supportEmail}
            </a>
            .
          </>
        ) : (
          "Questions? Reply to any billing email."
        )}
        {overview.returnUrl ? (
          <>
            {" · "}
            <a href={overview.returnUrl} className="underline underline-offset-4">
              Back to {overview.merchant.name}
            </a>
          </>
        ) : null}
      </footer>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

function Notice({ tone, children }: { tone: "good" | "warn" | "danger"; children: React.ReactNode }) {
  const border = tone === "good" ? "border-good/30" : tone === "warn" ? "border-warn/30" : "border-danger/30";
  return (
    <p className={`rounded-md border ${border} bg-surface px-4 py-3 text-sm`}>{children}</p>
  );
}
