import { CURRENCIES, type CurrencyCode, type Money } from "@tierstack/shared";

/**
 * The words a customer actually reads.
 *
 * Every template is a pure function returning subject, text and HTML together.
 * Plain text is not an afterthought: a good share of the audience reads mail in
 * clients that render HTML badly or not at all, and a billing message that
 * arrives as an unreadable block is a support ticket.
 *
 * Two rules run through all of them. Say the amount and the date plainly — a
 * customer should never have to work out what they are being charged or when.
 * And never link somewhere that cannot help: a pay link appears only when one
 * genuinely exists.
 */


/**
 * Money as a customer expects to see it: ₦5,000.00, not NGN 5,000.00.
 *
 * `formatMoney` in the shared package renders an ISO code, which is right for a
 * dashboard where several currencies sit in one table. A customer reading a
 * receipt for their own subscription knows what currency they pay in and wants
 * the symbol they see everywhere else. Integer division and a padded remainder,
 * so the presentation layer does not become the one place a float touches an
 * amount.
 */
export function formatCustomerMoney(value: Money): string {
  const currency = value.currency as CurrencyCode;
  const decimals: number = CURRENCIES[currency]?.minorUnits ?? 2;
  const symbol = CURRENCIES[currency]?.symbol ?? `${value.currency} `;
  const factor = 10 ** decimals;

  const negative = value.amount < 0;
  const absolute = Math.abs(value.amount);
  const whole = Math.trunc(absolute / factor);
  const fraction = absolute % factor;

  const grouped = whole.toLocaleString("en-US");
  const rendered =
    decimals === 0 ? grouped : `${grouped}.${String(fraction).padStart(decimals, "0")}`;

  return `${negative ? "-" : ""}${symbol}${rendered}`;
}

export interface TemplateContext {
  /** The merchant's name, not the platform's. Customers bought from them. */
  merchantName: string;
  customerName: string | null;
  supportEmail: string | null;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export interface PaymentFailedInput extends TemplateContext {
  amount: Money;
  invoiceNumber: string;
  attempt: number;
  maxAttempts: number;
  nextRetryAt: Date | null;
  payUrl: string | null;
  cardLabel: string | null;
}

export interface PaymentRecoveredInput extends TemplateContext {
  amount: Money;
  invoiceNumber: string;
}

export interface DunningExhaustedInput extends TemplateContext {
  amount: Money;
  invoiceNumber: string;
  outcome: "UNPAID" | "CANCELED" | "PAUSED";
  payUrl: string | null;
}

export interface PriceChangeInput extends TemplateContext {
  planName: string;
  oldAmount: Money;
  newAmount: Money;
  effectiveOn: Date;
  intervalLabel: string;
}

export interface TrialEndingInput extends TemplateContext {
  planName: string;
  amount: Money;
  endsOn: Date;
  intervalLabel: string;
  hasPaymentMethod: boolean;
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDay(date: Date): string {
  return DATE.format(date);
}

function greeting(name: string | null): string {
  return name ? `Hi ${name.split(" ")[0]},` : "Hi,";
}

function signoff(ctx: TemplateContext): string {
  return ctx.supportEmail
    ? `\n\nIf something looks wrong, reply to this email or write to ${ctx.supportEmail}.\n\n— ${ctx.merchantName}`
    : `\n\nIf something looks wrong, just reply to this email.\n\n— ${ctx.merchantName}`;
}

/**
 * Minimal, inline-styled HTML. No external stylesheet, no images, no tracking
 * pixel: billing mail should render identically in Gmail, Outlook and a phone
 * with images blocked, and it has no business measuring whether it was opened.
 */
function wrap(ctx: TemplateContext, heading: string, paragraphs: string[], cta?: { label: string; url: string }): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6;color:#1f2328;">${p}</p>`)
    .join("");
  const button = cta
    ? `<p style="margin:24px 0;"><a href="${cta.url}" style="background:#1f2328;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;">${cta.label}</a></p>`
    : "";
  const support = ctx.supportEmail
    ? `<p style="margin:24px 0 0;font-size:13px;color:#6b7280;">Questions? Reply to this email or write to <a href="mailto:${ctx.supportEmail}" style="color:#6b7280;">${ctx.supportEmail}</a>.</p>`
    : `<p style="margin:24px 0 0;font-size:13px;color:#6b7280;">Questions? Just reply to this email.</p>`;

