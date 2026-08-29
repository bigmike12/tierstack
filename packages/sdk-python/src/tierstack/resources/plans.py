from __future__ import annotations

import builtins
from typing import Any, cast

from ..client import TierstackHttpClient
from ..types import TypedDict, compact
from .prices import Price


class Plan(TypedDict):
    id: str
    organizationId: str
    code: str
    name: str
    description: str | None
    features: dict[str, bool | int | float | str]
    metadata: dict[str, Any]
    active: bool
    createdAt: str
    updatedAt: str
    prices: list[Price]
    """Only present on the plans list and a single plan lookup."""


class PlansResource:
    def __init__(self, http: TierstackHttpClient) -> None:
        self._http = http

    def create(
        self,
        *,
        code: str,
        name: str,
        description: str | None = None,
        features: dict[str, bool | int | float | str] | None = None,
        metadata: dict[str, Any] | None = None,
        active: bool | None = None,
    ) -> Plan:
        body = compact(
            {
                "code": code,
                "name": name,
                "description": description,
                "features": features,
                "metadata": metadata,
                "active": active,
            }
        )
        return cast(Plan, self._http.request("POST", "/v1/plans", body=body))

    def list(self, *, active: bool | None = None) -> builtins.list[Plan]:
        return cast(list[Plan], self._http.request("GET", "/v1/plans", query={"active": active}))

    def retrieve(self, plan_id: str) -> Plan:
        """Accepts either the platform id or the plan's own ``code``."""
        return cast(Plan, self._http.request("GET", f"/v1/plans/{plan_id}"))

    def update(
        self,
        plan_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        features: dict[str, bool | int | float | str] | None = None,
        metadata: dict[str, Any] | None = None,
        active: bool | None = None,
    ) -> Plan:
        body = compact(
            {
                "name": name,
                "description": description,
                "features": features,
                "metadata": metadata,
                "active": active,
            }
        )
        return cast(Plan, self._http.request("PATCH", f"/v1/plans/{plan_id}", body=body))
