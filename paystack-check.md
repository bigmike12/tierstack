Plans Engine & Paystack — Production Edge-Case Test Specification

Use the existing scripts/verify-paystack.ts as the baseline for the payment flow. Extend the test suite and implementation where necessary so that we can confidently determine whether the Plans Engine is safe and correct across real-world subscription, payment, webhook, renewal, trial, pricing, and grace-period scenarios.

Do not replace the existing Paystack verification flow. Build on it.

The objective is to test the complete lifecycle:

User
  ↓
Create subscription
  ↓
Create invoice/payment attempt
  ↓
Paystack checkout
  ↓
Payment
  ↓
Paystack webhook
  ↓
Payment settlement
  ↓
Invoice
  ↓
Subscription state
  ↓
Entitlement/access
  ↓
Recurring renewal
  ↓
Failure/retry/grace period


For every scenario below:

Determine the current implementation behavior.
Determine whether that behavior is intentional.
Add an automated test where practical.
Fix incorrect behavior rather than merely documenting it.
Ensure tests do not rely on arbitrary sleeps where deterministic event/state control is possible.
Clearly identify anything that requires a real Paystack integration test rather than a unit/integration test.
Do not weaken existing tests merely to make them pass.
1. Initial Subscription / Checkout

Verify the complete initial subscription flow.

Successful checkout

Verify:

Subscription is created as INCOMPLETE before payment.
Invoice is created.
Payment attempt is created.
Correct payment provider is selected.
Paystack checkout URL is returned.
No payment is marked successful before Paystack confirms it.
User can complete checkout.
charge.success webhook is received.
Webhook signature is verified.
Payment becomes successful.
Invoice becomes PAID.
Subscription becomes ACTIVE.
Correct plan/price is associated with the subscription.
User abandons checkout

Start a checkout and abandon it.

Verify:

Subscription does not become ACTIVE.
Invoice does not become PAID.
Payment does not become SUCCEEDED.
The payment attempt remains in the correct pending/failed state.
The system does not automatically grant paid access.
The user can safely retry payment.
User closes the browser after payment

Complete payment but close/interrupt the browser before returning to the application.

Verify that the webhook still activates the subscription.

The browser callback must not be the source of truth for payment success.

User returns to the application before webhook arrival

Verify that the application handles the temporary state correctly.

The subscription should not appear paid simply because the user returned from Paystack.

2. Duplicate Requests / Idempotency

Test duplicate subscription creation requests.

Send the same request multiple times with the same idempotency key.

Expected behavior:

1 subscription
1 invoice
1 payment attempt
1 Paystack checkout/payment initialization


There must not be duplicate subscriptions or duplicate charges.

Also test:

Same request with different idempotency keys.
Same idempotency key with different request payloads.
Concurrent duplicate requests.
Client retry after network timeout.
Client retry after receiving a 500 response.

Verify that idempotency behavior is documented and deterministic.

3. Webhook Edge Cases

Webhooks are critical because they drive the authoritative payment state.

Test:

Duplicate webhook

Send the same charge.success event twice.

Expected:

First event processes normally.
Second event is safely ignored/idempotently processed.
No duplicate invoice payment.
No duplicate subscription activation.
No duplicate entitlement.
No duplicate payment method.
Webhook arrives before API response

Simulate the webhook arriving immediately after payment creation.

Verify that the system can handle the event even if the initiating API request has not completely finished.

Webhook arrives late

Verify that a delayed webhook can still settle the correct payment.

Webhook arrives out of order

Test relevant Paystack events arriving in an unexpected order.

The subscription state must not move backwards incorrectly.

Invalid webhook signature

Send a webhook with an invalid signature.

Expected:

Request rejected.
Event not processed.
Payment remains unchanged.
Subscription remains unchanged.
No entitlement is granted.
Unknown webhook

Send a validly signed webhook for a transaction that does not exist in the local database.

Verify that it is safely classified as unmatched rather than being applied to another payment.

Wrong organization

Verify that a webhook belonging to another organization cannot mutate the current organization's subscription.

Malformed webhook

Test:

Missing transaction reference.
Missing event type.
Missing customer information.
Invalid amount.
Invalid currency.
Invalid metadata.
Unexpected payload structure.

The webhook handler must fail safely.

4. Payment Amount Integrity

Never trust the amount supplied by the client.

Test:

Client says: ₦5,000
Server price: ₦10,000


The server must charge the authoritative plan price.

Test:

