import type { TierstackHttpClient } from "../client";
import type { Price } from "./prices";

export interface Plan {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  description: string | null;
  features: Record<string, boolean | number | string>;
  metadata: Record<string, unknown>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  /** Only present where the route includes it: the plans list and a single plan lookup. */
  prices?: Price[];
}

export interface CreatePlanParams {
  code: string;
  name: string;
  description?: string;
  features?: Record<string, boolean | number | string>;
  metadata?: Record<string, unknown>;
  active?: boolean;
}

export type UpdatePlanParams = Partial<Omit<CreatePlanParams, "code">>;

export class PlansResource {
  constructor(private readonly http: TierstackHttpClient) {}

  create(params: CreatePlanParams): Promise<Plan> {
    return this.http.request("POST", "/v1/plans", { body: params });
  }

  list(params: { active?: boolean } = {}): Promise<Plan[]> {
    return this.http.request("GET", "/v1/plans", { query: params });
  }

  /** Accepts either the platform id or the plan's own `code`. */
  retrieve(planId: string): Promise<Plan> {
    return this.http.request("GET", `/v1/plans/${encodeURIComponent(planId)}`);
  }

  update(planId: string, params: UpdatePlanParams): Promise<Plan> {
    return this.http.request("PATCH", `/v1/plans/${encodeURIComponent(planId)}`, { body: params });
  }
}
