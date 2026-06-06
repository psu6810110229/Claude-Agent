import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health.js";

/** Builds the Fastify instance (without listening) so it can be reused in tests. */
export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(healthRoutes);
  return app;
}
