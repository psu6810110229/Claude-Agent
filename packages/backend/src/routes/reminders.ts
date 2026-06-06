import type { FastifyInstance } from "fastify";
import { idParamSchema } from "../schemas/common.js";
import {
  reminderSchema,
  reminderListResponseSchema,
} from "../schemas/reminder.js";
import {
  listReminders,
  getReminderById,
} from "../db/repositories/reminderRepo.js";

/**
 * Reminder read routes (Step 9). READ-ONLY. Reminders are created/updated/
 * archived ONLY through the approval queue (AI proposals → approve → executor);
 * there is deliberately no write endpoint here. "Overdue" is derived by the
 * caller (dashboard/brief) via the agenda helper — nothing fires automatically.
 */
export async function reminderRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/reminders", async () => {
    return reminderListResponseSchema.parse({ reminders: listReminders() });
  });

  app.get("/api/reminders/:id", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Invalid reminder id" });
    }
    const reminder = getReminderById(params.data.id);
    if (!reminder) return reply.code(404).send({ error: "Reminder not found" });
    return reminderSchema.parse(reminder);
  });
}