Modified price ID.
Modified amount.
Modified currency.
Negative amount.
Zero amount.
Extremely large amount.
Decimal/fractional values.
Old/inactive price ID.

Verify that the amount sent to Paystack matches the authoritative server-side price.

5. Price Changes

Test what happens when a business changes a plan's price.

Example:

Original price: ₦5,000
Existing subscriber: ₦5,000
New plan price: ₦7,500


Determine and enforce the intended behavior.

At minimum verify:

New subscriptions use ₦7,500.
Existing invoices are not silently rewritten.
Existing subscriptions do not unexpectedly change price.
Historical payment records retain the original amount.
Payment records remain auditable.
Renewal behavior follows the documented pricing policy.

If subscriptions are intended to retain their original price, ensure the subscription/billing state contains the necessary price snapshot rather than dynamically reading the current plan price.

6. Billing Intervals

Test every supported billing interval.

For example:

Monthly.
Yearly.
Weekly, if supported.
Any custom interval supported by the system.

Verify:

currentPeriodStart.
currentPeriodEnd.
nextBillingDate.
Renewal timing.
Invoice generation.
Renewal amount.

Test difficult calendar boundaries:

January 31.
February 28.
February 29.
Month-end.
Year-end.
Leap years.

Do not implement billing intervals using naive fixed-day assumptions where calendar-aware behavior is required.

7. Trial Periods

Test plans with:

No trial.
1-day trial.
7-day trial.
Longer trial.

Verify:

Subscription
    ↓
TRIALING
    ↓
trialEndsAt
    ↓
trial expires
    ↓
payment attempt
    ↓
ACTIVE


Test:

Correct trial start.
Correct trial end.
Access during trial.
No premature payment.
Payment at trial end.
Successful payment after trial.
Failed payment after trial.
Trial cancellation.
User attempting to create multiple trials.
Trial configuration changing while a user is already trialing.

Changing a plan's trial configuration must not unexpectedly rewrite an existing user's already-calculated trial period unless that is explicitly intended.

8. Grace Periods

Test the complete grace-period lifecycle.

Example:

Grace period = 7 days

User enters grace:
August 23

Expected:
gracePeriodStartedAt = August 23
gracePeriodEndsAt = August 30


Then change the plan configuration:

Grace period = 5 days


Verify that the existing user still has:

August 23 → August 30


and is not retroactively shortened to:

August 23 → August 28


A configuration change should normally affect users who enter grace after the change, not users already in an active grace period.

Also test:

User enters grace.
Payment succeeds during grace.
Payment fails during grace.
Retry succeeds during grace.
Grace expires.
Grace is extended/restarted accidentally.
Subscription is cancelled during grace.
Plan changes during grace.
Grace configuration changes during grace.
Multiple failed invoices for the same subscription.

The grace-period clock must not unexpectedly reset every time another payment attempt occurs.

9. Failed Payments

Test failed initial payments.

Verify:

Subscription does not become ACTIVE.
Invoice does not become PAID.
Payment attempt records the failure.
Failure reason/code is stored appropriately.
User can retry.
Retry does not create duplicate subscriptions.

Test failed renewal payments.

Expected lifecycle should be explicitly defined, for example:

ACTIVE
  ↓
renewal fails
  ↓
PAST_DUE / GRACE
  ↓
retry
  ↓
success → ACTIVE
failure → grace expires


Verify the actual implementation matches the intended lifecycle.

10. Recurring Payments

Use the stored payment method created by the initial Paystack payment.

Verify:

Renewal does not require checkout.
Correct stored payment method is selected.
Correct renewal amount is charged.
Correct interval is applied.
Invoice is created for the new period.
Payment attempt is created.
Paystack response is recorded.
Webhook settles the renewal.
Subscription remains ACTIVE.
New billing period is calculated correctly.

Test:

Successful renewal.
Failed renewal.
Retry.
Multiple renewal requests.
Concurrent renewal requests.
Renewal after cancellation.
Renewal after grace expiration.
Renewal when payment method is no longer valid.
11. Double-Charging Protection

This is a high-priority production scenario.

Simulate:

POST /renew
POST /renew


at nearly the same time.

Verify that the customer cannot be charged twice for the same billing period.

Also test:

Request timeout followed by retry.
Worker retry.
Webhook retry.
Queue retry.
Server restart during renewal.
Payment provider timeout after the provider may already have accepted the charge.

The system must be designed around provider/payment idempotency and local state transitions so that uncertainty does not result in duplicate charges.

12. Payment Provider Failures

Test:

