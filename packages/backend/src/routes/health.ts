import type { FastifyInstance } from "fastify";
import { healthResponseSchema } from "../schemas/health.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => {
    // Validate the response payload through Zod before returning.
    return healthResponseSchema.parse({ status: "ok" });
  });
}
