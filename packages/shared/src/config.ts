/**
 * Internal project identifier. The final product name has not been selected, so
 * nothing in this codebase may hard-code a brand. Every user-visible name, URL,
 * package scope and email sender is resolved through this module.
 */
export const PROJECT_IDENTIFIER = "BILLING_PLATFORM" as const;

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
    appName: env.APP_NAME || PROJECT_IDENTIFIER,
    appUrl: env.APP_URL || "http://localhost:3000",
    apiUrl: env.API_URL || "http://localhost:4000",
    portalUrl: env.PORTAL_URL || "http://localhost:3001",
    emailSender: env.EMAIL_SENDER || "billing@localhost",
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
