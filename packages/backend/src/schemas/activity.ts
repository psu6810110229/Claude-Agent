import { z } from "zod";

/** A persisted activity_log row (append-only; no updated_at). */
export const activitySchema = z.object({
  id: z.number().int().positive(),
  event_type: z.string(),
  detail: z.string().nullable(),
  created_at: z.string(),
});
export type Activity = z.infer<typeof activitySchema>;

export const activityListResponseSchema = z.object({
  activity: z.array(activitySchema),
});

/** GET /api/activity query (?limit=, capped). */
export const activityQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;
