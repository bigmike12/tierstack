/**
 * The lists that appear on more than one page, in one place.
 *
 * Two pages disagreeing about what is built is the exact failure this site
 * spends a whole page arguing it does not have, so the lists are not retyped.
 */

/** The same eleven items on both sides of the comparison. That is the argument. */
export const BILLING_WORK = [
  "Subscriptions",
  "Invoices",
  "Renewals",
  "Retries",
  "Grace periods",
  "Provider webhooks",
  "Proration",
  "Price changes",
  "Usage",
  "Entitlements",
  "Billing portal",
];

export const CAPABILITIES = [
  {
    group: "Plans and pricing",
    line: "What you sell, and what it costs.",
    items: ["Plans", "Prices", "Billing intervals", "Multi-currency", "Price versioning"],
  },
  {
    group: "Subscriptions",
    line: "Who is on what, and what happens when that changes.",
    items: [
      "Recurring subscriptions",
      "Plan changes",
      "Upgrades and downgrades",
      "Proration",
      "Cancel and resume",
    ],
  },
  {
    group: "Payments",
    line: "Getting the money, through whichever rail you use.",
    items: [
      "Payment attempts",
      "Payment methods",
      "Provider routing",
      "Inbound provider webhooks",
      "Idempotency",
      "Refunds",
    ],
  },
  {
    group: "Revenue recovery",
    line: "What happens after a card is declined.",
    items: ["Failed payments", "Grace periods", "Retry ladders", "Dunning", "Recovery emails"],
  },
  {
    group: "Usage",
    line: "Charging for what people actually consume.",
    items: ["Usage meters", "Event ingestion", "Quotas", "Overages", "Metered billing"],
  },
  {
    group: "Customer billing",
    line: "What your customers see and do themselves.",
    items: [
      "Invoices",
      "Billing history",
      "Customer portal",
      "Outstanding payments",
      "Self-serve subscriptions",
    ],
  },
];

export const WORKING = [
  "Plans, prices, every billing interval, several currencies",
  "Subscriptions, upgrades, downgrades and proration",
  "Price versioning, with subscribers moved at their next renewal",
  "Invoices, usage metering and entitlements",
  "Paystack — checkout, webhooks, stored cards, unattended renewals",
  "Failed-payment recovery and the emails that go with it",
  "A billing portal your customers use themselves",
];

export const NOT_YET = [
  "Monnify and Flutterwave — the adapters are not written",
  "TypeScript and React client libraries — the API is HTTP for now",
  "Outbound webhooks to your application — provider webhooks come in, none go out",
  "Coupons and referrals",
  "Public pricing — it will run on this product, so the page waits for the product",
];
