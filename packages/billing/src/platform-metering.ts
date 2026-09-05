import type { PrismaClient } from "@tierstack/database";
import { assertCurrency, minorUnits, type CurrencyCode } from "@tierstack/shared";
import { trackUsage, MAX_UNITS } from "@tierstack/usage";

/**
 * Feeding collected volume into a meter, so a percentage fee can bill itself.
 *
 * A price can already say "₦5,000 a month plus 2.5% of volume" — that is a
 * HYBRID price whose meter counts money (see `UsageDisplay` in pricing.ts).
 * What it could not do was find out the volume: something had to call
 * `POST /v1/events/track` for every payment, by hand or by script.
 *
 * This is that something, for the one case the platform can answer without
 * being told: **volume it collected itself.**
 *
 * ## Why this is cross-organization, and why that is not a leak
 *
 * The obvious-looking version of this feature — "meter what my own customers
 * pay me" — is circular. What a customer pays a merchant through this platform
 * *is* the merchant's subscription invoice, so a percentage of it would be a
 * percentage of itself. The volume worth metering is always somebody else's:
 * the money organization X collected, billed to X by the organization that
 * resells this platform to them.
 *
 * So the shape is fixed by the problem. One organization — the *platform*
 * organization, named by PLATFORM_ORGANIZATION_ID — has other organizations as
 * its customers, joined by `Customer.externalId`, which already means "the
 * subscriber's own identifier in the caller's system". Here that identifier is
 * an organization id.
 *
 * This is deliberately not creator-specific. Any business reselling
 * subscription infrastructure on a revenue share — a marketplace, a vertical
 * SaaS, a payment facilitator — has exactly this billing relationship, and the
 * creator platform is one instance of it rather than the reason for it.
 *
 * Three properties keep the cross-tenant read honest:
 *
 * 1. **It only ever writes into the platform organization.** No merchant's rows
 *    are touched, so the tenant-isolation invariant holds in the direction that
 *    matters: nobody's data moves anywhere they did not put it.
 * 2. **Enrolment is explicit and manual.** An organization is metered only when
 *    a `Customer` row for it already exists in the platform organization *and*
 *    that customer holds a live subscription on a metered price. Nothing
 *    auto-creates either, so no organization is silently opted in to being
 *    charged.
 * 3. **The platform organization never meters itself.** Its own collections are
 *    the fees it charged; metering them would compound.
 *
 * ## Derived, not emitted
 *
 * Like the notifications job, this reads state rather than firing from inside
 * the transaction that settles a payment. A webhook crediting an invoice should
 * not be holding a row lock while it writes somebody else's usage event, and a
 * failure here must never be able to fail a payment.
 *
 * The cost of deriving is that the job must be safe to run repeatedly, which is
 * what `UsageEvent`'s unique `(organizationId, eventId)` buys. The event id is
 * the `PaymentAttempt` id, so a second pass over the same attempt finds the
 * event already recorded and does nothing. That is also what makes the lookback
 * window below safe.
 */

/**
 * How far back each pass looks.
 *
 * There is no watermark to keep, because the idempotency key makes re-reading
 * free: a pass re-examines a day of settled attempts and writes only the ones
 * that are missing. That is what makes this self-healing — a worker that was
 * down for six hours catches up on its next tick with no operator action and no
 * state to repair, which a watermark column would not give without also being a
 * thing that can be wrong.
 */
export const LOOKBACK_MS = 24 * 3_600_000;

/**
 * Volume in major units — naira, not kobo.
 *
 * `UsageEvent.units` is an int4, so a kobo-denominated meter overflows on a
 * single payment above ₦21.5m; naira gives ₦2.1bn of headroom on one payment,
 * which is past any card transaction that exists. The rounding this costs is at
 * most 50 kobo of *volume* per payment either way, which at 2.5% is at most
 * 1.25 kobo of fee — a fifth of the rounding the block arithmetic already
 * applies once per invoice.
 *
 * Rounding rather than truncating so the error has no direction: flooring every
 * payment would bias the total down on every single one, and a systematic
 * under-count is the kind of thing that is invisible for a year and then has to
 * be explained.
 */
export function volumeUnits(amountMinor: number, currency: CurrencyCode): number {
  return Math.round(amountMinor / 10 ** minorUnits(currency));
}

export interface PlatformMeteringResult {
  /** Organizations enrolled and checked on this pass. */
  considered: number;
  /** Usage events written. A steady state of zero is the expected quiet case. */
  recorded: number;
  /** Attempts already metered by an earlier pass. */
  skipped: number;
  /** Attempts that could not be metered, with the reason. */
  rejected: { attemptId: string; reason: string }[];
}

