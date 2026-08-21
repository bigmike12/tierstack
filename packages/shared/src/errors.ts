/**
 * Every error the API can return has a stable machine-readable code. Codes are
 * part of the public contract: the SDK switches on them, so they must not be
 * renamed once released.
 */
export const ERROR_CODES = {
  // Auth / tenancy
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_API_KEY: 401,
  API_KEY_REVOKED: 401,
  FORBIDDEN: 403,
  INSUFFICIENT_PERMISSIONS: 403,
  ENVIRONMENT_MISMATCH: 403,
  CROSS_TENANT_ACCESS: 403,

  // Validation
  VALIDATION_ERROR: 422,
  INVALID_REQUEST: 400,
  UNSUPPORTED_CURRENCY: 400,
  CURRENCY_MISMATCH: 400,
  INVALID_BILLING_INTERVAL: 400,
  INVALID_STATE_TRANSITION: 409,

  // Not found
  ORGANIZATION_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  MEMBER_NOT_FOUND: 404,
  API_KEY_NOT_FOUND: 404,
  PLAN_NOT_FOUND: 404,
  PRICE_NOT_FOUND: 404,
  CUSTOMER_NOT_FOUND: 404,
  SUBSCRIPTION_NOT_FOUND: 404,
  INVOICE_NOT_FOUND: 404,
  PAYMENT_METHOD_NOT_FOUND: 404,
  PAYMENT_ATTEMPT_NOT_FOUND: 404,
  PROVIDER_CONFIG_NOT_FOUND: 404,

  // Conflict
  ALREADY_EXISTS: 409,
  EMAIL_ALREADY_REGISTERED: 409,
  CUSTOMER_ALREADY_EXISTS: 409,
  PLAN_CODE_ALREADY_EXISTS: 409,
  INVOICE_ALREADY_PAID: 409,
  INVOICE_NOT_PAYABLE: 409,
  SUBSCRIPTION_ALREADY_CANCELED: 409,
  IDEMPOTENCY_KEY_REUSE: 409,
  IDEMPOTENCY_REQUEST_IN_PROGRESS: 409,

  // Payments
  NO_PAYMENT_PROVIDER_CONFIGURED: 400,
  NO_ELIGIBLE_PAYMENT_PROVIDER: 400,
  UNSUPPORTED_PROVIDER_CAPABILITY: 400,
  PROVIDER_ERROR: 502,
  PAYMENT_FAILED: 402,
  NO_PAYMENT_METHOD: 400,

  // Infrastructure
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  NOT_IMPLEMENTED: 501,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class BillingError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "BillingError";
    this.code = code;
    this.statusCode = ERROR_CODES[code];
    this.details = details;
    Error.captureStackTrace?.(this, BillingError);
  }

  static notFound(code: ErrorCode, what: string): BillingError {
    return new BillingError(code, `${what} was not found.`);
  }
}

/**
 * Thrown when the billing engine asks a provider adapter for something the
 * provider genuinely cannot do. The engine must check capabilities first; this
 * is the backstop that guarantees we never silently fake a capability.
 */
export class UnsupportedCapabilityError extends BillingError {
  constructor(provider: string, capability: string) {
    super(
      "UNSUPPORTED_PROVIDER_CAPABILITY",
      `Provider ${provider} does not support the "${capability}" capability.`,
      { provider, capability }
    );
    this.name = "UnsupportedCapabilityError";
  }
}
