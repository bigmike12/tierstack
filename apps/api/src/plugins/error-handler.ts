import { BillingError, failure, redact } from "@tierstack/shared";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.requestId ?? "req_unknown";

    if (error instanceof BillingError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, code: error.code }, "billing error");
      }
      return reply.status(error.statusCode).send(failure(error, requestId));
    }

    if (error instanceof ZodError) {
      const billingError = new BillingError(
        "VALIDATION_ERROR",
        "The request body failed validation.",
        error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
      );
      return reply.status(422).send(failure(billingError, requestId));
    }

    if ((error as { statusCode?: number }).statusCode === 429) {
      const billingError = new BillingError("RATE_LIMITED", "Too many requests. Slow down and retry.");
      return reply.status(429).send(failure(billingError, requestId));
    }

    if ((error as { code?: string }).code === "P2002") {
      const billingError = new BillingError("ALREADY_EXISTS", "A record with these unique values already exists.");
      return reply.status(409).send(failure(billingError, requestId));
    }

    request.log.error({ err: error, body: redact(request.body) }, "unhandled error");
    const fallback = new BillingError("INTERNAL_ERROR", "Something went wrong handling this request.");
    return reply.status(500).send(failure(fallback, requestId));
  });

  app.setNotFoundHandler((request, reply) => {
    const error = new BillingError(
      "INVALID_REQUEST",
      `No route for ${request.method} ${request.url}.`
    );
    return reply.status(404).send(failure(error, request.requestId ?? "req_unknown"));
  });
}
