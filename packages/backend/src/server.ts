import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health.js";
import { taskRoutes } from "./routes/tasks.js";
import { activityRoutes } from "./routes/activity.js";
import { approvalRoutes } from "./routes/approvals.js";
import { memoryRoutes } from "./routes/memory.js";
import { commandRoutes } from "./routes/command.js";
import { briefRoutes } from "./routes/briefs.js";
import type { ClaudeInvoker } from "./services/claudeClient.js";

export interface BuildServerOptions {
  /** Inject a stub Claude invoker (tests). Defaults to the real `claude -p`. */
  aiInvoker?: ClaudeInvoker;
}

/** Builds the Fastify instance (without listening) so it can be reused in tests. */
export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(healthRoutes);
  app.register(taskRoutes);
  app.register(activityRoutes);
  app.register(approvalRoutes);
  app.register(memoryRoutes);
  app.register(commandRoutes, { aiInvoker: options.aiInvoker });
  app.register(briefRoutes, { aiInvoker: options.aiInvoker });
  return app;
}
