import { z } from "zod";
import { isoUtcDateTime } from "./event.js";
import { createGoogleEventPayloadSchema } from "./googleCalendar.js";
import { CALENDAR_PLAN_MAX_ITEMS } from "../config.js";

/**
 * Calendar bulk-create plan — staging buffer for adding MANY Google Calendar
 * events in one chat turn.
 *
 * Why this exists: a single chat turn caps the AI at a handful of actions, so an
 * "add all the missing classes" request used to silently lose every item past
 * the cap (the model just narrated "rest next batch" and dropped them). Instead
 * the AI emits ONE `calendar.bulk_create` action carrying the FULL list; the
 * backend stages it as a reviewable plan with a per-item conflict scan. Nothing
 * is written to Google until the user approves the selected items — and a time
 * clash is surfaced per item (never silently held/dropped) so the user can
 * choose "create anyway" or skip it.
 */

/** One proposed event inside a bulk-create action (same shape as a single create). */
export const calendarBulkCreateItemSchema = createGoogleEventPayloadSchema;
export type CalendarBulkCreateItem = z.infer<typeof calendarBulkCreateItemSchema>;

/** Payload of the `calendar.bulk_create` AI action. */
export const calendarBulkCreatePayloadSchema = z.object({
  items: z
    .array(calendarBulkCreateItemSchema)
    .min(1)
    .max(CALENDAR_PLAN_MAX_ITEMS),
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => v ?? null),
});
export type CalendarBulkCreatePayload = z.infer<
  typeof calendarBulkCreatePayloadSchema
>;

/**
 * The full `calendar.bulk_create` action. This is a CHAT-ONLY staging action —
 * deliberately NOT in `actionTypeSchema`/`actionPayloadSchemas` so the executor
 * never runs it directly. chat.ts peels it off and builds a plan; the plan's
 * approve route is what eventually dispatches real `google_event.create` writes.
 */
export const calendarBulkCreateActionSchema = z.object({
  action_type: z.literal("calendar.bulk_create"),
  payload: calendarBulkCreatePayloadSchema,
});
export type CalendarBulkCreateAction = z.infer<
  typeof calendarBulkCreateActionSchema
>;

/** A persisted plan session row. status: 'pending' | 'approved' | 'discarded'. */
export const calendarPlanSchema = z.object({
  id: z.number().int(),
  status: z.string(),
  note: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CalendarPlan = z.infer<typeof calendarPlanSchema>;

/**
 * A persisted plan item row. `selected`=1: user intends to create it.
 * `override_conflict`=1: create anyway despite a clash. conflict_* snapshot the
 * build-time clash for display. status: 'ready'|'conflict' -> terminal.
 */
export const calendarPlanItemSchema = z.object({
  id: z.number().int(),
  plan_id: z.number().int(),
  title: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  location: z.string().nullable(),
  notes: z.string().nullable(),
  selected: z.number().int(),
  override_conflict: z.number().int(),
  conflict_with: z.string().nullable(),
  conflict_detail: z.string().nullable(),
  /** Triage bucket: 'clean' | 'duplicate' | 'overlap'. */
  category: z.string(),
  /** Existing clashing event's start/end (UTC ISO), for the "already on calendar" line. */
  conflict_starts_at: z.string().nullable(),
  conflict_ends_at: z.string().nullable(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CalendarPlanItem = z.infer<typeof calendarPlanItemSchema>;

/** PATCH one plan item in the review card. Every field optional (patch). */
export const patchCalendarPlanItemSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    starts_at: isoUtcDateTime,
    ends_at: isoUtcDateTime,
    location: z.string().trim().max(500).nullable(),
    notes: z.string().trim().max(2000).nullable(),
    selected: z.boolean(),
    override_conflict: z.boolean(),
  })
  .partial()
  .refine(
    (v) =>
      v.starts_at === undefined ||
      v.ends_at === undefined ||
      v.ends_at > v.starts_at,
    { message: "ends_at must be after starts_at", path: ["ends_at"] },
  );
export type PatchCalendarPlanItem = z.infer<typeof patchCalendarPlanItemSchema>;

/**
 * POST /api/calendar-plans/:id/approve — body is optional. Selection and the
 * per-item "create anyway" override are read from the persisted item rows (set
 * via PATCH from the review card), so the body carries no item state today.
 */
export const approveCalendarPlanSchema = z.object({}).strip();
export type ApproveCalendarPlan = z.infer<typeof approveCalendarPlanSchema>;
