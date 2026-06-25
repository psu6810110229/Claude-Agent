import { z } from "zod";
import { hhmm, ymd, weekdaySchema } from "./classBlock.js";
import { SCHEDULE_IMPORT_MAX_ITEMS } from "../config.js";

/**
 * Schedule Import — staging schemas (the review buffer for a parsed timetable).
 *
 * Two layers:
 *  - The RAW extractor contract (permissive strings) the model returns. Anything
 *    the model is unsure about is left null; nothing is silently guessed onto the
 *    calendar.
 *  - The persisted staging row shapes + the review/approve request bodies.
 */

/** One class as the extractor emits it (loose; normalized before persisting). */
export const extractedClassSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  /** Weekday token: English/Thai name or abbrev, or null when unreadable. */
  day: z.string().trim().max(20).nullish(),
  /** "HH:MM" 24h start, or null when unreadable. */
  start: z.string().trim().max(10).nullish(),
  end: z.string().trim().max(10).nullish(),
  location: z.string().trim().max(200).nullish(),
});

/** The full strict envelope the extractor model must return. */
export const scheduleExtractionSchema = z
  .object({
    classes: z.array(extractedClassSchema).max(SCHEDULE_IMPORT_MAX_ITEMS).default([]),
    term_from: ymd.nullish().transform((v) => v ?? null),
    term_until: ymd.nullish().transform((v) => v ?? null),
    note: z.string().trim().max(500).nullish().transform((v) => v ?? null),
  })
  .strict();
export type ScheduleExtraction = z.infer<typeof scheduleExtractionSchema>;

/** A persisted import session row. */
export const scheduleImportSchema = z.object({
  id: z.number().int(),
  status: z.string(),
  source_kind: z.string(),
  term_from: z.string().nullable(),
  term_until: z.string().nullable(),
  note: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ScheduleImport = z.infer<typeof scheduleImportSchema>;

/** A persisted candidate item row (nullable fields = user must fill). */
export const scheduleImportItemSchema = z.object({
  id: z.number().int(),
  import_id: z.number().int(),
  subject: z.string(),
  weekday: z.number().int().nullable(),
  start_local: z.string().nullable(),
  end_local: z.string().nullable(),
  location: z.string().nullable(),
  selected: z.number().int(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ScheduleImportItem = z.infer<typeof scheduleImportItemSchema>;

/** POST /api/schedule-imports — create a session from a prior upload. */
export const createScheduleImportSchema = z.object({
  uploadId: z
    .string()
    .trim()
    .regex(/^[0-9a-f-]{36}$/i, "uploadId ไม่ถูกต้อง"),
});

/** PATCH one item in the review card. Every field optional (patch). */
export const patchScheduleImportItemSchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    weekday: weekdaySchema.nullable(),
    start_local: hhmm.nullable(),
    end_local: hhmm.nullable(),
    location: z.string().trim().max(200).nullable(),
    selected: z.boolean(),
  })
  .partial();
export type PatchScheduleImportItem = z.infer<typeof patchScheduleImportItemSchema>;

/** POST /api/schedule-imports/:id/approve — term bounds applied to all blocks. */
export const approveScheduleImportSchema = z
  .object({
    term_from: ymd.nullish().transform((v) => v ?? null),
    term_until: ymd.nullish().transform((v) => v ?? null),
  })
  .refine(
    (v) => !v.term_from || !v.term_until || v.term_until >= v.term_from,
    { message: "term_until must not precede term_from", path: ["term_until"] },
  );
export type ApproveScheduleImport = z.infer<typeof approveScheduleImportSchema>;
