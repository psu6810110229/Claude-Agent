import { getDb } from "../connection.js";
import { nowIso } from "../../config.js";
import type {
  ScheduleImport,
  ScheduleImportItem,
} from "../../schemas/scheduleImport.js";

/**
 * schedule_import / schedule_import_item repository — the staging buffer for a
 * parsed timetable awaiting review. Nothing here affects availability; on approval
 * the selected items are copied into class_block (the real store). Soft status
 * transitions only.
 */

const IMPORT_COLS =
  "id, status, source_kind, term_from, term_until, note, created_at, updated_at";
const ITEM_COLS =
  "id, import_id, subject, weekday, start_local, end_local, location, selected, status, created_at, updated_at";

export interface CreateScheduleImportInput {
  source_kind: string;
  term_from?: string | null;
  term_until?: string | null;
  note?: string | null;
}

export interface CreateScheduleImportItemInput {
  subject: string;
  weekday: number | null;
  start_local: string | null;
  end_local: string | null;
  location: string | null;
}

export function getScheduleImportById(id: number): ScheduleImport | undefined {
  return getDb()
    .prepare(`SELECT ${IMPORT_COLS} FROM schedule_import WHERE id = ?`)
    .get(id) as ScheduleImport | undefined;
}

export function listScheduleImportItems(importId: number): ScheduleImportItem[] {
  return getDb()
    .prepare(
      `SELECT ${ITEM_COLS} FROM schedule_import_item WHERE import_id = ? ORDER BY id ASC`,
    )
    .all(importId) as ScheduleImportItem[];
}

export function getScheduleImportItemById(
  id: number,
): ScheduleImportItem | undefined {
  return getDb()
    .prepare(`SELECT ${ITEM_COLS} FROM schedule_import_item WHERE id = ?`)
    .get(id) as ScheduleImportItem | undefined;
}

/**
 * Create a session and its candidate items in one transaction, so a partially
 * written import can never be observed.
 */
export function createScheduleImport(
  input: CreateScheduleImportInput,
  items: CreateScheduleImportItemInput[],
): { import: ScheduleImport; items: ScheduleImportItem[] } {
  const db = getDb();
  const ts = nowIso();
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO schedule_import (status, source_kind, term_from, term_until, note, created_at, updated_at)
         VALUES ('pending', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.source_kind,
        input.term_from ?? null,
        input.term_until ?? null,
        input.note ?? null,
        ts,
        ts,
      );
    const importId = Number(info.lastInsertRowid);
    const itemStmt = db.prepare(
      `INSERT INTO schedule_import_item
         (import_id, subject, weekday, start_local, end_local, location, selected, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'candidate', ?, ?)`,
    );
    for (const it of items) {
      itemStmt.run(
        importId,
        it.subject,
        it.weekday,
        it.start_local,
        it.end_local,
        it.location,
        ts,
        ts,
      );
    }
    return importId;
  });
  const importId = tx();
  return {
    import: getScheduleImportById(importId)!,
    items: listScheduleImportItems(importId),
  };
}

export interface UpdateScheduleImportItemFields {
  subject?: string;
  weekday?: number | null;
  start_local?: string | null;
  end_local?: string | null;
  location?: string | null;
  selected?: boolean;
}

export function updateScheduleImportItem(
  id: number,
  fields: UpdateScheduleImportItemFields,
): ScheduleImportItem | undefined {
  const existing = getScheduleImportItemById(id);
  if (!existing) return undefined;
  const next = {
    subject: fields.subject ?? existing.subject,
    weekday: fields.weekday !== undefined ? fields.weekday : existing.weekday,
    start_local:
      fields.start_local !== undefined ? fields.start_local : existing.start_local,
    end_local:
      fields.end_local !== undefined ? fields.end_local : existing.end_local,
    location: fields.location !== undefined ? fields.location : existing.location,
    selected:
      fields.selected !== undefined
        ? fields.selected
          ? 1
          : 0
        : existing.selected,
    updated_at: nowIso(),
  };
  getDb()
    .prepare(
      `UPDATE schedule_import_item SET subject = ?, weekday = ?, start_local = ?,
         end_local = ?, location = ?, selected = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      next.subject,
      next.weekday,
      next.start_local,
      next.end_local,
      next.location,
      next.selected,
      next.updated_at,
      id,
    );
  return getScheduleImportItemById(id);
}

/** Mark a single item's terminal status (approved | rejected). */
export function setScheduleImportItemStatus(id: number, status: string): void {
  getDb()
    .prepare(
      "UPDATE schedule_import_item SET status = ?, updated_at = ? WHERE id = ?",
    )
    .run(status, nowIso(), id);
}

/** Mark the session's terminal status (approved | discarded). */
export function setScheduleImportStatus(id: number, status: string): void {
  getDb()
    .prepare("UPDATE schedule_import SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, nowIso(), id);
}
