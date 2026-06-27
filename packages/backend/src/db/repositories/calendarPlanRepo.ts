import { getDb } from "../connection.js";
import { nowIso } from "../../config.js";
import type {
  CalendarPlan,
  CalendarPlanItem,
} from "../../schemas/calendarPlan.js";

/**
 * calendar_plan / calendar_plan_item repository — the staging buffer for a bulk
 * Google Calendar add awaiting review. Nothing here touches Google; on approve
 * the selected items are dispatched as individual google_event.create writes.
 * Soft status transitions only.
 */

const PLAN_COLS = "id, status, note, created_at, updated_at";
const ITEM_COLS =
  "id, plan_id, title, starts_at, ends_at, location, notes, selected, override_conflict, conflict_with, conflict_detail, category, conflict_starts_at, conflict_ends_at, status, created_at, updated_at";

export interface CreateCalendarPlanItemInput {
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  notes: string | null;
  conflict_with: string | null;
  conflict_detail: string | null;
  /** 'clean' | 'duplicate' | 'overlap' — triage bucket for the review card. */
  category: string;
  /** Existing clashing event's time (UTC ISO) for the "already on calendar" line. */
  conflict_starts_at: string | null;
  conflict_ends_at: string | null;
  /** 'ready' | 'conflict' — drives the default selection in the review card. */
  status: string;
}

export function getCalendarPlanById(id: number): CalendarPlan | undefined {
  return getDb()
    .prepare(`SELECT ${PLAN_COLS} FROM calendar_plan WHERE id = ?`)
    .get(id) as CalendarPlan | undefined;
}

export function listCalendarPlanItems(planId: number): CalendarPlanItem[] {
  return getDb()
    .prepare(
      `SELECT ${ITEM_COLS} FROM calendar_plan_item WHERE plan_id = ? ORDER BY id ASC`,
    )
    .all(planId) as CalendarPlanItem[];
}

export function getCalendarPlanItemById(
  id: number,
): CalendarPlanItem | undefined {
  return getDb()
    .prepare(`SELECT ${ITEM_COLS} FROM calendar_plan_item WHERE id = ?`)
    .get(id) as CalendarPlanItem | undefined;
}

/**
 * Create a plan and its items in one transaction so a partially written plan can
 * never be observed. A conflict item defaults to UNSELECTED (the user opts in to
 * "create anyway"); a ready item defaults to selected.
 */
export function createCalendarPlan(
  note: string | null,
  items: CreateCalendarPlanItemInput[],
): { plan: CalendarPlan; items: CalendarPlanItem[] } {
  const db = getDb();
  const ts = nowIso();
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO calendar_plan (status, note, created_at, updated_at)
         VALUES ('pending', ?, ?, ?)`,
      )
      .run(note, ts, ts);
    const planId = Number(info.lastInsertRowid);
    const itemStmt = db.prepare(
      `INSERT INTO calendar_plan_item
         (plan_id, title, starts_at, ends_at, location, notes, selected, override_conflict, conflict_with, conflict_detail, category, conflict_starts_at, conflict_ends_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const it of items) {
      // Defaults match the simplified review card: a DUPLICATE (already on the
      // calendar) is unselected so it is skipped; everything else — including an
      // item that merely OVERLAPS another subject — defaults selected, since a
      // fixed timetable is added regardless. A selected overlap carries
      // override_conflict=1 so the approve-time clash recheck still creates it.
      const isDuplicate = it.category === "duplicate";
      const selected = isDuplicate ? 0 : 1;
      const override = !isDuplicate && it.status === "conflict" ? 1 : 0;
      itemStmt.run(
        planId,
        it.title,
        it.starts_at,
        it.ends_at,
        it.location,
        it.notes,
        selected,
        override,
        it.conflict_with,
        it.conflict_detail,
        it.category,
        it.conflict_starts_at,
        it.conflict_ends_at,
        it.status,
        ts,
        ts,
      );
    }
    return planId;
  });
  const planId = tx();
  return {
    plan: getCalendarPlanById(planId)!,
    items: listCalendarPlanItems(planId),
  };
}

export interface UpdateCalendarPlanItemFields {
  title?: string;
  starts_at?: string;
  ends_at?: string;
  location?: string | null;
  notes?: string | null;
  selected?: boolean;
  override_conflict?: boolean;
}

export function updateCalendarPlanItem(
  id: number,
  fields: UpdateCalendarPlanItemFields,
): CalendarPlanItem | undefined {
  const existing = getCalendarPlanItemById(id);
  if (!existing) return undefined;
  const next = {
    title: fields.title ?? existing.title,
    starts_at: fields.starts_at ?? existing.starts_at,
    ends_at: fields.ends_at ?? existing.ends_at,
    location:
      fields.location !== undefined ? fields.location : existing.location,
    notes: fields.notes !== undefined ? fields.notes : existing.notes,
    selected:
      fields.selected !== undefined
        ? fields.selected
          ? 1
          : 0
        : existing.selected,
    override_conflict:
      fields.override_conflict !== undefined
        ? fields.override_conflict
          ? 1
          : 0
        : existing.override_conflict,
    updated_at: nowIso(),
  };
  getDb()
    .prepare(
      `UPDATE calendar_plan_item SET title = ?, starts_at = ?, ends_at = ?,
         location = ?, notes = ?, selected = ?, override_conflict = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      next.title,
      next.starts_at,
      next.ends_at,
      next.location,
      next.notes,
      next.selected,
      next.override_conflict,
      next.updated_at,
      id,
    );
  return getCalendarPlanItemById(id);
}

/** Refresh the build-time conflict snapshot + status for one item. */
export function setCalendarPlanItemConflict(
  id: number,
  conflict: { with: string | null; detail: string | null } | null,
): void {
  getDb()
    .prepare(
      `UPDATE calendar_plan_item SET conflict_with = ?, conflict_detail = ?,
         status = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      conflict?.with ?? null,
      conflict?.detail ?? null,
      conflict ? "conflict" : "ready",
      nowIso(),
      id,
    );
}

/** Mark a single item's terminal status (created | rejected | skipped). */
export function setCalendarPlanItemStatus(id: number, status: string): void {
  getDb()
    .prepare(
      "UPDATE calendar_plan_item SET status = ?, updated_at = ? WHERE id = ?",
    )
    .run(status, nowIso(), id);
}

/** Mark the plan's terminal status (approved | discarded). */
export function setCalendarPlanStatus(id: number, status: string): void {
  getDb()
    .prepare("UPDATE calendar_plan SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, nowIso(), id);
}
