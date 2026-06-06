import type { FastifyInstance } from "fastify";
import { idParamSchema } from "../schemas/common.js";
import { eventSchema, eventListResponseSchema } from "../schemas/event.js";
import { listEvents, getEventById } from "../db/repositories/eventRepo.js";

/**
 * Event read routes (Step 9). READ-ONLY. Events are created/updated/archived
 * ONLY through the approval queue (AI proposals → approve → executor); there is
 * deliberately no write endpoint here.
 */
export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/events", async () => {
    return eventListResponseSchema.parse({ events: listEvents() });
  });

  app.get("/api/events/:id", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Invalid event id" });
    }
    const event = getEventById(params.data.id);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    return eventSchema.parse(event);
  });
}
