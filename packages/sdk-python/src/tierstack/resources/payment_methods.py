from __future__ import annotations

import builtins
from typing import cast

from ..client import TierstackHttpClient
from ..types import TypedDict


class PaymentMethod(TypedDict):
    id: str
    type: str
    provider: str
    status: str
    brand: str | None
    last4: str | None
    expMonth: int | None
    expYear: int | None
    bankName: str | None
    isDefault: bool
    createdAt: str


class PaymentMethodsResource:
    def __init__(self, http: TierstackHttpClient) -> None:
        self._http = http

    def list(self, customer_id: str) -> builtins.list[PaymentMethod]:
        return cast(
            list[PaymentMethod],
            self._http.request("GET", "/v1/payment-methods", query={"customerId": customer_id}),
        )

    def delete(self, payment_method_id: str) -> dict[str, bool]:
        """Detaches the method. Any subscription pointed at it falls back to selecting one at charge time."""
        return cast(
            dict[str, bool], self._http.request("DELETE", f"/v1/payment-methods/{payment_method_id}")
        )
