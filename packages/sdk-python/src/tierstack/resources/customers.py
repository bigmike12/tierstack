from __future__ import annotations

from typing import Any, cast

from ..client import TierstackHttpClient
from ..types import TypedDict, compact


class Customer(TypedDict):
    id: str
    organizationId: str
    externalId: str | None
    email: str
    name: str | None
    phone: str | None
    currency: str | None
    country: str | None
    metadata: dict[str, Any]
    createdAt: str
    updatedAt: str
    deletedAt: str | None


class CustomerPage(TypedDict):
    items: list[Customer]
    page: int
    limit: int
    total: int
    totalPages: int


class CustomersResource:
    def __init__(self, http: TierstackHttpClient) -> None:
        self._http = http

    def create(
        self,
        *,
        email: str,
        external_id: str | None = None,
        name: str | None = None,
        phone: str | None = None,
        currency: str | None = None,
        country: str | None = None,
        metadata: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> Customer:
        """Idempotent on ``external_id``: calling this again with the same one
        updates the contact details rather than creating a duplicate."""
        body = compact(
            {
                "email": email,
                "externalId": external_id,
                "name": name,
                "phone": phone,
                "currency": currency,
                "country": country,
                "metadata": metadata,
            }
        )
        return cast(
            Customer,
            self._http.request("POST", "/v1/customers", body=body, idempotency_key=idempotency_key),
        )

    def list(
        self,
        *,
        email: str | None = None,
        external_id: str | None = None,
        q: str | None = None,
        page: int | None = None,
        limit: int | None = None,
    ) -> CustomerPage:
        query = {"email": email, "externalId": external_id, "q": q, "page": page, "limit": limit}
        return cast(CustomerPage, self._http.request("GET", "/v1/customers", query=query))

    def retrieve(self, customer_id: str) -> Customer:
        """Accepts either the platform id (``cus_...``) or your own ``external_id``."""
        return cast(Customer, self._http.request("GET", f"/v1/customers/{customer_id}"))

    def update(
        self,
        customer_id: str,
        *,
        email: str | None = None,
        name: str | None = None,
        phone: str | None = None,
        currency: str | None = None,
        country: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Customer:
        body = compact(
            {
                "email": email,
                "name": name,
                "phone": phone,
                "currency": currency,
                "country": country,
                "metadata": metadata,
            }
        )
        return cast(Customer, self._http.request("PATCH", f"/v1/customers/{customer_id}", body=body))

    def delete(self, customer_id: str) -> dict[str, bool]:
        """Soft delete. Refuses if the customer has a live subscription."""
        return cast(dict[str, bool], self._http.request("DELETE", f"/v1/customers/{customer_id}"))
