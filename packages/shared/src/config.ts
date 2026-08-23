/**
 * Branding.
 *
 * The product is Tierbase. The indirection here is kept deliberately: every
 * user-visible name, URL and email sender still resolves through configuration
 * rather than being written into the engine, so a rebrand, a white-label
 * deployment or a second domain is an environment change and nothing more.
 */
export const PROJECT_IDENTIFIER = "TIERBASE" as const;

/** Display name used when nothing overrides it. */
export const DEFAULT_APP_NAME = "Tierbase";

/** Registrable domain the hosted product runs on. */
export const DEFAULT_DOMAIN = "gettierbase.com";

export interface BrandingConfig {
  /** Display name used in dashboards, portal copy and emails. */
  appName: string;
  /** Public base URL of the dashboard application. */
  appUrl: string;
  /** Public base URL of the REST API. */
  apiUrl: string;
  /** Public base URL of the customer billing portal. */
  portalUrl: string;
  /** From-address used for transactional email. */
  emailSender: string;
  /** Prefix used for the customer-facing invoice number sequence. */
  invoiceNumberPrefix: string;
}

export function loadBranding(env: NodeJS.ProcessEnv = process.env): BrandingConfig {
  return {
    appName: env.APP_NAME || DEFAULT_APP_NAME,
    appUrl: env.APP_URL || "http://localhost:8181",
    apiUrl: env.API_URL || "http://localhost:4000",
    portalUrl: env.PORTAL_URL || "http://localhost:3001",
    emailSender: env.EMAIL_SENDER || `billing@${DEFAULT_DOMAIN}`,
    invoiceNumberPrefix: env.INVOICE_NUMBER_PREFIX || "INV",
  };
}

export type BillingEnvironment = "test" | "live";

export function loadBillingEnvironment(env: NodeJS.ProcessEnv = process.env): BillingEnvironment {
  const value = env.BILLING_ENV || "test";
  if (value !== "test" && value !== "live") {
    throw new Error(`BILLING_ENV must be "test" or "live", received "${value}"`);
  }
  return value;
}
