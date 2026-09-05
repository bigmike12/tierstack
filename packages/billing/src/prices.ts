import type { PrismaClient } from "@tierstack/database";
import { BillingError, assertCurrency, newId } from "@tierstack/shared";
import { TERMINAL_STATUSES } from "./state-machine";
import type { PricingModel } from "./pricing";

/**
 * The fields that decide what a subscriber pays. Changing any of them on a
 * price that somebody is already bound to would silently reprice them, so those
 * edits create a new version instead.
 */
export const ECONOMIC_FIELDS = [
  "model",
  "currency",
  "unitAmount",
  "intervalUnit",
  "intervalCount",
  "usageMeterId",
  "usageUnitAmount",
  "usageUnitSize",
  "includedUnits",
  // A ceiling is part of what someone agreed to pay, so raising or removing it
  // on a price with live subscribers versions rather than edits in place.
  "usageMaxAmount",
] as const;

/**
 * Safe to edit in place, always.
 *
 * `trialDays` belongs here and not above: a subscription's trial window is
 * copied onto the subscription row at signup, so changing the price's trial
 * length moves nobody who has already started one — it only changes the offer
 * made to the next customer.
 */
export const IN_PLACE_FIELDS = ["nickname", "active", "metadata", "trialDays"] as const;

export type EconomicField = (typeof ECONOMIC_FIELDS)[number];

export interface PriceEconomics {
  model: PricingModel;
  currency: string;
  unitAmount: number | null;
  intervalUnit: "DAY" | "WEEK" | "MONTH" | "YEAR";
  intervalCount: number;
  usageMeterId: string | null;
  usageUnitAmount: number | null;
  usageUnitSize: number | null;
  includedUnits: number | null;
  usageMaxAmount: number | null;
}

/**
 * Which economic fields the patch actually changes. A key that is absent, or
 * present with the value it already has, is not a change — a form that posts
 * every field on every save must not be treated as repricing.
 */
export function changedEconomics(
  current: PriceEconomics,
  patch: Partial<PriceEconomics>
): EconomicField[] {
  return ECONOMIC_FIELDS.filter((field) => {
    if (!(field in patch)) return false;
    const next = patch[field];
    if (next === undefined) return false;
    return normalise(next) !== normalise(current[field]);
  });
}

/** `null` and `undefined` both mean "not set" in this schema; treat them alike. */
function normalise(value: unknown): unknown {
  return value ?? null;
}

/**
 * The code the outgoing version is renamed to. The lineage's code stays with
 * whichever version is currently on sale, because that is what a developer's
 * integration means when it names a price; the archived row takes the suffix.
 */
export function archivedCode(code: string, version: number): string {
  const suffix = `-v${version}`;
  return `${code.slice(0, 64 - suffix.length)}${suffix}`;
}

export interface UpdatePriceParams {
  organizationId: string;
  priceId: string;
  nickname?: string | null;
  active?: boolean;
  trialDays?: number | null;
  metadata?: Record<string, unknown>;
  model?: PricingModel;
  currency?: string;
  unitAmount?: number | null;
  intervalUnit?: "DAY" | "WEEK" | "MONTH" | "YEAR";
  intervalCount?: number;
  usageMeterId?: string | null;
  usageUnitAmount?: number | null;
  usageUnitSize?: number | null;
  includedUnits?: number | null;
  usageMaxAmount?: number | null;
}

export interface UpdatePriceResult {
  price: Awaited<ReturnType<PrismaClient["price"]["update"]>>;
  /** Set when a new version was created; this is the row that was archived. */
  supersededPriceId: string | null;
  changed: EconomicField[];
  /** Subscriptions left on the archived version. */
  subscribersRetained: number;
}

/**
 * Edit a price.
 *
 * Three outcomes, and which one you get is decided by the data rather than by a
 * flag the caller passes:
 *
 *   - nothing economic changed          → edited in place
 *   - economics changed, nobody bound   → edited in place, because there is
 *                                         nobody to reprice and forcing a new
 *                                         version would just litter the plan
 *                                         with dead rows while you get the
 *                                         numbers right
 *   - economics changed, subscribers    → a new version is created and the old
 *                                         row is archived; existing subscribers
 *                                         stay on what they signed up for until
 *                                         an explicit plan change moves them
 */
