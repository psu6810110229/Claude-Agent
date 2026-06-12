import { getDb } from "../connection.js";
import { nowIso } from "../../config.js";
import type { Reminder } from "../../schemas/reminder.js";

const COLS = "id, title, due_at, notes, status, created_at, updated_at";

/**
 * All live (active) reminders, soonest due first. `done` and `archived` are both
 * excluded — a completed or filed reminder must not resurface in Today/Upcoming
 * or be counted as overdue.
 */
export function listReminders(): Reminder[] {
  return getDb()
    .prepare(
      `SELECT ${COLS} FROM reminder WHERE status = 'active' ORDER BY due_at ASC`,
    )
    .all() as Reminder[];
}

export function getReminderById(id: number): Reminder | undefined {
  return getDb()
    .prepare(`SELECT ${COLS} FROM reminder WHERE id = ?`)
    .get(id) as Reminder | undefined;
}

export interface CreateReminderInput {
  title: string;
  due_at: string;
  notes?: string;
}

export function createReminder(input: CreateReminderInput): Reminder {
  const ts = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO reminder (title, due_at, notes, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    )
    .run(input.title, input.due_at, input.notes ?? null, ts, ts);
  return getReminderById(Number(info.lastInsertRowid))!;
}

export interface UpdateReminderFields {
  title?: string;
  due_at?: string;
  notes?: string;
}

/**
 * Patch any subset of mutable fields. `updated_at` is always refreshed in app
 * code (per project convention — no SQLite triggers). Returns undefined if the
 * reminder does not exist.
 */
export function updateReminder(
  id: number,
  fields: UpdateReminderFields,
): Reminder | undefined {
  const existing = getReminderById(id);
  if (!existing) return undefined;

  const next = {
    title: fields.title ?? existing.title,
    due_at: fields.due_at ?? existing.due_at,
    notes: fields.notes ?? existing.notes,
    updated_at: nowIso(),
  };
  getDb()
    .prepare(
      "UPDATE reminder SET title = ?, due_at = ?, notes = ?, updated_at = ? WHERE id = ?",
    )
    .run(next.title, next.due_at, next.notes, next.updated_at, id);
  return getReminderById(id);
}

/** Mark a reminder completed (status = 'done'); distinct from archiving. */
export function completeReminder(id: number): Reminder | undefined {
  const existing = getReminderById(id);
  if (!existing) return undefined;
  getDb()
    .prepare("UPDATE reminder SET status = ?, updated_at = ? WHERE id = ?")
    .run("done", nowIso(), id);
  return getReminderById(id);
}

/** Soft-archive (status = 'archived'); never hard-deletes. */
export function archiveReminder(id: number): Reminder | undefined {
  const existing = getReminderById(id);
  if (!existing) return undefined;
  getDb()
    .prepare("UPDATE reminder SET status = ?, updated_at = ? WHERE id = ?")
    .run("archived", nowIso(), id);
  return getReminderById(id);
}
