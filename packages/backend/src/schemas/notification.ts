import { z } from "zod";

/**
 * Scheduler-fired notifications (Step 11). Notifications are written by the
 * background scheduler when a reminder becomes due or an event is starting
 * soon. Each (kind, source_id) pair fires at most once (DB UNIQUE dedup).
 * Status starts 'unread' and transitions to 'read' when acknowledged via the
 * dashboard. Never hard-deleted.
 */

export const notificationKindSchema = z.enum(["reminder.due", "event.soon"]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationStatusSchema = z.enum(["unread", "read"]);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

export const notificationSchema = z.object({
  id: z.number().int().positive(),
  kind: notificationKindSchema,
  source_id: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  fire_at: z.string(),
  status: notificationStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListResponseSchema = z.object({
  notifications: z.array(notificationSchema),
});
