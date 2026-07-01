import { z } from "zod";
import { isoUtcDateTime } from "./event.js";

/**
 * Google Calendar event (Step 10) - read projection.
 *
 * This is a normalized, display-oriented shape derived from the Google Calendar
 * API. It is deliberately distinct from the local `event` row (schemas/event.ts):
 * Google events are never persisted in the local DB and have no status /
 * created_at / updated_at of our own. `source` is a literal so the dashboard can
 * label Google entries as the PRIMARY schedule.
 *
 * `start`/`end` are RFC 3339 strings exactly as Google returns them: an instant
 * (`dateTime`, e.g. `2026-06-06T15:00:00+07:00`) for timed events, or a date
 * (`YYYY-MM-DD`) for all-day events. `allDay` disambiguates the two for display.
 */
export const googleEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string().nullable(),
  allDay: z.boolean(),
  location: z.string().nullable(),
  description: z.string().nullable(),
  htmlLink: z.string().nullable(),
  source: z.literal("google"),
  /** Source calendar metadata for multi-calendar reads. Null/omitted for old stubs. */
  calendarId: z.string().nullable().optional(),
  calendarName: z.string().nullable().optional(),
  calendarPrimary: z.boolean().optional(),
  /** True only when this event belongs to the configured write calendar. */
  writable: z.boolean().optional(),
});
export type GoogleEvent = z.infer<typeof googleEventSchema>;

/**
 * Read route response. `available` is false when the connector is disabled or
 * any fetch/auth/config error occurs (fail closed) — the dashboard/brief then
 * simply show no Google schedule rather than breaking.
 */
export const googleEventListResponseSchema = z.object({
  events: z.array(googleEventSchema),
  available: z.boolean(),
});
export type GoogleEventListResponse = z.infer<
  typeof googleEventListResponseSchema
>;

/**
 * Schedule health read response (Tier 1 conflict/gap detection). Pure analysis
 * over the read events; `available` mirrors the calendar fetch (fail closed).
 */
export const scheduleFindingSchema = z.object({
  kind: z.enum([
    "overlap",
    "tight_travel",
    "no_buffer",
    "long_streak",
    "overloaded_day",
    "after_hours",
    "weekend",
    "protected_day",
  ]),
  severity: z.enum(["high", "medium", "low"]),
  startUtc: z.string(),
  endUtc: z.string(),
  eventIds: z.array(z.string()),
  titles: z.array(z.string()),
  detail: z.string(),
});
export const scheduleHealthResponseSchema = z.object({
  findings: z.array(scheduleFindingSchema),
  available: z.boolean(),
});
export type ScheduleHealthResponse = z.infer<
  typeof scheduleHealthResponseSchema
>;

/**
 * `google_event.create` approval payload. Google Calendar is the primary
 * schedule source; creating an event is allowed only through the approval
 * executor, never directly from AI or the command route.
 */
/**
 * One iCalendar recurrence line as Google expects in `event.recurrence`, e.g.
 * "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261031T000000Z". We accept RRULE/RDATE/
 * EXDATE lines and leave deeper RFC 5545 validation to Google (it rejects bad
 * rules with a clear message that we surface).
 */
const recurrenceLine = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .regex(/^(RRULE|RDATE|EXDATE):/i, {
    message: "recurrence lines must start with RRULE:, RDATE:, or EXDATE:",
  });

export const createGoogleEventPayloadSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    starts_at: isoUtcDateTime,
    ends_at: isoUtcDateTime,
    location: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(2000).optional(),
    /** Optional recurrence (e.g. a weekly class for the whole term). Omit for a
     * one-off event. The supplied start/end define the FIRST occurrence. */
    recurrence: z.array(recurrenceLine).min(1).max(8).optional(),
  })
  .refine((v) => v.ends_at > v.starts_at, {
    message: "ends_at must be after starts_at",
    path: ["ends_at"],
  });
export type CreateGoogleEventPayload = z.infer<
  typeof createGoogleEventPayloadSchema
>;

/**
 * `google_event.update` approval payload (Step 14). Targets an existing Google
 * event by its string `id` (as returned by the read routes). All mutable fields
 * are optional, but at least one must be present. When both `starts_at` and
 * `ends_at` are supplied, `ends_at` must be after `starts_at`. The executor
 * snapshots the prior event state (for undo) before patching.
 */
/**
 * Recurring-edit scope. "instance" (default) edits/deletes only the single
 * occurrence identified by `id`; "series" edits/deletes the whole recurring
 * series the occurrence belongs to. Ignored for non-recurring events.
 */
export const recurringScopeSchema = z.enum(["instance", "series"]);
export type RecurringScope = z.infer<typeof recurringScopeSchema>;

export const updateGoogleEventPayloadSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1).max(500).optional(),
    starts_at: isoUtcDateTime.optional(),
    ends_at: isoUtcDateTime.optional(),
    location: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(2000).optional(),
    scope: recurringScopeSchema.optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.starts_at !== undefined ||
      v.ends_at !== undefined ||
      v.location !== undefined ||
      v.notes !== undefined,
    { message: "At least one field to update must be provided" },
  )
  .refine(
    (v) =>
      v.starts_at === undefined ||
      v.ends_at === undefined ||
      v.ends_at > v.starts_at,
    { message: "ends_at must be after starts_at", path: ["ends_at"] },
  );
export type UpdateGoogleEventPayload = z.infer<
  typeof updateGoogleEventPayloadSchema
>;

/**
 * `google_event.delete` approval payload (Step 14). Deletes one Google event by
 * id. Irreversible on Google's side — the executor first snapshots the full
 * prior event (stored as the approval's undo_json) so it can be recreated.
 * Always confirm-gated; never auto-executed (see Step 14 auto-execute policy).
 */
export const deleteGoogleEventPayloadSchema = z.object({
  id: z.string().trim().min(1),
  scope: recurringScopeSchema.optional(),
});
export type DeleteGoogleEventPayload = z.infer<
  typeof deleteGoogleEventPayloadSchema
>;
