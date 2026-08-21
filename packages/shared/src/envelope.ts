import { BillingError, type ErrorCode } from "./errors";

/** Every API response uses this shape — success and failure alike. */
export interface ApiEnvelope<T> {
  data: T | null;
  error: { code: ErrorCode | string; message: string; details?: unknown } | null;
  requestId: string;
}

export function success<T>(data: T, requestId: string): ApiEnvelope<T> {
  return { data, error: null, requestId };
}

export function failure(error: BillingError, requestId: string): ApiEnvelope<never> {
  return {
    data: null,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
    requestId,
  };
}
