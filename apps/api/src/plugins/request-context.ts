import { newRequestId } from "@billing-platform/shared";
import type { FastifyInstance } from "fastify";

/**
 * Stamps every request with an id, echoes it in the response header, and puts
 * it in the response envelope so a developer can quote one id in support.
 */
export function registerRequestContext(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    const inbound = request.headers["x-request-id"];
    request.requestId = typeof inbound === "string" && inbound.length <= 64 ? inbound : newRequestId();
    reply.header("x-request-id", request.requestId);
  });
}
