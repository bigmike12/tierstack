import { describe, expect, it } from "vitest";
import { money } from "@tierstack/shared";
import {
  dunningExhausted,
  formatCustomerMoney,
  formatDay,
  paymentFailed,
  paymentRecovered,
  priceChange,
  trialEnding,
} from "./templates";

const ctx = {
  merchantName: "Kola Labs",
  customerName: "Amara Okafor",
  supportEmail: "help@kolalabs.test",
};

describe("paymentFailed", () => {
  const base = {
    ...ctx,
    amount: money(500_000, "NGN"),
    invoiceNumber: "INV-0007",
    attempt: 1,
    maxAttempts: 4,
    nextRetryAt: new Date("2026-09-03T09:00:00Z"),
    payUrl: null,
    cardLabel: "visa ending 4081",
  };

  it("says the amount in the customer's currency, not in minor units", () => {
    // 500000 kobo is ₦5,000. A customer told they owe 500,000 will panic.
    expect(paymentFailed(base).text).toContain("₦5,000.00");
    expect(paymentFailed(base).text).not.toContain("500000");
  });

  it("names the date of the next attempt", () => {
    expect(paymentFailed(base).text).toContain("3 September 2026");
  });

  it("tells the customer they need do nothing when a retry is coming", () => {
    expect(paymentFailed(base).text).toContain("do not need to do anything");
  });

  it("changes its tone on the final attempt", () => {
    const final = paymentFailed({ ...base, attempt: 4, nextRetryAt: null });
    expect(final.subject).toContain("Action needed");
    expect(final.text).toContain("last automatic attempt");
  });

  it("treats a missing retry date as final even mid-schedule", () => {
    const final = paymentFailed({ ...base, attempt: 2, nextRetryAt: null });
    expect(final.text).toContain("last automatic attempt");
  });

  it("does not blame the customer", () => {
    expect(paymentFailed(base).text).toContain("not a problem with your account");
  });

  it("includes a pay link only when there is one", () => {
    expect(paymentFailed(base).text).not.toContain("Pay now");
    expect(paymentFailed({ ...base, payUrl: "https://pay.test/abc" }).text).toContain("https://pay.test/abc");
  });

  it("mentions the card without ever printing a full number", () => {
    const rendered = paymentFailed(base).text;
    expect(rendered).toContain("ending 4081");
    expect(rendered).not.toMatch(/\d{13,}/);
  });

  it("renders both a text and an HTML body", () => {
    const rendered = paymentFailed(base);
    expect(rendered.text.length).toBeGreaterThan(80);
    expect(rendered.html).toContain("<p");
  });

  it("signs off as the merchant, not the platform", () => {
    expect(paymentFailed(base).text).toContain("Kola Labs");
    expect(paymentFailed(base).text).not.toContain("Tierstack");
  });
});

describe("paymentRecovered", () => {
  it("confirms the amount and closes the loop", () => {
    const rendered = paymentRecovered({
      ...ctx,
      amount: money(500_000, "NGN"),
      invoiceNumber: "INV-0007",
    });
    expect(rendered.subject).toContain("₦5,000.00");
    expect(rendered.text).toContain("nothing further is needed");
  });
});

describe("dunningExhausted", () => {
  const base = {
    ...ctx,
    amount: money(500_000, "NGN"),
    invoiceNumber: "INV-0007",
    payUrl: "https://pay.test/abc",
  };

  it("says what actually happened to the subscription", () => {
    expect(dunningExhausted({ ...base, outcome: "PAUSED" }).text).toContain("has been paused");
    expect(dunningExhausted({ ...base, outcome: "CANCELED" }).text).toContain("has been cancelled");
    expect(dunningExhausted({ ...base, outcome: "UNPAID" }).text).toContain("marked unpaid");
  });

  it("tells them how to get it back", () => {
    expect(dunningExhausted({ ...base, outcome: "UNPAID" }).text).toContain("restores it");
    expect(dunningExhausted({ ...base, outcome: "UNPAID" }).text).toContain("https://pay.test/abc");
  });
});

describe("priceChange", () => {
  const base = {
    ...ctx,
    planName: "Pro",
    oldAmount: money(1_000_000, "NGN"),
    newAmount: money(1_500_000, "NGN"),
    effectiveOn: new Date("2026-09-14T00:00:00Z"),
    intervalLabel: "per month",
  };

  it("puts the date in the subject line, where it cannot be missed", () => {
    expect(priceChange(base).subject).toContain("14 September 2026");
  });

  it("states both the old and new amount", () => {
    expect(priceChange(base).text).toContain("₦10,000.00");
    expect(priceChange(base).text).toContain("₦15,000.00");
  });

  it("is explicit that the current period is unaffected", () => {
    expect(priceChange(base).text).toContain("current period is unaffected");
  });

  it("offers the way out on a rise, which is what keeps it out of a chargeback", () => {
    expect(priceChange(base).text).toContain("cancel before that date");
  });

  it("does not offer a way out on a reduction", () => {
    const cheaper = priceChange({ ...base, newAmount: money(800_000, "NGN") });
    expect(cheaper.text).toContain("Nothing is needed from you");
    expect(cheaper.text).not.toContain("cancel before that date");
  });
});

describe("trialEnding", () => {
  const base = {
    ...ctx,
    planName: "Pro",
    amount: money(1_000_000, "NGN"),
    endsOn: new Date("2026-09-05T00:00:00Z"),
    intervalLabel: "per month",
    hasPaymentMethod: true,
  };

  it("says what will be charged and when", () => {
    expect(trialEnding(base).text).toContain("₦10,000.00");
    expect(trialEnding(base).text).toContain("5 September 2026");
  });

  it("does not promise a charge when there is no card on file", () => {
    const cardless = trialEnding({ ...base, hasPaymentMethod: false });
    expect(cardless.text).toContain("no payment method on file");
    expect(cardless.text).not.toContain("we will charge");
  });

  it("tells them how to avoid the charge", () => {
    expect(trialEnding(base).text).toContain("cancel before that date");
  });
});

describe("formatDay", () => {
  it("writes a date a person can read, in UTC", () => {
    expect(formatDay(new Date("2026-01-09T23:30:00Z"))).toBe("9 January 2026");
  });
});

describe("formatCustomerMoney", () => {
  it("uses the symbol a customer recognises, not the ISO code", () => {
    expect(formatCustomerMoney(money(500_000, "NGN"))).toBe("₦5,000.00");
    expect(formatCustomerMoney(money(2_900, "USD"))).toBe("$29.00");
  });

  it("groups thousands", () => {
    expect(formatCustomerMoney(money(123_456_789, "NGN"))).toBe("₦1,234,567.89");
  });

  it("keeps trailing zeros, because money reads wrong without them", () => {
    expect(formatCustomerMoney(money(1_000_000, "NGN"))).toBe("₦10,000.00");
    expect(formatCustomerMoney(money(1_000_050, "NGN"))).toBe("₦10,000.50");
  });

  it("handles zero and negatives", () => {
    expect(formatCustomerMoney(money(0, "NGN"))).toBe("₦0.00");
    expect(formatCustomerMoney(money(-50_000, "NGN"))).toBe("-₦500.00");
  });
});
