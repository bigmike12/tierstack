from __future__ import annotations

from typing import Any, Literal, cast

from ..client import TierstackHttpClient
from ..types import TypedDict, compact
from .subscriptions import PaymentAttemptSummary

InvoiceStatus = Literal["DRAFT", "OPEN", "PAID", "VOID", "UNCOLLECTIBLE"]


class InvoiceLineItem(TypedDict):
    id: str
    type: str
    description: str
    quantity: int
    unitAmount: int
    """Minor units. Negative for credits and discounts."""
    amount: int
    currency: str
    periodStart: str | None
    periodEnd: str | None


class PaymentAttempt(TypedDict):
    id: str
    invoiceId: str
    customerId: str
    provider: str
    amount: int
    currency: str
    status: str
    attemptNumber: int
    failureCode: str | None
    failureReason: str | None
    providerReference: str | None
    createdAt: str
    completedAt: str | None


class Invoice(TypedDict):
    id: str
    organizationId: str
    customerId: str
    subscriptionId: str | None
    invoiceNumber: str
    status: InvoiceStatus
    currency: str
    subtotal: int
    discountAmount: int
    creditAmount: int
    taxAmount: int
    total: int
    amountPaid: int
    amountDue: int
    billingPeriodStart: str | None
    billingPeriodEnd: str | None
    finalizedAt: str | None
    paidAt: str | None
    voidedAt: str | None
    dunningAttempts: int
    nextRetryAt: str | None
    createdAt: str
    lineItems: list[InvoiceLineItem]
    """Present only on ``retrieve`` — the list endpoint omits both for row size."""
    attempts: list[PaymentAttempt]


class InvoicePage(TypedDict):
    items: list[Invoice]
    page: int
    limit: int
    total: int
    totalPages: int


class InvoicesResource:
    def __init__(self, http: TierstackHttpClient) -> None:
        self._http = http

    def list(
        self,
        *,
        customer_id: str | None = None,
        subscription_id: str | None = None,
        status: InvoiceStatus | None = None,
        q: str | None = None,
        page: int | None = None,
        limit: int | None = None,
    ) -> InvoicePage:
        query = {
            "customerId": customer_id,
            "subscriptionId": subscription_id,
            "status": status,
            "q": q,
            "page": page,
            "limit": limit,
        }
        return cast(InvoicePage, self._http.request("GET", "/v1/invoices", query=query))

    def retrieve(self, invoice_id: str) -> Invoice:
        """Includes line items and every payment attempt made against it."""
        return cast(Invoice, self._http.request("GET", f"/v1/invoices/{invoice_id}"))

    def pay(
        self,
        invoice_id: str,
        *,
        payment_method_id: str | None = None,
        callback_url: str | None = None,
        metadata: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> PaymentAttemptSummary:
        """Collect, or retry collecting, an open invoice. Every call creates a
        new attempt — previous ones are never overwritten."""
        body = compact(
            {"paymentMethodId": payment_method_id, "callbackUrl": callback_url, "metadata": metadata}
        )
        return cast(
            PaymentAttemptSummary,
            self._http.request(
                "POST", f"/v1/invoices/{invoice_id}/pay", body=body, idempotency_key=idempotency_key
            ),
        )

    def void(self, invoice_id: str) -> Invoice:
        return cast(Invoice, self._http.request("POST", f"/v1/invoices/{invoice_id}/void"))
