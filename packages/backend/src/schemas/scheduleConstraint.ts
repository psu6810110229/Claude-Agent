/**
 * Step 27 / Sprint 2 — structured schedule constraints (RC3, RC4).
 *
 * Tank "do-not-disturb" windows and weekly class blocks live as free-text facts
 * today, invisible to the scheduling engine and dropped from context whenever a
 * follow-up shares no keyword. A `ScheduleConstraint` lifts those rules into a
 * small structured shape so they can be (a) rendered deterministically and (b)
 * held sticky for the whole scheduling topic instead of recalled by keyword.
 *
 * Times are Asia/Bangkok local "HH:MM" (UTC+7, no DST) — the user's wall clock.
 * The conflict/availability resolver (Sprint 3) consumes these intervals.
 */

export type ScheduleConstraintKind =
  /** A window the user protects — never schedule INTO it (tank light/CO2/quiet). */
  | "protected_window"
  /** A recurring weekly commitment that occupies time (e.g. a class block). */
  | "recurring_block";

export interface ScheduleConstraint {
  kind: ScheduleConstraintKind;
  /** Short human label, e.g. "ตู้ปลา: ไฟ" or "เรียน". */
  label: string;
  /**
   * Bangkok weekdays this applies to (0 = Sunday … 6 = Saturday, matching JS
   * getUTCDay on the +7h-shifted instant). EMPTY = applies every day.
   */
  weekdays: number[];
  /** Bangkok local start "HH:MM" (inclusive). */
  startLocal: string;
  /** Bangkok local end "HH:MM" (exclusive). */
  endLocal: string;
  /** Provenance, e.g. "fact#44" or "class_block#12". */
  source: string;
  /** Original fact text — kept as evidence and conservative fallback. */
  raw: string;
  /**
   * Optional Bangkok "YYYY-MM-DD" term lower bound (inclusive). When set, the
   * constraint does NOT materialize on any day before it — so a past-term class
   * never blocks availability. NULL/undefined = no lower bound. Fact-derived
   * constraints leave these unset (always active); class_block term ranges set them.
   */
  activeFrom?: string | null;
  /** Optional Bangkok "YYYY-MM-DD" term upper bound (inclusive). */
  activeUntil?: string | null;
}
