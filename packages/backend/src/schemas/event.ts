import { z } from "zod";

/**
 * Local calendar events (Step 9). Datetimes are ISO 8601 UTC strings; the schema
 * REQUIRES UTC (`Z`) and rejects offsets, so an approved event always stores an
 * unambiguous instant (per project convention — AI interprets natural-language
 * times in Asia/Bangkok but must emit UTC). Events are soft-archived, never
 * hard-deleted.
 */

/** ISO 8601 UTC datetime (must end in `Z`; offsets are rejected). */
export const isoUtcDateTime = z
  .string()
  .datetime({ message: "Must be an ISO 8601 UTC datetime ending in Z" });

export const eventStatusSchema = z.enum(["scheduled", "archived"]);
export type EventStatus = z.infer<typeof eventStatusSchema>;

/** A persisted event row as returned by the API. */
export const eventSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  location: z.string().nullable(),
  notes: z.string().nullable(),
  status: eventStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export type Event = z.infer<typeof eventSchema>;

export const eventListResponseSchema = z.object({
  events: z.array(eventSchema),
});

/**
 * `event.create` approval payload. `ends_at` (if given) must not precede
 * `starts_at`. Re-validated at propose time and again in the executor.
 */
export const createEventPayloadSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    starts_at: isoUtcDateTime,
    ends_at: isoUtcDateTime.optional(),
    location: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.ends_at === undefined || v.ends_at >= v.starts_at, {
    message: "ends_at must not be before starts_at",
    path: ["ends_at"],
  });

/** `event.update` approval payload. At least one mutable field required. */
export const updateEventPayloadSchema = z
  .object({
    id: z.number().int().positive(),
    title: z.string().trim().min(1).max(500).optional(),
    starts_at: isoUtcDateTime.optional(),
    ends_at: isoUtcDateTime.optional(),
    location: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.starts_at !== undefined ||
      v.ends_at !== undefined ||
      v.location !== undefined ||
      v.notes !== undefined,
    { message: "At least one field to update must be provided" },
  );

/** `event.archive` approval payload. */
export const archiveEventPayloadSchema = z.object({
  id: z.number().int().positive(),
});