  return [
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">`,
    `<h1 style="font-size:18px;margin:0 0 20px;color:#1f2328;">${heading}</h1>`,
    body,
    button,
    support,
    `<p style="margin:24px 0 0;font-size:13px;color:#6b7280;">${ctx.merchantName}</p>`,
    `</div>`,
  ].join("");
}

export function paymentFailed(input: PaymentFailedInput): RenderedEmail {
  const amount = formatCustomerMoney(input.amount);
  const card = input.cardLabel ? ` on your ${input.cardLabel}` : "";
  const isFinal = input.attempt >= input.maxAttempts || input.nextRetryAt === null;

  const whatNext = isFinal
    ? "This was the last automatic attempt, so the payment will not be retried again on its own."
    : `We will try again automatically on ${formatDay(input.nextRetryAt as Date)}. You do not need to do anything if the card will work by then.`;

  const subject = isFinal
    ? `Action needed: ${amount} could not be collected`
    : `We could not collect ${amount}`;

  const paragraphs = [
    `We tried to collect <strong>${amount}</strong> for invoice ${input.invoiceNumber}${card}, and it did not go through.`,
    "This is usually a temporary limit, an expired card or a bank declining an online charge — not a problem with your account.",
    whatNext,
  ];

  const text = [
    greeting(input.customerName),
    "",
    `We tried to collect ${amount} for invoice ${input.invoiceNumber}${card}, and it did not go through.`,
    "",
    "This is usually a temporary limit, an expired card or a bank declining an online charge — not a problem with your account.",
    "",
    whatNext,
    ...(input.payUrl ? ["", `Pay now: ${input.payUrl}`] : []),
    signoff(input),
  ].join("\n");

  return {
    subject,
    text,
    html: wrap(
      input,
      isFinal ? "We could not collect your payment" : "Your payment did not go through",
      paragraphs,
      input.payUrl ? { label: "Pay now", url: input.payUrl } : undefined
    ),
  };
}

export function paymentRecovered(input: PaymentRecoveredInput): RenderedEmail {
  const amount = formatCustomerMoney(input.amount);
  return {
    subject: `Payment received — ${amount}`,
    text: [
      greeting(input.customerName),
      "",
      `${amount} for invoice ${input.invoiceNumber} has gone through. Your subscription is active and nothing further is needed.`,
      signoff(input),
    ].join("\n"),
    html: wrap(input, "Payment received", [
      `<strong>${amount}</strong> for invoice ${input.invoiceNumber} has gone through.`,
      "Your subscription is active and nothing further is needed.",
    ]),
  };
}

export function dunningExhausted(input: DunningExhaustedInput): RenderedEmail {
  const amount = formatCustomerMoney(input.amount);
  const state = {
    UNPAID: "your subscription has been marked unpaid",
    CANCELED: "your subscription has been cancelled",
    PAUSED: "your subscription has been paused",
  }[input.outcome];

  return {
    subject: `Your subscription: ${amount} is still outstanding`,
    text: [
      greeting(input.customerName),
      "",
      `We were not able to collect ${amount} for invoice ${input.invoiceNumber} after several attempts, so ${state}.`,
      "",
      "Paying the outstanding invoice restores it.",
      ...(input.payUrl ? ["", `Pay now: ${input.payUrl}`] : []),
      signoff(input),
    ].join("\n"),
    html: wrap(
      input,
      "Your subscription needs attention",
      [
        `We were not able to collect <strong>${amount}</strong> for invoice ${input.invoiceNumber} after several attempts, so ${state}.`,
        "Paying the outstanding invoice restores it.",
      ],
      input.payUrl ? { label: "Pay now", url: input.payUrl } : undefined
    ),
  };
}

export function priceChange(input: PriceChangeInput): RenderedEmail {
  const from = formatCustomerMoney(input.oldAmount);
  const to = formatCustomerMoney(input.newAmount);
  const day = formatDay(input.effectiveOn);
  const rising = input.newAmount.amount > input.oldAmount.amount;

  return {
    subject: `Your ${input.planName} price changes on ${day}`,
    text: [
      greeting(input.customerName),
      "",
      `The price of ${input.planName} is changing from ${from} to ${to} ${input.intervalLabel}.`,
      "",
      `Your current period is unaffected. The new price applies from your next renewal on ${day}.`,
      "",
      rising
        ? "If you would rather not continue at the new price, you can cancel before that date and you will not be charged it."
        : "Nothing is needed from you.",
      signoff(input),
    ].join("\n"),
    html: wrap(input, `Your ${input.planName} price is changing`, [
      `The price of ${input.planName} is changing from <strong>${from}</strong> to <strong>${to}</strong> ${input.intervalLabel}.`,
      `Your current period is unaffected. The new price applies from your next renewal on <strong>${day}</strong>.`,
      rising
        ? "If you would rather not continue at the new price, you can cancel before that date and you will not be charged it."
        : "Nothing is needed from you.",
    ]),
  };
}

export function trialEnding(input: TrialEndingInput): RenderedEmail {
  const amount = formatCustomerMoney(input.amount);
  const day = formatDay(input.endsOn);

  const whatHappens = input.hasPaymentMethod
    ? `On ${day} we will charge ${amount} ${input.intervalLabel} to the card you have on file.`
    : `On ${day} your trial ends. There is no payment method on file, so we will send you an invoice to pay rather than charging you.`;

  return {
    subject: `Your ${input.planName} trial ends on ${day}`,
    text: [
      greeting(input.customerName),
      "",
      whatHappens,
      "",
      "If you do not want to continue, cancel before that date and nothing will be charged.",
      signoff(input),
    ].join("\n"),
    html: wrap(input, `Your trial ends on ${day}`, [
      whatHappens,
      "If you do not want to continue, cancel before that date and nothing will be charged.",
    ]),
  };
}

export interface MemberInvitedInput extends TemplateContext {
  role: string;
  acceptUrl: string;
  /** Whether the invitee already has an account and only needs to accept. */
  hasExistingAccount: boolean;
}

export function memberInvited(input: MemberInvitedInput): RenderedEmail {
  const role = input.role.charAt(0) + input.role.slice(1).toLowerCase();
  const action = input.hasExistingAccount
    ? "Accept to add it to your existing account."
    : "Accept to set a password and get started.";

  return {
    subject: `You've been invited to join ${input.merchantName}`,
    text: [
      greeting(input.customerName),
      "",
      `You've been invited to join ${input.merchantName} on Tierstack as a ${role}.`,
      "",
      action,
      "",
      input.acceptUrl,
      "",
      "This link expires in 7 days.",
      signoff(input),
    ].join("\n"),
    html: wrap(
      input,
      `Join ${input.merchantName}`,
      [`You've been invited to join <strong>${input.merchantName}</strong> on Tierstack as a ${role}.`, action],
      { label: "Accept invite", url: input.acceptUrl }
    ),
  };
}
