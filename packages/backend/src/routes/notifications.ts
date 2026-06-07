import type { FastifyInstance } from "fastify";
import { idParamSchema } from "../schemas/common.js";
import {
  notificationSchema,
  notificationListResponseSchema,
} from "../schemas/notification.js";
import {
  listNotifications,
  listUnreadNotifications,
  getNotificationById,
  markNotificationRead,
} from "../db/repositories/notificationRepo.js";

/**
 * Notification routes (Step 11).
 *
 * GET  /api/notifications          — recent notifications (default cap 50)
 * GET  /api/notifications/unread   — unread only (dashboard polls this)
 * POST /api/notifications/:id/read — mark one notification as read
 *
 * Marking read is a direct write (not approval-gated) because it is benign
 * UI state — it changes no task, event, calendar item, or memory.
 */
export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/notifications", async () => {
    return notificationListResponseSchema.parse({
      notifications: listNotifications(),
    });
  });

  app.get("/api/notifications/unread", async () => {
    return notificationListResponseSchema.parse({
      notifications: listUnreadNotifications(),
    });
  });

  app.post("/api/notifications/:id/read", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Invalid notification id" });
    }
    const existing = getNotificationById(params.data.id);
    if (!existing) {
      return reply.code(404).send({ error: "Notification not found" });
    }
    markNotificationRead(params.data.id);
    return notificationSchema.parse(getNotificationById(params.data.id));
  });
}
