import type { TierstackHttpClient } from "../client";

export type PriceModel = "FLAT_RECURRING" | "PER_SEAT" | "USAGE_METERED" | "HYBRID";

export type BillingInterval =
  | "DAILY"
  | "WEEKLY"
  | "BI_WEEKLY"
  | "MONTHLY"
  | "BI_MONTHLY"
  | "QUARTERLY"
  | "SEMI_ANNUALLY"
  | "ANNUALLY"
  | "CUSTOM_DAYS";

export interface Price {
  id: string;
  organizationId: string;
  planId: string;
  code: string;
  nickname: string | null;
  model: PriceModel;
  currency: string;
  /** Integer minor units — ₦10,000 is 1000000. `null` for USAGE_METERED prices with no base fee. */
  unitAmount: number | null;
  intervalUnit: BillingInterval;
  intervalCount: number;
  usageMeterId: string | null;
  usageUnitAmount: number | null;
  usageUnitSize: number;
  includedUnits: number | null;
  /** Ceiling on the metered charge for one billing period, in minor units. */
  usageMaxAmount: number | null;
  trialDays: number | null;
  active: boolean;
  version: number;
  supersedesPriceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePriceParams {
  /** The platform id or `code` of the plan this price belongs to. */
  planId: string;
  code: string;
  nickname?: string;
  model?: PriceModel;
  currency: string;
  /** Required for every model except USAGE_METERED. */
  unitAmount?: number;
  interval?: BillingInterval;
  /** Only when `interval` is `CUSTOM_DAYS`. */
  intervalDays?: number;
  usageMeterCode?: string;
  usageUnitAmount?: number;
  usageUnitSize?: number;
  includedUnits?: number;
  usageMaxAmount?: number;
  trialDays?: number;
  active?: boolean;
  metadata?: Record<string, unknown>;
}

export type UpdatePriceParams = Partial<Omit<CreatePriceParams, "planId" | "code">>;

export class PricesResource {
  constructor(private readonly http: TierstackHttpClient) {}

  create(params: CreatePriceParams): Promise<Price> {
    return this.http.request("POST", "/v1/prices", { body: params });
  }

  list(params: { planId?: string; currency?: string; active?: boolean } = {}): Promise<Price[]> {
    return this.http.request("GET", "/v1/prices", { query: params });
  }

  /** Accepts either the platform id or the price's own `code`. */
  retrieve(priceId: string): Promise<Price> {
    return this.http.request("GET", `/v1/prices/${encodeURIComponent(priceId)}`);
  }

  /**
   * Presentation, `active` and the trial length always save in place. An
   * economic change (amount, interval, metering) saves in place too — until a
   * live subscription is pinned to this price, at which point the same call
   * instead publishes a new version and archives this one, so existing
   * subscribers keep the price they agreed to.
   */
  update(priceId: string, params: UpdatePriceParams): Promise<Price> {
    return this.http.request("PATCH", `/v1/prices/${encodeURIComponent(priceId)}`, { body: params });
  }
}
