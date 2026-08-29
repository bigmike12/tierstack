"""Official Python SDK for the Tierstack API.

    from tierstack import Tierstack

    client = Tierstack(api_key="sk_test_...", base_url="https://api.gettierstack.com")

    result = client.subscriptions.create(
        customer={"email": "ada@example.com"},
        price_id="price_starter_monthly",
    )

Every method returns the response's ``data`` directly, or raises
:class:`TierstackError` — there is no envelope to unwrap and no result to
check for an ``error`` field.
"""

from __future__ import annotations

from .client import TierstackHttpClient
from .errors import TierstackError
from .resources.customers import Customer, CustomerPage, CustomersResource
from .resources.invoices import (
    Invoice,
    InvoiceLineItem,
    InvoicePage,
    InvoicesResource,
    InvoiceStatus,
    PaymentAttempt,
)
from .resources.payment_attempts import PaymentAttemptPage, PaymentAttemptsResource
from .resources.payment_methods import PaymentMethod, PaymentMethodsResource
from .resources.plans import Plan, PlansResource
from .resources.prices import BillingInterval, Price, PriceModel, PricesResource
from .resources.subscriptions import (
    ChangePlanResult,
    CreateSubscriptionResult,
    PaymentAttemptStatus,
    PaymentAttemptSummary,
    RenewResult,
    Subscription,
    SubscriptionPage,
    SubscriptionsResource,
    SubscriptionStatus,
    SubscriptionTransition,
)
from .types import Page

__version__ = "0.1.0"

__all__ = [
    "BillingInterval",
    "ChangePlanResult",
    "CreateSubscriptionResult",
    "Customer",
    "CustomerPage",
    "Invoice",
    "InvoiceLineItem",
    "InvoicePage",
    "InvoiceStatus",
    "Page",
    "PaymentAttempt",
    "PaymentAttemptPage",
    "PaymentAttemptStatus",
    "PaymentAttemptSummary",
    "PaymentMethod",
    "Plan",
    "Price",
    "PriceModel",
    "RenewResult",
    "Subscription",
    "SubscriptionPage",
    "SubscriptionStatus",
    "SubscriptionTransition",
    "Tierstack",
    "TierstackError",
]


class Tierstack:
    """The SDK's single entry point. One instance per API key."""

    def __init__(self, api_key: str, base_url: str, *, timeout: float = 30.0) -> None:
        http = TierstackHttpClient(api_key, base_url, timeout=timeout)
        self.customers = CustomersResource(http)
        self.payment_methods = PaymentMethodsResource(http)
        self.plans = PlansResource(http)
        self.prices = PricesResource(http)
        self.subscriptions = SubscriptionsResource(http)
        self.invoices = InvoicesResource(http)
        self.payment_attempts = PaymentAttemptsResource(http)
