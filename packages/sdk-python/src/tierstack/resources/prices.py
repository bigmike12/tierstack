from __future__ import annotations

import builtins
from typing import Any, Literal, cast

from ..client import TierstackHttpClient
from ..types import TypedDict, compact

PriceModel = Literal["FLAT_RECURRING", "PER_SEAT", "USAGE_METERED", "HYBRID"]
BillingInterval = Literal[
    "DAILY",
    "WEEKLY",
    "BI_WEEKLY",
    "MONTHLY",
    "BI_MONTHLY",
    "QUARTERLY",
    "SEMI_ANNUALLY",
    "ANNUALLY",
    "CUSTOM_DAYS",
]


class Price(TypedDict):
    id: str
    organizationId: str
    planId: str
    code: str
    nickname: str | None
    model: PriceModel
    currency: str
    unitAmount: int | None
    """Integer minor units — ₦10,000 is 1000000. ``None`` for USAGE_METERED prices with no base fee."""
    intervalUnit: BillingInterval
    intervalCount: int
    usageMeterId: str | None
    usageUnitAmount: int | None
    usageUnitSize: int
    includedUnits: int | None
    trialDays: int | None
    active: bool
    version: int
    supersedesPriceId: str | None
    metadata: dict[str, Any]
    createdAt: str
    updatedAt: str


class PricesResource:
    def __init__(self, http: TierstackHttpClient) -> None:
        self._http = http

    def create(
        self,
        *,
        plan_id: str,
        code: str,
        currency: str,
        nickname: str | None = None,
        model: PriceModel | None = None,
        unit_amount: int | None = None,
        interval: BillingInterval | None = None,
        interval_days: int | None = None,
        usage_meter_code: str | None = None,
        usage_unit_amount: int | None = None,
        usage_unit_size: int | None = None,
        included_units: int | None = None,
        trial_days: int | None = None,
        active: bool | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Price:
        body = compact(
            {
                "planId": plan_id,
                "code": code,
                "currency": currency,
                "nickname": nickname,
                "model": model,
                "unitAmount": unit_amount,
                "interval": interval,
                "intervalDays": interval_days,
                "usageMeterCode": usage_meter_code,
                "usageUnitAmount": usage_unit_amount,
                "usageUnitSize": usage_unit_size,
                "includedUnits": included_units,
                "trialDays": trial_days,
                "active": active,
                "metadata": metadata,
            }
        )
        return cast(Price, self._http.request("POST", "/v1/prices", body=body))

    def list(
        self,
        *,
        plan_id: str | None = None,
        currency: str | None = None,
        active: bool | None = None,
    ) -> builtins.list[Price]:
        query = {"planId": plan_id, "currency": currency, "active": active}
        return cast(list[Price], self._http.request("GET", "/v1/prices", query=query))

    def retrieve(self, price_id: str) -> Price:
        """Accepts either the platform id or the price's own ``code``."""
        return cast(Price, self._http.request("GET", f"/v1/prices/{price_id}"))

    def update(
        self,
        price_id: str,
        *,
        nickname: str | None = None,
        model: PriceModel | None = None,
        currency: str | None = None,
        unit_amount: int | None = None,
        interval: BillingInterval | None = None,
        interval_days: int | None = None,
        usage_meter_code: str | None = None,
        usage_unit_amount: int | None = None,
        usage_unit_size: int | None = None,
        included_units: int | None = None,
        trial_days: int | None = None,
        active: bool | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Price:
        """Presentation, ``active`` and the trial length always save in place. An
        economic change saves in place too — until a live subscription is
        pinned to this price, at which point the same call instead publishes a
        new version and archives this one."""
        body = compact(
            {
                "nickname": nickname,
                "model": model,
                "currency": currency,
                "unitAmount": unit_amount,
                "interval": interval,
                "intervalDays": interval_days,
                "usageMeterCode": usage_meter_code,
                "usageUnitAmount": usage_unit_amount,
                "usageUnitSize": usage_unit_size,
                "includedUnits": included_units,
                "trialDays": trial_days,
                "active": active,
                "metadata": metadata,
            }
        )
        return cast(Price, self._http.request("PATCH", f"/v1/prices/{price_id}", body=body))
