import type { EntitlementDefinition, SubscriptionContext } from "./types";

/** The slice of a Redis client this cache needs. */
export interface EntitlementCacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  incr(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
}

export interface CachedContext {
  definitions: EntitlementDefinition[];
  context: SubscriptionContext;
}

const DEFAULT_TTL_SECONDS = 60;

/**
 * Redis is the fast path for entitlement *definitions* only — the plan, the
 * overrides, the subscription's status. Live usage is never cached: a stale
 * quota is a stale invoice, so consumption is always read from PostgreSQL at
 * check time.
 *
 * Organization-wide invalidation uses a version counter rather than scanning
 * keys. Bumping the counter orphans every cached entry for that organization in
 * one operation, and the orphans expire on their own TTL.
 */
export class EntitlementCache {
  constructor(
    private readonly redis: EntitlementCacheClient,
    private readonly ttlSeconds: number = DEFAULT_TTL_SECONDS
  ) {}

  private versionKey(organizationId: string): string {
    return `ent:ver:${organizationId}`;
  }

  private async version(organizationId: string): Promise<string> {
    const current = await this.redis.get(this.versionKey(organizationId));
    return current ?? "1";
  }

  private async entryKey(organizationId: string, customerId: string): Promise<string> {
    return `ent:def:${organizationId}:v${await this.version(organizationId)}:${customerId}`;
  }

  async read(organizationId: string, customerId: string): Promise<CachedContext | null> {
    try {
      const raw = await this.redis.get(await this.entryKey(organizationId, customerId));
      if (!raw) return null;
      return reviveDates(JSON.parse(raw) as CachedContext);
    } catch {
      // A cache that is down must never take entitlement checks down with it.
      return null;
    }
  }

  async write(organizationId: string, customerId: string, value: CachedContext): Promise<void> {
    try {
      await this.redis.set(
        await this.entryKey(organizationId, customerId),
        JSON.stringify(value),
        "EX",
        this.ttlSeconds
      );
    } catch {
      // Best effort by design.
    }
  }

  /** One customer changed — a new subscription, an override, a payment. */
  async invalidateCustomer(organizationId: string, customerId: string): Promise<void> {
    try {
      await this.redis.del(await this.entryKey(organizationId, customerId));
    } catch {
      /* best effort */
    }
  }

  /** Something org-wide changed — a plan, a price, billing settings. */
  async invalidateOrganization(organizationId: string): Promise<void> {
    try {
      await this.redis.incr(this.versionKey(organizationId));
    } catch {
      /* best effort */
    }
  }
}

/** JSON has no Date type; the resolver compares expiry, so revive them. */
function reviveDates(value: CachedContext): CachedContext {
  return {
    context: {
      ...value.context,
      currentPeriodStart: value.context.currentPeriodStart
        ? new Date(value.context.currentPeriodStart)
        : null,
      currentPeriodEnd: value.context.currentPeriodEnd ? new Date(value.context.currentPeriodEnd) : null,
    },
    definitions: value.definitions.map((definition) => ({
      ...definition,
      expiresAt: definition.expiresAt ? new Date(definition.expiresAt) : null,
    })),
  };
}
