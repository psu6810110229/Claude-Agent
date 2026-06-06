import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health.js";
import { taskRoutes } from "./routes/tasks.js";
import { activityRoutes } from "./routes/activity.js";
import { approvalRoutes } from "./routes/approvals.js";

/** Builds the Fastify instance (without listening) so it can be reused in tests. */
export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(healthRoutes);
  app.register(taskRoutes);
  app.register(activityRoutes);
  app.register(approvalRoutes);
  return app;
}
