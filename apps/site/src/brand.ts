/**
 * The name, and the two URLs that leave this build.
 *
 * The name is a placeholder on purpose: it is not settled, and a landing page
 * is the worst place to discover that a decision was made by accident. Change
 * these lines and the whole site follows — including the link-preview card,
 * which is generated from this file rather than exported from a design tool,
 * so it can never fall out of date with the name.
 *
 * `siteUrl` is where this site is served from; every Open Graph and Twitter
 * URL is resolved against it. `appUrl` is where "Start building" goes. Both
 * come from the environment and a production build refuses to start without
 * them — see next.config.mjs.
 *
 * There is no docs URL: the documentation lives at /docs, in this app, built
 * from src/docs/content.ts. There is still no pricing page, deliberately —
 * pricing will run on the product itself.
 */
export const BRAND = {
  name: "Tierstack",
  /** Shown once, in the footer. */
  legalName: "Tierstack",
  tagline: "The billing layer between your product and your payment provider",
  /** One line, used on the link-preview card and in the default description. */
  claim: "Your payment provider moves the money. Tierstack runs the billing.",
  /** Where this site is served from. */
  siteUrl: process.env.SITE_URL ?? "http://localhost:3002",
  /** Where "Start building" goes. */
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
} as const;
