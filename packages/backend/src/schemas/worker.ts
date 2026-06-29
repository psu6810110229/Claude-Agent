import { z } from "zod";

/**
 * Read-only worker contract for Phase 4.
 *
 * Workers may gather evidence, but they never execute or request actions.
 * Output is intentionally a strict evidence bundle: unknown top-level keys
 * such as `actions` are rejected instead of being silently stripped.
 */

export const READ_ONLY_WORKER_TASK_MAX_CHARS = 800;
export const READ_ONLY_WORKER_QUERY_MAX_CHARS = 400;
export const READ_ONLY_WORKER_SOURCE_REF_MAX_CHARS = 500;
export const READ_ONLY_WORKER_LIMITATION_MAX_CHARS = 200;
export const READ_ONLY_WORKER_LIMITATIONS_MAX = 12;
export const READ_ONLY_WORKER_MAX_RESULTS = 50;

export const readOnlyWorkerSourceSchema = z.enum([
  "google_calendar",
  "gmail",
  "google_drive",
  "line_export",
  "web",
  "local_file",
]);
export type ReadOnlyWorkerSource = z.infer<typeof readOnlyWorkerSourceSchema>;

export const readOnlyWorkerConfidenceSchema = z.enum([
  "high",
  "medium",
  "low",
]);
export type ReadOnlyWorkerConfidence = z.infer<
  typeof readOnlyWorkerConfidenceSchema
>;

const workerIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9._:-]+$/);

const sourceRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(READ_ONLY_WORKER_SOURCE_REF_MAX_CHARS);

const isoDateTimeSchema = z.string().datetime({ offset: true });

const limitationSchema = z
  .string()
  .trim()
  .min(1)
  .max(READ_ONLY_WORKER_LIMITATION_MAX_CHARS);

export const readOnlyWorkerInputSchema = z
  .object({
    job_id: z.number().int().positive(),
    worker_id: workerIdSchema,
    source: readOnlyWorkerSourceSchema,
    source_ref: sourceRefSchema.optional(),
    task: z.string().trim().min(1).max(READ_ONLY_WORKER_TASK_MAX_CHARS),
    query: z.string().trim().min(1).max(READ_ONLY_WORKER_QUERY_MAX_CHARS).optional(),
    limit: z.number().int().positive().max(READ_ONLY_WORKER_MAX_RESULTS).optional(),
    since: isoDateTimeSchema.nullable().optional(),
    until: isoDateTimeSchema.nullable().optional(),
    read_only: z.literal(true).default(true),
  })
  .strict();
export type ReadOnlyWorkerInput = z.infer<typeof readOnlyWorkerInputSchema>;

export const readOnlyWorkerEvidenceBundleSchema = z
  .object({
    job_id: z.number().int().positive(),
    worker_id: workerIdSchema,
    source: readOnlyWorkerSourceSchema,
    source_ref: sourceRefSchema,
    fetched_at: isoDateTimeSchema,
    newest_at: isoDateTimeSchema.nullable(),
    stale: z.boolean(),
    capped: z.boolean(),
    partial: z.boolean(),
    confidence: readOnlyWorkerConfidenceSchema,
    limitations: z.array(limitationSchema).max(READ_ONLY_WORKER_LIMITATIONS_MAX),
  })
  .strict()
  .superRefine((bundle, ctx) => {
    if (!bundle.newest_at) return;
    if (Date.parse(bundle.newest_at) > Date.parse(bundle.fetched_at)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["newest_at"],
        message: "newest_at cannot be later than fetched_at",
      });
    }
  });
export type ReadOnlyWorkerEvidenceBundle = z.infer<
  typeof readOnlyWorkerEvidenceBundleSchema
>;

export function parseReadOnlyWorkerOutput(
  output: unknown,
): ReadOnlyWorkerEvidenceBundle {
  return readOnlyWorkerEvidenceBundleSchema.parse(output);
}

export function safeParseReadOnlyWorkerOutput(output: unknown) {
  return readOnlyWorkerEvidenceBundleSchema.safeParse(output);
}