export interface PlatformMeteringParams {
  /** The organization that bills the others. Nothing runs without one. */
  platformOrganizationId: string;
  now?: Date;
  /** Attempts examined per organization per pass. */
  batchSize?: number;
}

/**
 * Records what each enrolled organization collected, against the meter its own
 * platform subscription bills on.
 *
 * The meter is read from the price rather than being a well-known code, so
 * there is no magic string to keep in step: whatever meter the platform's own
 * HYBRID price bills against is the meter this fills.
 */
export async function runPlatformVolumeMetering(
  prisma: PrismaClient,
  params: PlatformMeteringParams
): Promise<PlatformMeteringResult> {
  const now = params.now ?? new Date();
  const since = new Date(now.getTime() - LOOKBACK_MS);
  const batchSize = params.batchSize ?? 500;

  const result: PlatformMeteringResult = { considered: 0, recorded: 0, skipped: 0, rejected: [] };

  // Enrolment: a customer of the platform, on a live subscription, on a price
  // that actually meters something. A subscription that has lapsed past the
  // point of being served still meters — the fee is owed on money that was
  // collected, and whether the merchant is behind on paying it is the dunning
  // ladder's business rather than this job's.
  const enrolled = await prisma.subscription.findMany({
    where: {
      organizationId: params.platformOrganizationId,
      status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD", "UNPAID"] },
      price: { usageMeterId: { not: null } },
    },
    select: {
      id: true,
      customer: { select: { id: true, externalId: true } },
      price: { select: { currency: true, usageMeter: { select: { code: true, active: true } } } },
    },
  });

  for (const subscription of enrolled) {
    const sourceOrganizationId = subscription.customer.externalId;
    const meterCode = subscription.price.usageMeter?.code;

    // No external id means this customer is not standing in for an
    // organization — an ordinary human customer of the platform, billed for
    // something else. Nothing to meter, and nothing wrong.
    if (!sourceOrganizationId || !meterCode) continue;
    if (!subscription.price.usageMeter?.active) continue;

    // Metering the platform's own collections would compound: those are the
    // fees it just charged for the volume it is about to charge for again.
    if (sourceOrganizationId === params.platformOrganizationId) continue;

    // A meter counts one scalar, so it can only hold one currency. Volume
    // collected in a currency the platform price is not denominated in is not
    // convertible here — this engine has no exchange rate and inventing one
    // would put a guess into an invoice — so it is left out and counted as
    // rejected, where it is visible, rather than silently added to the wrong
    // total.
    const currency = assertCurrency(subscription.price.currency);

    result.considered += 1;

    const settled = await prisma.paymentAttempt.findMany({
      where: {
        organizationId: sourceOrganizationId,
        status: "SUCCEEDED",
        completedAt: { gte: since, lte: now },
      },
      select: { id: true, amount: true, currency: true, completedAt: true },
      orderBy: { completedAt: "asc" },
      take: batchSize,
    });

    for (const attempt of settled) {
      if (attempt.currency !== currency) {
        result.rejected.push({
          attemptId: attempt.id,
          reason: `collected in ${attempt.currency}, metered in ${currency}`,
        });
        continue;
      }

      const units = volumeUnits(attempt.amount, currency);
      if (units > MAX_UNITS) {
        result.rejected.push({ attemptId: attempt.id, reason: "volume exceeds what the meter can hold" });
        continue;
      }
      // A payment smaller than one major unit rounds to nothing. Recording a
      // zero would be honest but pointless, and it would fill the highest-volume
      // table in the schema with rows that can never change a total.
      if (units === 0) continue;

      const tracked = await trackUsage(prisma, {
        organizationId: params.platformOrganizationId,
        customerId: subscription.customer.id,
        meterCode,
        units,
        // The attempt id is the idempotency key, exactly as it is the payment
        // reference everywhere else. Re-reading a settled attempt on the next
        // pass is a no-op rather than a second charge.
        eventId: attempt.id,
        // The event is dated when the money arrived, not when this job noticed.
        // A payment that settles at 23:58 on the last day of a period belongs to
        // that period even if the job runs after midnight, and `getPeriodUsage`
        // filters on exactly this column.
        timestamp: attempt.completedAt ?? now,
        metadata: { source: "platform_volume", sourceOrganizationId, amountMinor: attempt.amount },
      });

      if (tracked.recorded) result.recorded += 1;
      else result.skipped += 1;
    }
  }

  return result;
}
