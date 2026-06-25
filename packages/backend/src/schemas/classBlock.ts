import { z } from "zod";

/**
 * Schedule Import — local weekly class block (NOT a Google Calendar event).
 *
 * A class_block is one weekday occurrence of a recurring class (a Mon+Wed class
 * is two rows). It is emitted as a `recurring_block` ScheduleConstraint into the
 * existing availability/verifier engine, so classes are cross-referenced against
 * the calendar and free-time search WITHOUT ever being written to Google.
 *
 * Times are Asia/Bangkok wall-clock "HH:MM"; weekday is the Bangkok weekday
 * (0=Sun..6=Sat); active_from/active_until are Bangkok "YYYY-MM-DD" term bounds.
 */

/** Bangkok local "HH:MM" (00:00–23:59). */
export const hhmm = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "ต้องเป็นเวลา HH:MM");

/** Bangkok "YYYY-MM-DD". */
export const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "ต้องเป็นวันที่ YYYY-MM-DD");

export const weekdaySchema = z.number().int().min(0).max(6);

export const classBlockSchema = z.object({
  id: z.number().int(),
  subject: z.string(),
  weekday: weekdaySchema,
  start_local: z.string(),
  end_local: z.string(),
  location: z.string().nullable(),
  active_from: z.string().nullable(),
  active_until: z.string().nullable(),
  status: z.string(),
  source: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ClassBlock = z.infer<typeof classBlockSchema>;

/**
 * Create input. `end_local` must be after `start_local` (same-day classes only;
 * a timetable class never crosses midnight). Term bounds optional; when both set,
 * `active_until` must not precede `active_from`.
 */
export const createClassBlockSchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    weekday: weekdaySchema,
    start_local: hhmm,
    end_local: hhmm,
    location: z.string().trim().max(200).nullish().transform((v) => v ?? null),
    active_from: ymd.nullish().transform((v) => v ?? null),
    active_until: ymd.nullish().transform((v) => v ?? null),
    source: z.enum(["import", "manual"]).default("manual"),
  })
  .refine((v) => v.end_local > v.start_local, {
    message: "end_local must be after start_local",
    path: ["end_local"],
  })
  .refine(
    (v) => !v.active_from || !v.active_until || v.active_until >= v.active_from,
    { message: "active_until must not precede active_from", path: ["active_until"] },
  );
export type CreateClassBlockInput = z.infer<typeof createClassBlockSchema>;

/** Query for GET /api/free-slots. Missing date = today. */
export const freeSlotsQuerySchema = z.object({
  date: ymd.optional(),
  minMinutes: z.coerce.number().int().min(5).max(720).optional(),
});
export type FreeSlotsQuery = z.infer<typeof freeSlotsQuerySchema>;

/** Patch input: any subset of mutable fields. Cross-field checks run in the repo. */
export const updateClassBlockSchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    weekday: weekdaySchema,
    start_local: hhmm,
    end_local: hhmm,
    location: z.string().trim().max(200).nullable(),
    active_from: ymd.nullable(),
    active_until: ymd.nullable(),
  })
  .partial();
export type UpdateClassBlockInput = z.infer<typeof updateClassBlockSchema>;