export async function updatePrice(
  prisma: PrismaClient,
  params: UpdatePriceParams
): Promise<UpdatePriceResult> {
  return prisma.$transaction(async (tx) => {
    const price = await tx.price.findFirst({
      where: {
        organizationId: params.organizationId,
        OR: [{ id: params.priceId }, { code: params.priceId }],
      },
    });
    if (!price) throw BillingError.notFound("PRICE_NOT_FOUND", "Price");

    if (params.currency !== undefined) assertCurrency(params.currency);

    const inPlace = {
      ...(params.nickname !== undefined ? { nickname: params.nickname } : {}),
      ...(params.active !== undefined ? { active: params.active } : {}),
      ...(params.trialDays !== undefined ? { trialDays: params.trialDays } : {}),
      ...(params.metadata !== undefined ? { metadata: params.metadata as never } : {}),
    };

    const economics: Partial<PriceEconomics> = {};
    for (const field of ECONOMIC_FIELDS) {
      if (params[field] !== undefined) {
        (economics as Record<string, unknown>)[field] = params[field];
      }
    }

    const changed = changedEconomics(price as unknown as PriceEconomics, economics);

    if (changed.length === 0) {
      const updated = await tx.price.update({ where: { id: price.id }, data: inPlace });
      return { price: updated, supersededPriceId: null, changed, subscribersRetained: 0 };
    }

    // A subscription that has been canceled or has expired is history; it is
    // not going to be billed again, so it does not hold the price hostage.
    const bound = await tx.subscription.count({
      where: { priceId: price.id, status: { notIn: TERMINAL_STATUSES } },
    });

    if (bound === 0) {
      const updated = await tx.price.update({
        where: { id: price.id },
        data: { ...inPlace, ...economics },
      });
      return { price: updated, supersededPriceId: null, changed, subscribersRetained: 0 };
    }

    if (params.currency !== undefined && params.currency !== price.currency) {
      // Versioning cannot rescue this one: the plan's existing invoices,
      // payments and credits are all denominated in the old currency, and a
      // "new version" in another currency is a different product.
      throw new BillingError(
        "INVALID_REQUEST",
        `Price "${price.code}" has ${bound} live subscription(s) in ${price.currency}. ` +
          "Add a separate price in the new currency instead of changing this one."
      );
    }

    // Free the code before the new row claims it — (organizationId, code) is
    // unique, and both rows exist at the end of this transaction.
    await tx.price.update({
      where: { id: price.id },
      data: { code: archivedCode(price.code, price.version), active: false },
    });

    const created = await tx.price.create({
      data: {
        id: newId("price"),
        organizationId: price.organizationId,
        planId: price.planId,
        code: price.code,
        nickname: params.nickname !== undefined ? params.nickname : price.nickname,
        model: economics.model ?? price.model,
        currency: price.currency,
        unitAmount: economics.unitAmount !== undefined ? economics.unitAmount : price.unitAmount,
        intervalUnit: economics.intervalUnit ?? price.intervalUnit,
        intervalCount: economics.intervalCount ?? price.intervalCount,
        usageMeterId:
          economics.usageMeterId !== undefined ? economics.usageMeterId : price.usageMeterId,
        usageUnitAmount:
          economics.usageUnitAmount !== undefined
            ? economics.usageUnitAmount
            : price.usageUnitAmount,
        usageUnitSize:
          economics.usageUnitSize !== undefined ? economics.usageUnitSize : price.usageUnitSize,
        includedUnits:
          economics.includedUnits !== undefined ? economics.includedUnits : price.includedUnits,
        usageMaxAmount:
          economics.usageMaxAmount !== undefined ? economics.usageMaxAmount : price.usageMaxAmount,
        trialDays: params.trialDays !== undefined ? params.trialDays : price.trialDays,
        active: params.active ?? true,
        metadata: (params.metadata ?? (price.metadata as never)) as never,
        version: price.version + 1,
        supersedesPriceId: price.id,
      },
    });

    return {
      price: created,
      supersededPriceId: price.id,
      changed,
      subscribersRetained: bound,
    };
  });
}

/**
 * Walks a price lineage forward to the version currently on sale.
 *
 * Supersede links point backwards — a new version records the row it replaced —
 * so moving forward means asking "which price supersedes this one?" repeatedly.
 * The loop is bounded: a cycle would mean corrupt data, and spinning on it
 * during a renewal is worse than billing the price we started from.
 */
export async function resolveCurrentPrice<T extends { id: string }>(
  tx: {
    price: {
      findFirst: (args: { where: { supersedesPriceId: string }; include?: unknown }) => Promise<T | null>;
    };
  },
  priceId: string,
  include?: unknown,
  maxHops = 20
): Promise<T | null> {
  let current: T | null = null;
  let cursor = priceId;

  for (let hop = 0; hop < maxHops; hop += 1) {
    const next: T | null = await tx.price.findFirst({
      where: { supersedesPriceId: cursor },
      ...(include ? { include } : {}),
    });
    if (!next) return current;
    current = next;
    cursor = next.id;
  }

  return current;
}

/**
 * Whether a subscription can be moved onto a newer version of its price without
 * anyone having to agree to it again.
 *
 * A different amount, allowance or usage rate is what a price rise is, and it
 * rolls forward. A different billing interval does not: moving somebody from
 * monthly to annual changes what they are charged in one go by a factor of ten
 * or more, and no price edit should be able to do that behind their back. The
 * merchant has to move them with an explicit plan change, where proration is
 * calculated and shown.
 */
export function canRollForward(
  from: { intervalUnit: string; intervalCount: number; currency: string },
  to: { intervalUnit: string; intervalCount: number; currency: string }
): boolean {
  return (
    from.currency === to.currency &&
    from.intervalUnit === to.intervalUnit &&
    from.intervalCount === to.intervalCount
  );
}
