import { z } from "zod";

/**
 * Active topic schemas (Step 22) — durable topic watch store.
 *
 * An active topic represents something the user is actively tracking. It drives
 * the Step 22 evidence builder and topic resolver. Creating a topic is the only
 * action here (approval-gated, local-only). The topic itself only ever READS
 * exported LINE files — it never sends, replies, or mutates LINE.
 */

export const activeTopicSourceSchema = z.enum([
  "line",
  "calendar",
  "mixed",
  "general",
]);
export type ActiveTopicSource = z.infer<typeof activeTopicSourceSchema>;

export const activeTopicStatusSchema = z.enum(["active", "paused", "resolved"]);
export type ActiveTopicStatus = z.infer<typeof activeTopicStatusSchema>;

export const activeTopicCreatedFromSchema = z.enum([
  "chat",
  "manual",
  "scheduler",
]);
export type ActiveTopicCreatedFrom = z.infer<typeof activeTopicCreatedFromSchema>;

export const activeTopicSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  source: activeTopicSourceSchema,
  keywords: z.array(z.string()),
  chat_filter: z.string().nullable(),
  status: activeTopicStatusSchema,
  priority: z.number().int().min(0).max(100),
  baseline_at: z.string(),
  last_checked_at: z.string().nullable(),
  last_evidence_at: z.string().nullable(),
  last_summary: z.string().nullable(),
  cooldown_minutes: z.number().int().min(1).max(1440),
  created_from: activeTopicCreatedFromSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export type ActiveTopic = z.infer<typeof activeTopicSchema>;

/**
 * `active_topic.create` approval payload. `baseline_at`, `created_from`,
 * `status`, and timestamps are NOT accepted — the executor sets them so the
 * model cannot forge a baseline or bypass the local-only constraint.
 */
export const createActiveTopicPayloadSchema = z.object({
  title: z.string().trim().min(1).max(200),
  source: activeTopicSourceSchema,
  keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  chat_filter: z.string().trim().min(1).max(200).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  cooldown_minutes: z.number().int().min(1).max(1440).optional(),
});
export type CreateActiveTopicPayload = z.infer<
  typeof createActiveTopicPayloadSchema
>;

/** Internal repo input carrying the backend-set fields. */
export interface CreateActiveTopicInput {
  title: string;
  source: ActiveTopicSource;
  keywords: string[];
  chat_filter?: string | null;
  priority?: number;
  cooldown_minutes?: number;
  baseline_at: string;
  created_from: ActiveTopicCreatedFrom;
}
