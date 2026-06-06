import type { FastifyInstance } from "fastify";
import {
  activityQuerySchema,
  activityListResponseSchema,
} from "../schemas/activity.js";
import { listRecentActivity } from "../db/repositories/activityRepo.js";

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/activity", async (req, reply) => {
    const query = activityQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ error: query.error.issues[0].message });
    }
    const activity = listRecentActivity(query.data.limit);
    return activityListResponseSchema.parse({ activity });
  });
}
