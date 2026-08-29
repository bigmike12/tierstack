from __future__ import annotations

import builtins
from typing import Any, Literal, cast

from ..client import TierstackHttpClient
from ..types import TypedDict, compact

SubscriptionStatus = Literal[
    "INCOMPLETE",
    "TRIALING",
    "ACTIVE",
    "PAST_DUE",
    "GRACE_PERIOD",
    "UNPAID",
    "PAUSED",
    "CANCELED",
    "EXPIRED",
]

PaymentAttemptStatus = Literal["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELED"]


class PaymentAttemptSummary(TypedDict):
    """What collecting a payment actually did — returned from any call that may trigger a charge."""

    attemptId: str
    status: PaymentAttemptStatus
    provider: str
    reference: str
    providerReference: str | None
    checkoutUrl: str | None
    """Present when the customer must complete payment on a hosted page."""
    amount: int
    currency: str
    invoiceStatus: str
    subscriptionStatus: SubscriptionStatus | None
    failureCode: str | None
    failureReason: str | None


class Subscription(TypedDict):
    id: str
    organizationId: str
    customerId: str
    priceId: str
    status: SubscriptionStatus
    quantity: int
    currentPeriodStart: str
    currentPeriodEnd: str
    billingAnchorDay: int | None
    trialStart: str | None
    trialEnd: str | None
    cancelAtPeriodEnd: bool
    canceledAt: str | None
    endedAt: str | None
    pausedAt: str | None
    gracePeriodStart: str | None
    gracePeriodEnd: str | None
    paymentMethodId: str | None
    pricePinned: bool
    metadata: dict[str, Any]
    createdAt: str
    updatedAt: str


class CreateSubscriptionResult(TypedDict):
    subscription: Subscription
    invoiceId: str | None
    amountDue: int
    currency: str
    payment: PaymentAttemptSummary | None


class ChangePlanResult(TypedDict):
    applied: bool
    invoiceId: str | None
    netAmount: int
    payment: Any | None
    subscription: Subscription


class RenewResult(TypedDict):
    renewed: bool
    invoiceId: str | None
    payment: Any | None
    subscription: Subscription


class SubscriptionTransition(TypedDict):
    id: str
    subscriptionId: str
    fromStatus: SubscriptionStatus | None
    """``None`` on a subscription's very first transition — there is no "from" yet."""
    toStatus: SubscriptionStatus
    reason: str
    metadata: dict[str, Any]
    createdAt: str


class SubscriptionPage(TypedDict):
    items: list[Subscription]
    page: int
    limit: int
    total: int
    totalPages: int


class SubscriptionsResource:
    def __init__(self, http: TierstackHttpClient) -> None:
        self._http = http

    def create(
        self,
        *,
        price_id: str,
        customer_id: str | None = None,
        customer: dict[str, Any] | None = None,
        quantity: int | None = None,
        trial_days: int | None = None,
        payment_method_id: str | None = None,
        collect_payment: bool | None = None,
        callback_url: str | None = None,
        metadata: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> CreateSubscriptionResult:
        """The one call most integrations need: resolves the customer, opens
        the subscription, issues the first invoice and — unless told
        otherwise — starts collection. Provide either ``customer_id`` or
        ``customer``, not both."""
        body = compact(
            {
                "customerId": customer_id,
                "customer": customer,
                "priceId": price_id,
                "quantity": quantity,
                "trialDays": trial_days,
                "paymentMethodId": payment_method_id,
                "collectPayment": collect_payment,
                "callbackUrl": callback_url,
                "metadata": metadata,
            }
        )
        return cast(
            CreateSubscriptionResult,
            self._http.request(
                "POST", "/v1/subscriptions", body=body, idempotency_key=idempotency_key
            ),
        )

    def list(
        self,
        *,
        customer_id: str | None = None,
        status: SubscriptionStatus | None = None,
        price_id: str | None = None,
        q: str | None = None,
        page: int | None = None,
        limit: int | None = None,
    ) -> SubscriptionPage:
        query = {
            "customerId": customer_id,
            "status": status,
            "priceId": price_id,
            "q": q,
            "page": page,
            "limit": limit,
        }
        return cast(
            SubscriptionPage, self._http.request("GET", "/v1/subscriptions", query=query)
        )

    def retrieve(self, subscription_id: str) -> Subscription:
        return cast(
            Subscription, self._http.request("GET", f"/v1/subscriptions/{subscription_id}")
        )

    def change_plan(
        self,
        subscription_id: str,
        *,
        price_id: str,
        quantity: int | None = None,
        timing: Literal["IMMEDIATE", "NEXT_PERIOD"] | None = None,
        collect_payment: bool | None = None,
        idempotency_key: str | None = None,
    ) -> ChangePlanResult:
        body = compact(
            {
                "priceId": price_id,
                "quantity": quantity,
                "timing": timing,
                "collectPayment": collect_payment,
            }
        )
        return cast(
            ChangePlanResult,
            self._http.request(
                "POST",
                f"/v1/subscriptions/{subscription_id}/change-plan",
                body=body,
                idempotency_key=idempotency_key,
            ),
        )

    def change_quantity(self, subscription_id: str, quantity: int) -> dict[str, Subscription]:
        return cast(
            dict[str, Subscription],
            self._http.request(
                "POST",
                f"/v1/subscriptions/{subscription_id}/quantity",
                body={"quantity": quantity},
            ),
        )

    def pin_price(self, subscription_id: str, pinned: bool) -> Subscription:
        """Hold the subscription on its current price version, or release it
        back to following the plan's current price."""
        return cast(
            Subscription,
            self._http.request(
                "POST",
                f"/v1/subscriptions/{subscription_id}/pin-price",
                body={"pinned": pinned},
            ),
        )

    def cancel(self, subscription_id: str, *, at_period_end: bool | None = None) -> Subscription:
        body = compact({"atPeriodEnd": at_period_end})
        return cast(
            Subscription,
            self._http.request(
                "POST", f"/v1/subscriptions/{subscription_id}/cancel", body=body
            ),
        )

    def resume(self, subscription_id: str) -> Subscription:
        """Reverses a cancellation scheduled with ``at_period_end=True``, before the period actually ends."""
        return cast(
            Subscription,
            self._http.request("POST", f"/v1/subscriptions/{subscription_id}/resume"),
        )

    def pause(self, subscription_id: str) -> Subscription:
        return cast(
            Subscription,
            self._http.request("POST", f"/v1/subscriptions/{subscription_id}/pause"),
        )

    def renew(
        self,
        subscription_id: str,
        *,
        collect_payment: bool | None = None,
        metadata: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> RenewResult:
        """Advances the subscription into its next billing period and issues
        that invoice — the same call the renewal schedule makes automatically."""
        body = compact({"collectPayment": collect_payment, "metadata": metadata})
        return cast(
            RenewResult,
            self._http.request(
                "POST",
                f"/v1/subscriptions/{subscription_id}/renew",
                body=body,
                idempotency_key=idempotency_key,
            ),
        )

    def list_transitions(self, subscription_id: str) -> builtins.list[SubscriptionTransition]:
        return cast(
            list[SubscriptionTransition],
            self._http.request("GET", f"/v1/subscriptions/{subscription_id}/transitions"),
        )
