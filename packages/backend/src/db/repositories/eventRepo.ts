import { getDb } from "../connection.js";
import { nowIso } from "../../config.js";
import type { Event } from "../../schemas/event.js";

const COLS =
  "id, title, starts_at, ends_at, location, notes, status, created_at, updated_at";

/** All non-archived events, soonest first. */
export function listEvents(): Event[] {
  return getDb()
    .prepare(
      `SELECT ${COLS} FROM event WHERE status != 'archived' ORDER BY starts_at ASC`,
    )
    .all() as Event[];
}

export function getEventById(id: number): Event | undefined {
  return getDb()
    .prepare(`SELECT ${COLS} FROM event WHERE id = ?`)
    .get(id) as Event | undefined;
}

export interface CreateEventInput {
  title: string;
  starts_at: string;
  ends_at?: string;
  location?: string;
  notes?: string;
}

export function createEvent(input: CreateEventInput): Event {
  const ts = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO event (title, starts_at, ends_at, location, notes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
    )
    .run(
      input.title,
      input.starts_at,
      input.ends_at ?? null,
      input.location ?? null,
      input.notes ?? null,
      ts,
      ts,
    );
  return getEventById(Number(info.lastInsertRowid))!;
}

export interface UpdateEventFields {
  title?: string;
  starts_at?: string;
  ends_at?: string;
  location?: string;
  notes?: string;
}

/**
 * Patch any subset of mutable fields. `updated_at` is always refreshed in app
 * code (per project convention — no SQLite triggers). Returns undefined if the
 * event does not exist.
 */
export function updateEvent(
  id: number,
  fields: UpdateEventFields,
): Event | undefined {
  const existing = getEventById(id);
  if (!existing) return undefined;

  const next = {
    title: fields.title ?? existing.title,
    starts_at: fields.starts_at ?? existing.starts_at,
    ends_at: fields.ends_at ?? existing.ends_at,
    location: fields.location ?? existing.location,
    notes: fields.notes ?? existing.notes,
    updated_at: nowIso(),
  };
  getDb()
    .prepare(
      `UPDATE event SET title = ?, starts_at = ?, ends_at = ?, location = ?, notes = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      next.title,
      next.starts_at,
      next.ends_at,
      next.location,
      next.notes,
      next.updated_at,
      id,
    );
  return getEventById(id);
}

/** Soft-archive (status = 'archived'); never hard-deletes. */
export function archiveEvent(id: number): Event | undefined {
  const existing = getEventById(id);
  if (!existing) return undefined;
  getDb()
    .prepare("UPDATE event SET status = ?, updated_at = ? WHERE id = ?")
    .run("archived", nowIso(), id);
  return getEventById(id);
}
