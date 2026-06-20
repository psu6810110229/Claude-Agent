import { z } from "zod";
import {
  getConfigString,
  setConfigString,
} from "../db/repositories/configRepo.js";
import {
  DEFAULT_SCHEDULE_HEALTH_OPTIONS,
  type ScheduleHealthOptions,
} from "./scheduleHealth.js";

/**
 * Schedule preferences (Tier 1 "C"). Per-user thresholds that tune the
 * deterministic schedule-health analyzer. Stored as plain strings in the
 * `config` table (no schema/migration). Reads FAIL SAFE: a missing or
 * out-of-range value falls back to the built-in default, so a corrupt config
 * never breaks analysis. No AI, no writes to the calendar.
 */

/** Config keys (string-valued). */
const KEYS = {
  workStartHour: "schedule_work_start_hour",
  workEndHour: "schedule_work_end_hour",
  minBufferMin: "schedule_min_buffer_min",
  travelBufferMin: "schedule_travel_buffer_min",
  streakHours: "schedule_streak_hours",
  overloadDayMin: "schedule_overload_day_min",
  protectedDays: "schedule_protected_days",
} as const;

/**
 * Validated PUT body. Every field optional (patch-like); ranges keep values
 * sane. `protectedDays` is a set of Bangkok weekday numbers (0=Sun..6=Sat).
 */
export const schedulePrefsInputSchema = z
  .object({
    workStartHour: z.number().int().min(0).max(23),
    workEndHour: z.number().int().min(1).max(24),
    minBufferMin: z.number().int().min(0).max(180),
    travelBufferMin: z.number().int().min(0).max(240),
    streakHours: z.number().int().min(1).max(12),
    overloadDayMin: z.number().int().min(60).max(1440),
    protectedDays: z.array(z.number().int().min(0).max(6)),
  })
  .partial()
  .refine(
    (v) =>
      v.workStartHour === undefined ||
      v.workEndHour === undefined ||
      v.workEndHour > v.workStartHour,
    { message: "workEndHour must be after workStartHour", path: ["workEndHour"] },
  );
export type SchedulePrefsInput = z.infer<typeof schedulePrefsInputSchema>;

/** Parse a stored integer, falling back to `def` when absent/invalid/out-of-range. */
function readInt(key: string, def: number, min: number, max: number): number {
  const raw = getConfigString(key);
  if (raw === null) return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) return def;
  return n;
}

/** Parse the protected-days CSV ("0,3,6") into a sorted unique weekday list. */
function readProtectedDays(): number[] {
  const raw = getConfigString(KEYS.protectedDays);
  if (!raw) return [];
  const days = new Set<number>();
  for (const part of raw.split(",")) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isInteger(n) && n >= 0 && n <= 6) days.add(n);
  }
  return [...days].sort((a, b) => a - b);
}

/**
 * Current effective options for `analyzeSchedule`, merging stored prefs over the
 * built-in defaults. Always returns a valid, fully-populated options object.
 */
export function getSchedulePrefs(): ScheduleHealthOptions {
  const d = DEFAULT_SCHEDULE_HEALTH_OPTIONS;
  const workStartHour = readInt(KEYS.workStartHour, d.workStartHour, 0, 23);
  let workEndHour = readInt(KEYS.workEndHour, d.workEndHour, 1, 24);
  // Guard the cross-field invariant even if the keys were written separately.
  if (workEndHour <= workStartHour) workEndHour = d.workEndHour;
  return {
    workStartHour,
    workEndHour,
    minBufferMin: readInt(KEYS.minBufferMin, d.minBufferMin, 0, 180),
    travelBufferMin: readInt(KEYS.travelBufferMin, d.travelBufferMin, 0, 240),
    streakHours: readInt(KEYS.streakHours, d.streakHours, 1, 12),
    overloadDayMin: readInt(KEYS.overloadDayMin, d.overloadDayMin, 60, 1440),
    protectedDays: readProtectedDays(),
  };
}

/** Persist a subset of prefs. Only provided fields are written. */
export function setSchedulePrefs(input: SchedulePrefsInput): void {
  if (input.workStartHour !== undefined)
    setConfigString(KEYS.workStartHour, String(input.workStartHour));
  if (input.workEndHour !== undefined)
    setConfigString(KEYS.workEndHour, String(input.workEndHour));
  if (input.minBufferMin !== undefined)
    setConfigString(KEYS.minBufferMin, String(input.minBufferMin));
  if (input.travelBufferMin !== undefined)
    setConfigString(KEYS.travelBufferMin, String(input.travelBufferMin));
  if (input.streakHours !== undefined)
    setConfigString(KEYS.streakHours, String(input.streakHours));
  if (input.overloadDayMin !== undefined)
    setConfigString(KEYS.overloadDayMin, String(input.overloadDayMin));
  if (input.protectedDays !== undefined) {
    const csv = [...new Set(input.protectedDays)]
      .sort((a, b) => a - b)
      .join(",");
    setConfigString(KEYS.protectedDays, csv);
  }
}
