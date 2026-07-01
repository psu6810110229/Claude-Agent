import { z } from "zod";

/**
 * Active Job Foundation.
 *
 * Jobs are durable backend workflow records for long-running/read-only work.
 * They expose short progress milestones to chat/UI surfaces while keeping raw
 * source bodies, secrets, tokens, and credentials out of event storage.
 */

export const ACTIVE_JOB_PROGRESS_MAX_CHARS = 180;
export const ACTIVE_JOB_METADATA_STRING_MAX_CHARS = 160;
export const ACTIVE_JOB_METADATA_JSON_MAX_CHARS = 4000;

export const activeJobStatusSchema = z.enum([
  "queued",
  "understanding",
  "searching",
  "verifying",
  "needs_user",
  "reporting",
  "done",
  "failed",
  "cancelled",
]);
export type ActiveJobStatus = z.infer<typeof activeJobStatusSchema>;

export const activeJobEventTypeSchema = z.enum([
  "created",
  "progress",
  "evidence",
  "status",
  "clarification",
  "result",
  "error",
]);
export type ActiveJobEventType = z.infer<typeof activeJobEventTypeSchema>;

export const activeJobSchema = z.object({
  id: z.number().int().positive(),
  kind: z.string(),
  title: z.string(),
  status: activeJobStatusSchema,
  source: z.string().nullable(),
  source_ref: z.string().nullable(),
  result_summary: z.string().nullable(),
  error: z.string().nullable(),
  clarification: z.string().nullable(),
  evidence_json: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ActiveJob = z.infer<typeof activeJobSchema>;

export const activeJobEventSchema = z.object({
  id: z.number().int().positive(),
  job_id: z.number().int().positive(),
  event_type: activeJobEventTypeSchema,
  status: activeJobStatusSchema,
  progress: z.string(),
  metadata_json: z.string().nullable(),
  created_at: z.string(),
});
export type ActiveJobEvent = z.infer<typeof activeJobEventSchema>;

export interface CreateActiveJobInput {
  kind: string;
  title: string;
  source?: string | null;
  source_ref?: string | null;
}

export interface ActiveJobEvidenceMetadata {
  source: string;
  source_ref?: string | null;
  fetched_at: string;
  newest_at?: string | null;
  stale?: boolean;
  capped?: boolean;
  partial?: boolean;
  confidence?: string;
  limitations?: string[];
  count?: number;
}

export const activeJobProgressEventSchema = z.object({
  id: z.number().int().positive(),
  event_type: activeJobEventTypeSchema,
  status: activeJobStatusSchema,
  message: z.string(),
  created_at: z.string(),
  metadata: z.unknown().nullable(),
});
export type ActiveJobProgressEvent = z.infer<
  typeof activeJobProgressEventSchema
>;

export const activeJobProgressSchema = z.object({
  job_id: z.number().int().positive(),
  kind: z.string(),
  title: z.string(),
  status: activeJobStatusSchema,
  source: z.string().nullable(),
  source_ref: z.string().nullable(),
  result_summary: z.string().nullable(),
  error: z.string().nullable(),
  clarification: z.string().nullable(),
  evidence: z.unknown().nullable(),
  updated_at: z.string(),
  milestones: z.array(activeJobProgressEventSchema),
});
export type ActiveJobProgress = z.infer<typeof activeJobProgressSchema>;
