import type { PrismaClient, TransactionClient } from "@tierstack/database";
import { assertCurrency, minorUnits, newId, type CurrencyCode } from "@tierstack/shared";
import { MAX_UNITS } from "@tierstack/usage";

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
 * The read privilege this grants is real and worth naming: whoever controls
 * PLATFORM_ORGANIZATION_ID can see the settled payment volume of any
 * organization they enrol, simply by writing its id into an `externalId`. That
 * is a **deployment-operator** privilege, not a tenant one — the variable is
 * set in the environment, never through the API — and it is the same authority
 * that already holds every tenant's encrypted provider credentials.
 *
 * ## Two paths, one implementation
 *
 * Correctness and freshness are different problems and are solved separately.
 *
 * - `flushPlatformVolume` runs **inside the renewal transaction**, immediately
 *   before usage is read. It is what makes an invoice right.
 * - `runPlatformVolumeMetering` runs on a schedule and keeps the dashboard
 *   roughly current. It is not load-bearing for any amount.
 *
 * Both go through `meterOrganizationVolume`, so there is one definition of what
 * counts as volume and no way for the two to disagree.
 *
 * ## Derived, not emitted — and how this becomes event-driven later
 *
 * Like the notifications job, this reads state rather than firing from inside
 * the transaction that settles a payment. A webhook crediting an invoice should
 * not be holding a row lock while it writes somebody else's usage event, and a
 * failure here must never be able to fail a payment.
 *
 * The cost of deriving is that it must be safe to run repeatedly, which is what
 * `UsageEvent`'s unique `(organizationId, eventId)` buys. The event id is the
 * `PaymentAttempt` id, so a second pass over the same attempt is a no-op at the
 * database rather than a second charge.
 *
 * That key is also the whole migration path to event-driven processing.
 * `buildVolumeEvents` is pure and takes attempts, not a query: replacing the
 * scan with a queue that delivers settled attempt ids means calling the same
 * function with the same input and writing the same rows. Nothing in the
 * pricing or billing model has to move for that to happen, and until it is
 * worth doing, a scan over an indexed predicate is the cheaper answer.
 */

/**
 * How far back a scheduled pass looks.
 *
 * There is no watermark to keep, because the idempotency key makes re-reading
 * free: a pass re-examines a day of settled attempts and writes only the ones
 * that are missing. That is what makes this self-healing — a worker that was
 * down for six hours catches up on its next tick with no operator action and no
 * state to repair, which a watermark column would not give without also being a
 * thing that can be wrong.
 *
 * The renewal-time flush does not use this: it looks back over the whole
 * billing period it is about to invoice, because that is the window the money
 * is owed on.
 */
export const LOOKBACK_MS = 24 * 3_600_000;

/** Attempts read per round trip while walking a window. */
const SCAN_PAGE = 1_000;

/** Enrolled subscriptions read per round trip. */
const ENROLMENT_PAGE = 500;

/** Rejections kept for the caller to log. The count is always exact. */
const MAX_RETAINED_REJECTIONS = 100;

/** The statuses whose collections are still worth metering. */
const ENROLLED_STATUSES = ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD", "UNPAID"] as const;

/**
 * The organization that bills the others, or null on an ordinary deployment.
 *
 * Read from the environment rather than passed down through every caller, for
 * the same reason `loadBranding` is: it is a deployment fact, not a request
 * one, and threading it through `renewSubscription` would put platform billing
 * into the signature of a function that has no business knowing about it.
 */
export function platformOrganizationId(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.PLATFORM_ORGANIZATION_ID || null;
}

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

/** A settled payment, reduced to the four fields metering actually reads. */
export interface SettledAttempt {
  id: string;
  amount: number;
  currency: string;
  completedAt: Date | null;
}

