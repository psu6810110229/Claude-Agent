import { getDb } from "../connection.js";
import { nowIso } from "../../config.js";
import type { Activity } from "../../schemas/activity.js";

/** Append one activity_log row (append-only; no updated_at). */
export function logActivity(eventType: string, detail?: string): void {
  getDb()
    .prepare(
      "INSERT INTO activity_log (event_type, detail, created_at) VALUES (?, ?, ?)",
    )
    .run(eventType, detail ?? null, nowIso());
}

/** Most recent activity rows, newest first. */
export function listRecentActivity(limit: number): Activity[] {
  return getDb()
    .prepare(
      "SELECT id, event_type, detail, created_at FROM activity_log ORDER BY id DESC LIMIT ?",
    )
    .all(limit) as Activity[];
}
