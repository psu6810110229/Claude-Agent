import { z } from "zod";
import { isoUtcDateTime } from "./event.js";

/**
 * Local reminders (Step 9). A reminder is a titled item with a single `due_at`
 * instant (ISO 8601 UTC, `Z` required). There is NO scheduler and NO automatic
 * notification in this step — "overdue" is computed read-only when the dashboard
 * or a brief asks for it. Reminders are soft-archived, never hard-deleted.
 */

export const reminderStatusSchema = z.enum(["active", "archived"]);
export type ReminderStatus = z.infer<typeof reminderStatusSchema>;

/** A persisted reminder row as returned by the API. */
export const reminderSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  due_at: z.string(),
  notes: z.string().nullable(),
  status: reminderStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export type Reminder = z.infer<typeof reminderSchema>;

export const reminderListResponseSchema = z.object({
  reminders: z.array(reminderSchema),
});

/** `reminder.create` approval payload. */
export const createReminderPayloadSchema = z.object({
  title: z.string().trim().min(1).max(500),
  due_at: isoUtcDateTime,
  notes: z.string().trim().max(2000).optional(),
});

/** `reminder.update` approval payload. At least one mutable field required. */
export const updateReminderPayloadSchema = z
  .object({
    id: z.number().int().positive(),
    title: z.string().trim().min(1).max(500).optional(),
    due_at: isoUtcDateTime.optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined || v.due_at !== undefined || v.notes !== undefined,
    { message: "At least one field to update must be provided" },
  );

/** `reminder.archive` approval payload. */
export const archiveReminderPayloadSchema = z.object({
  id: z.number().int().positive(),
});