Paystack unavailable.
Network timeout.
DNS failure.
Provider returns 500.
Provider returns malformed response.
Provider rejects credentials.
Provider rejects transaction.
Provider returns an unknown error code.

Verify:

Payment attempt records the failure.
Subscription state remains consistent.
Invoice remains unpaid.
No false activation occurs.
Retry is possible.
Fallback behavior is explicit if multiple payment providers exist.

Do not silently fall through to another payment rail unless that behavior is explicitly supported and safe for the transaction.

13. Payment Provider Routing

Using the existing routing logic, test:

Paystack default.
Paystack disabled.
Paystack enabled but invalid credentials.
MOCK enabled.
MOCK disabled.
Multiple enabled providers.
Different priorities.
Default provider changes.

Verify that the selected provider is deterministic and recorded on the payment attempt.

A payment must never silently move between providers in a way that makes reconciliation impossible.

14. Payment Method Lifecycle

Test:

Payment method created after successful payment.
Payment method not created after failed payment.
Duplicate payment method events.
Expired card.
Deleted/disabled payment method.
Multiple cards/payment methods.
Default payment method selection.
Renewal using the correct payment method.

Verify that raw card information is never stored.

Only the minimum necessary provider reference/token and non-sensitive display information should be persisted.

15. Cancellation

Test cancellation at every important point:

Before checkout.
During trial.
While active.
During grace.
After failed renewal.
Immediately before renewal.
Immediately after renewal.

Determine whether cancellation means:

cancel immediately


or:

cancel at period end


and test the chosen behavior.

Verify that:

Future renewals stop.
Existing entitlement behaves correctly.
Invoice history remains intact.
Payment method is not accidentally deleted if it is still needed.
A cancelled subscription cannot accidentally renew.
16. Plan Changes

If plan upgrades/downgrades are supported, test:

Active → higher-priced plan.
Active → lower-priced plan.
Monthly → yearly.
Yearly → monthly.
Trial → different plan.
Grace → different plan.
Plan change immediately before renewal.
Plan change immediately after renewal.

Explicitly define:

Proration.
Effective date.
Existing invoice behavior.
Next renewal amount.
Existing trial behavior.
Existing grace behavior.

Do not assume that changing the plan record automatically means existing subscriptions should change.

17. Access / Entitlement Integrity

Payment state and access state must remain consistent.

Test that users receive paid access only when the subscription state allows it.

Verify:

INCOMPLETE → no paid entitlement
TRIALING   → trial entitlement
ACTIVE     → paid entitlement
GRACE      → intended grace entitlement
EXPIRED    → no paid entitlement
CANCELLED  → behavior according to cancellation policy


Test transitions in both directions.

A payment success must not activate the wrong user.

18. Currency Handling

Test:

NGN.
Every other supported currency.
Currency mismatch between price and provider.
Currency changes.
Unsupported currency.
Zero/negative currency amounts.

Ensure that amounts are represented consistently, preferably in the smallest currency unit where appropriate.

For example:

₦5,000
→
500000 kobo


Do not introduce floating-point billing errors.

19. Security / PCI Boundary

Inspect the entire Paystack flow and verify that:

Raw card numbers never reach application storage.
CVV/PIN/OTP are never stored.
Payment secrets are server-side only.
Paystack secret keys never reach the frontend.
Secrets are not written to logs.
Request logging does not expose payment credentials.
Webhook signatures are verified.
Payment status is determined server-side.
Client-provided payment status cannot activate a subscription.
Test credentials cannot accidentally be used against production.
Production credentials cannot accidentally be used by local verification scripts.

Document exactly what payment data the application stores and what is delegated to Paystack.

20. NDPR / Personal Data Boundary

Identify all personal data involved in the subscription flow.

Review:

Customer email.
Name.
Phone number.
External customer ID.
Payment metadata.
Subscription history.
Invoice history.
Payment method metadata.
Webhook payloads.
Application logs.

Verify that sensitive or unnecessary personal information isn't unnecessarily copied into:

Logs.
Payment attempts.
Webhook events.
Error messages.
Analytics.
Debug output.

Document third-party data flows, especially the information sent to Paystack.

This is an engineering scope review, not a legal certification.

21. Database Consistency

Test failures occurring between every major state transition.

For example:

Payment succeeds
      ↓
DB write fails


or:

Invoice marked PAID
      ↓
Subscription activation fails


or:

Subscription activated
      ↓
Webhook processing crashes


Verify that transactions, retries, reconciliation, or idempotent processing can recover these states.

There must be no permanent state where:

