import type { FastifyInstance } from "fastify";
import {
  getSchedulePrefs,
  setSchedulePrefs,
  schedulePrefsInputSchema,
} from "../services/schedulePrefs.js";

/**
 * Schedule-preference routes (Tier 1 "C"). Read + update the deterministic
 * thresholds that tune the schedule-health analyzer. Separate from the boolean
 * toggles in settingsRoutes because these are numeric/array values. No AI, no
 * calendar writes — pure config.
 */
export async function schedulePrefsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings/schedule", async () => getSchedulePrefs());

  app.put("/api/settings/schedule", async (req, reply) => {
    const parsed = schedulePrefsInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    }
    setSchedulePrefs(parsed.data);
    // Echo the full effective prefs so the client reflects clamping/merging.
    return reply.code(200).send(getSchedulePrefs());
  });
}
