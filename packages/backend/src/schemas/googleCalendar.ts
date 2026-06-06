import { z } from "zod";

/**
 * Google Calendar event (Step 10) — READ-ONLY projection.
 *
 * This is a normalized, display-oriented shape derived from the Google Calendar
 * API. It is deliberately distinct from the local `event` row (schemas/event.ts):
 * Google events are never persisted, never written back, and have no status /
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
  htmlLink: z.string().nullable(),
  source: z.literal("google"),
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