payment = PAID
invoice = UNPAID
subscription = INCOMPLETE


without a deliberate reconciliation mechanism.

22. Reconciliation

Implement or verify a way to identify discrepancies between:

Paystack
vs
PaymentAttempt
vs
Invoice
vs
Subscription


Test scenarios where one system says paid and another does not.

The system should have a clear recovery/reconciliation path rather than requiring manual database edits.

23. Time and Timezone

Verify all subscription dates use a consistent timezone strategy.

Test around:

Midnight.
Month-end.
Year-end.
DST transitions where relevant.
UTC/local timezone boundaries.
Server running in a different timezone from the user.

Persist timestamps consistently and calculate billing periods deterministically.

24. Webhook Retry / Server Restart

Simulate:

Paystack webhook arrives
        ↓
server crashes


Then resend/retry the webhook.

Verify that processing is idempotent.

Also test:

Server restart between payment creation and webhook.
Server restart during renewal.
Server restart after invoice creation.
Worker restart during subscription state transition.

The system must recover without duplicate payments or corrupted subscription state.

25. Test Data Isolation

Ensure the verification script cannot accidentally:

Charge a live Paystack account.
Use production credentials unintentionally.
Modify production subscriptions.
Send real customer emails.
Pollute production webhook/event tables.

Make test-mode usage explicit and fail fast when production credentials or production endpoints are detected.

26. Final End-to-End Scenarios

Create high-level end-to-end tests for these complete journeys.

Scenario A — Successful paid subscription
Create subscription
→ Paystack Checkout
→ successful payment
→ webhook
→ invoice PAID
→ subscription ACTIVE
→ entitlement granted

Scenario B — Abandoned checkout
Create subscription
→ Paystack Checkout
→ user abandons
→ subscription remains INCOMPLETE
→ no entitlement
→ user retries

Scenario C — Trial → Paid
Create trial subscription
→ TRIALING
→ trial expires
→ payment succeeds
→ ACTIVE

Scenario D — Renewal
ACTIVE
→ billing period ends
→ stored payment method charged
→ webhook
→ new invoice PAID
→ next billing period

Scenario E — Renewal failure → Grace → Recovery
ACTIVE
→ renewal fails
→ GRACE
→ retry succeeds
→ ACTIVE

Scenario F — Grace configuration changes
Grace = 7 days
→ user enters grace
→ graceEndsAt calculated
→ admin changes grace = 5 days
→ existing user's graceEndsAt remains unchanged
→ new grace entry uses 5 days

Scenario G — Price change
Existing subscription = ₦5,000
→ admin changes plan price to ₦7,500
→ existing billing state remains consistent
→ new subscription uses ₦7,500
→ historical invoices remain ₦5,000

Scenario H — Duplicate webhook
Payment succeeds
→ webhook #1
→ webhook #2
→ exactly one payment settlement
→ exactly one invoice settlement
→ exactly one subscription transition

Scenario I — Duplicate renewal request
renew()
renew()
simultaneously
→ exactly one billing period
→ exactly one charge

27. Deliverables

After implementing the tests and fixes, produce:

A comprehensive automated test suite for the Plans Engine.
An updated scripts/verify-paystack.ts where real Paystack interaction is required.
Unit/integration tests for deterministic business logic.
End-to-end tests for critical lifecycle paths.
Documentation of subscription states and transitions.
Documentation of pricing, trial, billing interval, and grace-period semantics.
Documentation of what happens when plan configuration changes.
Documentation of the Paystack payment/webhook flow.
Documentation of the application's PCI/payment-data boundary.
A list of any remaining known limitations.

At the end, provide a readiness report with:

PAYSTACK INTEGRATION: PASS / FAIL
SUBSCRIPTION LIFECYCLE: PASS / FAIL
RECURRING BILLING: PASS / FAIL
TRIALS: PASS / FAIL
GRACE PERIODS: PASS / FAIL
PRICE CHANGES: PASS / FAIL
WEBHOOK SAFETY: PASS / FAIL
IDEMPOTENCY: PASS / FAIL
PAYMENT FAILURE HANDLING: PASS / FAIL
ENTITLEMENTS: PASS / FAIL
SECURITY REVIEW: PASS / FAIL
DATA HANDLING REVIEW: PASS / FAIL

OVERALL:
READY
READY WITH LIMITATIONS
NOT READY


For every failure, provide:

What failed.
Why it failed.
Whether it is a code defect, test limitation, configuration issue, or intentional behavior.
The recommended fix.
Whether the fix is required before production.