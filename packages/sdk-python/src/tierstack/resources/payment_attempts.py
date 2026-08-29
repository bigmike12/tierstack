from __future__ import annotations

from typing import cast

from ..client import TierstackHttpClient
from ..types import TypedDict
from .invoices import PaymentAttempt


class PaymentAttemptPage(TypedDict):
    items: list[PaymentAttempt]
    page: int
    limit: int
    total: int
    totalPages: int


class PaymentAttemptsResource:
    def __init__(self, http: TierstackHttpClient) -> None:
        self._http = http

    def list(
        self,
        *,
        invoice_id: str | None = None,
        customer_id: str | None = None,
        q: str | None = None,
        page: int | None = None,
        limit: int | None = None,
    ) -> PaymentAttemptPage:
        """Every attempt, with whatever the provider actually said about the failure."""
        query = {"invoiceId": invoice_id, "customerId": customer_id, "q": q, "page": page, "limit": limit}
        return cast(
            PaymentAttemptPage, self._http.request("GET", "/v1/payment-attempts", query=query)
        )

    def sync(self, attempt_id: str) -> PaymentAttempt:
        """Asks the provider directly what happened, instead of waiting on a
        webhook that may never arrive for some decline shapes. Safe to call on
        an attempt that already settled — it's returned as-is."""
        return cast(
            PaymentAttempt,
            self._http.request("POST", f"/v1/payment-attempts/{attempt_id}/sync"),
        )
