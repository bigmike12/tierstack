/**
 * Transaction store for the mock rail. The API process and the worker process
 * both need to see the same simulated transactions, so production wiring uses
 * the Redis-backed store; unit tests use the in-memory one.
 */
export interface MockTransaction {
  reference: string;
  providerReference: string;
  organizationId: string;
  amount: number;
  currency: string;
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  customerEmail: string;
  customerId: string;
  description?: string;
  savePaymentMethod: boolean;
  method: string;
  failureCode?: string;
  failureReason?: string;
  paidAt?: string;
  expiresAt: string;
  paymentMethodRef?: string;
  metadata: Record<string, unknown>;
}

export interface MockStore {
  put(txn: MockTransaction): Promise<void>;
  get(reference: string): Promise<MockTransaction | null>;
  list(organizationId: string): Promise<MockTransaction[]>;
}

export class InMemoryMockStore implements MockStore {
  private readonly rows = new Map<string, MockTransaction>();

  async put(txn: MockTransaction): Promise<void> {
    this.rows.set(txn.reference, txn);
  }

  async get(reference: string): Promise<MockTransaction | null> {
    return this.rows.get(reference) ?? null;
  }

  async list(organizationId: string): Promise<MockTransaction[]> {
    return [...this.rows.values()].filter((t) => t.organizationId === organizationId);
  }

  clear(): void {
    this.rows.clear();
  }
}

/**
 * The slice of a Redis client this store needs. Declared structurally so any
 * compatible client works and the package takes no hard dependency on ioredis.
 */
export interface RedisLike {
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  keys(pattern: string): Promise<string[]>;
  mget(...keys: string[]): Promise<(string | null)[]>;
}

export class RedisMockStore implements MockStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly ttlSeconds = 60 * 60 * 24 * 7
  ) {}

  private key(reference: string): string {
    return `mock:txn:${reference}`;
  }

  async put(txn: MockTransaction): Promise<void> {
    await this.redis.set(this.key(txn.reference), JSON.stringify(txn), "EX", this.ttlSeconds);
  }

  async get(reference: string): Promise<MockTransaction | null> {
    const raw = await this.redis.get(this.key(reference));
    return raw ? (JSON.parse(raw) as MockTransaction) : null;
  }

  async list(organizationId: string): Promise<MockTransaction[]> {
    const keys = await this.redis.keys("mock:txn:*");
    if (keys.length === 0) return [];
    const rows = await this.redis.mget(...keys);
    return rows
      .filter((row): row is string => row !== null)
      .map((row) => JSON.parse(row) as MockTransaction)
      .filter((txn) => txn.organizationId === organizationId);
  }
}