export interface VolumeEventRow {
  id: string;
  organizationId: string;
  customerId: string;
  meterId: string;
  eventId: string;
  units: number;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

export interface VolumeRejection {
  attemptId: string;
  reason: string;
}

export interface BuildVolumeEventsContext {
  platformOrganizationId: string;
  customerId: string;
  sourceOrganizationId: string;
  meterId: string;
  /** The currency the platform's own price is denominated in. */
  currency: CurrencyCode;
  /** Fallback timestamp for an attempt with no completedAt. */
  now: Date;
}

/**
 * Turns settled attempts into the usage events they imply.
 *
 * Pure on purpose, and the reason this file can become event-driven without
 * touching billing: it takes attempts rather than a query, so the same function
 * serves a scan today and a queue consumer later. Everything that decides *what
 * is owed* lives here; everything around it only decides *when we looked*.
 */
export function buildVolumeEvents(
  attempts: readonly SettledAttempt[],
  context: BuildVolumeEventsContext
): { rows: VolumeEventRow[]; rejected: VolumeRejection[] } {
  const rows: VolumeEventRow[] = [];
  const rejected: VolumeRejection[] = [];

  for (const attempt of attempts) {
    // A meter counts one scalar, so it can only hold one currency. Volume
    // collected in a currency the platform price is not denominated in is not
    // convertible here — this engine has no exchange rate, and inventing one
    // would put a guess into an invoice — so it is left out and reported,
    // where it is visible, rather than silently added to the wrong total.
    if (attempt.currency !== context.currency) {
      rejected.push({
        attemptId: attempt.id,
        reason: `collected in ${attempt.currency}, metered in ${context.currency}`,
      });
      continue;
    }

    const units = volumeUnits(attempt.amount, context.currency);
    if (units > MAX_UNITS) {
      rejected.push({ attemptId: attempt.id, reason: "volume exceeds what the meter can hold" });
      continue;
    }
    // A payment smaller than one major unit rounds to nothing. Recording a zero
    // would be honest but pointless, and it would fill the highest-volume table
    // in the schema with rows that can never change a total.
    if (units <= 0) continue;

    rows.push({
      id: newId("usageEvent"),
      organizationId: context.platformOrganizationId,
      customerId: context.customerId,
      meterId: context.meterId,
      // The attempt id is the idempotency key, exactly as it is the payment
      // reference everywhere else. Re-reading a settled attempt is a no-op at
      // the unique constraint rather than a second charge.
      eventId: attempt.id,
      units,
      // Dated when the money arrived, not when this ran. A payment that settles
      // at 23:58 on the last day of a period belongs to that period even if the
      // flush happens after midnight, and `getPeriodUsage` filters on exactly
      // this column.
      timestamp: attempt.completedAt ?? context.now,
      metadata: {
        source: "platform_volume",
        sourceOrganizationId: context.sourceOrganizationId,
        amountMinor: attempt.amount,
      },
    });
  }

  return { rows, rejected };
}

export interface MeterVolumeResult {
  recorded: number;
  skipped: number;
  rejectedCount: number;
  /** Capped at MAX_RETAINED_REJECTIONS; `rejectedCount` is the true total. */
  rejected: VolumeRejection[];
}

export interface MeterOrganizationVolumeParams extends BuildVolumeEventsContext {
  /** Inclusive lower bound on `completedAt`. */
  since: Date;
  /** Exclusive upper bound on `completedAt` — the period end, at renewal. */
  until: Date;
}

/**
 * Records everything one enrolled organization collected in a window.
 *
 * Walked in pages and written with `createMany({ skipDuplicates: true })`, so a
 * window holding a thousand payments costs one select and one insert rather
 * than three thousand round trips. The unique `(organizationId, eventId)` does
 * the de-duplication in PostgreSQL, which is also what makes this safe against
 * the scheduled pass running concurrently: both insert the same rows, one of
 * them wins each conflict, and neither errors.
 */
export async function meterOrganizationVolume(
  db: PrismaClient | TransactionClient,
  params: MeterOrganizationVolumeParams
): Promise<MeterVolumeResult> {
  const result: MeterVolumeResult = { recorded: 0, skipped: 0, rejectedCount: 0, rejected: [] };
  let cursor: string | undefined;

  for (;;) {
    const attempts = await db.paymentAttempt.findMany({
      where: {
        organizationId: params.sourceOrganizationId,
        status: "SUCCEEDED",
        completedAt: { gte: params.since, lt: params.until },
      },
      select: { id: true, amount: true, currency: true, completedAt: true },
      orderBy: { id: "asc" },
      take: SCAN_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (attempts.length === 0) break;

    const { rows, rejected } = buildVolumeEvents(attempts, params);

    result.rejectedCount += rejected.length;
    for (const rejection of rejected) {
      if (result.rejected.length < MAX_RETAINED_REJECTIONS) result.rejected.push(rejection);
    }

    if (rows.length > 0) {
      const written = await db.usageEvent.createMany({
        data: rows as never,
        skipDuplicates: true,
      });
      result.recorded += written.count;
      result.skipped += rows.length - written.count;
    }

    if (attempts.length < SCAN_PAGE) break;
    cursor = attempts[attempts.length - 1]!.id;
  }

  return result;
}

/**
 * What one enrolled subscription needs before its volume can be metered, or
 * null when this subscription is not a platform enrolment at all.
 *
 * Kept separate from both callers so the rules for "is this metered volume?"
 * are written once. A customer of the platform with no `externalId` is an
 * ordinary human customer billed for something else — nothing to meter, and
 * nothing wrong.
 */
function enrolmentContext(subscription: {
  organizationId: string;
  customer: { id: string; externalId: string | null };
  price: { currency: string; usageMeterId: string | null; usageMeter: { active: boolean } | null };
}, platformId: string): { customerId: string; sourceOrganizationId: string; meterId: string; currency: CurrencyCode } | null {
  if (subscription.organizationId !== platformId) return null;

  const sourceOrganizationId = subscription.customer.externalId;
  const meterId = subscription.price.usageMeterId;
  if (!sourceOrganizationId || !meterId) return null;
  if (!subscription.price.usageMeter?.active) return null;

  // Metering the platform's own collections would compound: those are the fees
  // it just charged for the volume it is about to charge for again.
  if (sourceOrganizationId === platformId) return null;

  return {
    customerId: subscription.customer.id,
    sourceOrganizationId,
    meterId,
    currency: assertCurrency(subscription.price.currency),
  };
}

/**
 * Brings one subscription's metered volume up to date, inside the transaction
 * that is about to invoice it.
 *
 * This is what makes a percentage fee correct, and the scheduled pass is not.
 * Usage bills in arrears over a window that closes at the moment of renewal, and
 * an invoice is immutable once finalized — so a payment that settles after the
 * last scheduled pass but before the period ends would land in a period that has
 * already been billed and be owed forever without ever appearing on an invoice.
 * Silent, permanent, and always in the merchant's favour rather than the
 * platform's, which is the worst direction for an error nobody is looking for.
 *
 * Running here closes that: the write and the read that follows it are the same
 * transaction, on a subscription this caller already holds the advisory lock
 * for. It is scoped to exactly one enrolled organization and bounded by the
 * period being invoiced, so it is a single indexed scan rather than anything
 * resembling the scheduled sweep.
 *
 * Inert unless this deployment resells itself, which is every deployment but
 * one — `renewSubscription` calls it unconditionally and learns nothing about
 * platform billing by doing so.
 */
export async function flushPlatformVolume(
  tx: TransactionClient,
  params: {
    subscriptionId: string;
    organizationId: string;
    customerId: string;
    /** Start of the closed period being invoiced. */
    since: Date;
    /** End of the closed period. Attempts at or after this belong to the next one. */
    until: Date;
    now?: Date;
  }
): Promise<MeterVolumeResult | null> {
  const platformId = platformOrganizationId();
  if (!platformId || params.organizationId !== platformId) return null;

  const subscription = await tx.subscription.findFirst({
    where: { id: params.subscriptionId, organizationId: platformId },
    select: {
      organizationId: true,
      customer: { select: { id: true, externalId: true } },
      price: {
        select: {
          currency: true,
          usageMeterId: true,
          usageMeter: { select: { active: true } },
        },
      },
    },
  });
  if (!subscription) return null;

  const context = enrolmentContext(subscription, platformId);
  if (!context) return null;

  return meterOrganizationVolume(tx, {
    platformOrganizationId: platformId,
    ...context,
    since: params.since,
    until: params.until,
    now: params.now ?? new Date(),
  });
}

export interface PlatformMeteringResult {
  /** Organizations enrolled and checked on this pass. */
  considered: number;
  /** Usage events written. A steady state of zero is the expected quiet case. */
  recorded: number;
  /** Attempts already metered by an earlier pass, or by a renewal flush. */
  skipped: number;
  /** Attempts that could not be metered. */
  rejectedCount: number;
  /** A sample of the above, for the worker to log. */
  rejected: VolumeRejection[];
}

export interface PlatformMeteringParams {
  /** The organization that bills the others. Nothing runs without one. */
  platformOrganizationId: string;
  now?: Date;
  /** How far back to re-read. Defaults to LOOKBACK_MS. */
  lookbackMs?: number;
}

/**
 * Keeps every enrolled organization's metered volume roughly current, so the
 * dashboard is not a month stale between invoices.
 *
 * Explicitly **not** load-bearing for any amount: whatever this misses, the
 * renewal flush picks up before the invoice that would have missed it. That
 * division is why this can run every fifteen minutes rather than every one, and
 * why falling behind costs freshness rather than revenue.
 */
export async function runPlatformVolumeMetering(
  prisma: PrismaClient,
  params: PlatformMeteringParams
): Promise<PlatformMeteringResult> {
  const now = params.now ?? new Date();
  const since = new Date(now.getTime() - (params.lookbackMs ?? LOOKBACK_MS));

  const result: PlatformMeteringResult = {
    considered: 0,
    recorded: 0,
    skipped: 0,
    rejectedCount: 0,
    rejected: [],
  };

  // Paged rather than read whole: a platform with a hundred thousand merchants
  // enrolled must not load a hundred thousand rows to find out what to do.
  let cursor: string | undefined;
  for (;;) {
    const enrolled = await prisma.subscription.findMany({
      where: {
        organizationId: params.platformOrganizationId,
        // A subscription that has lapsed still meters. The fee is owed on money
        // that was collected, and whether the merchant is behind on paying it is
        // the dunning ladder's business rather than this job's.
        status: { in: ENROLLED_STATUSES as unknown as never },
        price: { usageMeterId: { not: null } },
      },
      select: {
        id: true,
        organizationId: true,
        customer: { select: { id: true, externalId: true } },
        price: {
          select: { currency: true, usageMeterId: true, usageMeter: { select: { active: true } } },
        },
      },
      orderBy: { id: "asc" },
      take: ENROLMENT_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (enrolled.length === 0) break;

    for (const subscription of enrolled) {
      const context = enrolmentContext(subscription, params.platformOrganizationId);
      if (!context) continue;

      result.considered += 1;

      const metered = await meterOrganizationVolume(prisma, {
        platformOrganizationId: params.platformOrganizationId,
        ...context,
        since,
        until: now,
        now,
      });

      result.recorded += metered.recorded;
      result.skipped += metered.skipped;
      result.rejectedCount += metered.rejectedCount;
      for (const rejection of metered.rejected) {
        if (result.rejected.length < MAX_RETAINED_REJECTIONS) result.rejected.push(rejection);
      }
    }

    if (enrolled.length < ENROLMENT_PAGE) break;
    cursor = enrolled[enrolled.length - 1]!.id;
  }

  return result;
}
