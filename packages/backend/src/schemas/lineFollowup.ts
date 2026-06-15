import { z } from "zod";
import { isoUtcDateTime } from "./event.js";

/**
 * LINE follow-up watch schemas (Step 21) — READ-ONLY, approval-gated.
 *
 * A follow-up watch is a scheduled check over the already-ingested LINE export
 * files. Creating one is the only LINE-domain action that touches the approval
 * queue, and it writes ONLY a local DB row — it never sends, replies, updates,
 * or otherwise mutates LINE, and never triggers live LINE desktop automation.
 * At `due_at` the scheduler searches exported messages newer than `baseline_at`
 * for `keywords` (optionally limited to `chat_filter`) and fires one notification.
 */

export const lineFollowupStatusSchema = z.enum([
  "pending",
  "fired",
  "cancelled",
]);
export type LineFollowupStatus = z.infer<typeof lineFollowupStatusSchema>;

/** A persisted follow-up watch row as returned by the API. */
export const lineFollowupSchema = z.object({
  id: z.number().int().positive(),
  /** Short human label for the thing being followed up on. */
  topic: z.string(),
  /** Search terms (substring, case-insensitive) over exported message text. */
  keywords: z.array(z.string()),
  /** Optional chat-name filter (case-insensitive substring); null = all chats. */
  chat_filter: z.string().nullable(),
  /** When the scheduled check should run (ISO 8601 UTC, `Z`). */
  due_at: z.string(),
  /** Only messages newer than this instant count as a "new" match. */
  baseline_at: z.string(),
  status: lineFollowupStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export type LineFollowup = z.infer<typeof lineFollowupSchema>;

export const lineFollowupListResponseSchema = z.object({
  followups: z.array(lineFollowupSchema),
});

/**
 * `line_followup.create` approval payload. `baseline_at` is intentionally NOT
 * accepted here — it is fixed to the creation instant by the executor so a watch
 * only ever surfaces messages that arrive AFTER the user asked for the check.
 */
export const createLineFollowupPayloadSchema = z.object({
  topic: z.string().trim().min(1).max(200),
  keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  chat_filter: z.string().trim().min(1).max(200).optional(),
  due_at: isoUtcDateTime,
});
export type CreateLineFollowupPayload = z.infer<
  typeof createLineFollowupPayloadSchema
>;
