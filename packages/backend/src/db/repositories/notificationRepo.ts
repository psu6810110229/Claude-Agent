import { getDb } from "../connection.js";
import { nowIso } from "../../config.js";
import type { Notification } from "../../schemas/notification.js";

const COLS =
  "id, kind, source_id, title, body, fire_at, status, dedup_key, created_at, updated_at";

/**
 * Insert a notification row only if none with (kind, source_id) already exists.
 * Returns true when a row was actually inserted (scheduler should toast on true).
 * The UNIQUE index on (kind, source_id) enforces dedup at the DB level.
 */
export function insertNotificationIfNew(
  kind: string,
  sourceId: number,
  title: string,
  body: string | null,
  fireAt: string,
): boolean {
  const ts = nowIso();
  const info = getDb()
    .prepare(
      `INSERT OR IGNORE INTO notification
         (kind, source_id, title, body, fire_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'unread', ?, ?)`,
    )
    .run(kind, sourceId, title, body ?? null, fireAt, ts, ts);
  return info.changes > 0;
}

/**
 * Step 22 — insert a notification deduped on a STRING `dedup_key` instead of
 * (kind, source_id). Used by active-topic triage so the SAME topic can re-fire
 * when NEW evidence appears (key = `active_topic:<id>:<newestEvidenceAtUtc>`),
 * while the same evidence instant never re-notifies. Returns true when a new row
 * was inserted (the partial unique index on dedup_key enforces dedup at the DB
 * level). Does NOT replace insertNotificationIfNew — existing kinds keep their
 * (kind, source_id) behavior.
 */
export function insertNotificationWithDedupKey(
  kind: string,
  sourceId: number,
  title: string,
  body: string | null,
  fireAt: string,
  dedupKey: string,
): boolean {
  const ts = nowIso();
  const info = getDb()
    .prepare(
      `INSERT OR IGNORE INTO notification
         (kind, source_id, title, body, fire_at, status, dedup_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'unread', ?, ?, ?)`,
    )
    .run(kind, sourceId, title, body ?? null, fireAt, dedupKey, ts, ts);
  return info.changes > 0;
}

/** Most recent notifications, newest first, capped at `limit`. */
export function listNotifications(limit = 50): Notification[] {
  return getDb()
    .prepare(`SELECT ${COLS} FROM notification ORDER BY id DESC LIMIT ?`)
    .all(limit) as Notification[];
}

/** Unread notifications only, newest first. */
export function listUnreadNotifications(): Notification[] {
  return getDb()
    .prepare(
      `SELECT ${COLS} FROM notification WHERE status = 'unread' ORDER BY id DESC`,
    )
    .all() as Notification[];
}

export function getNotificationById(id: number): Notification | undefined {
  return getDb()
    .prepare(`SELECT ${COLS} FROM notification WHERE id = ?`)
    .get(id) as Notification | undefined;
}

/**
 * Transition status from 'unread' → 'read'. Returns true when the row existed
 * and was mutated; false if it did not exist or was already read.
 */
export function markNotificationRead(id: number): boolean {
  const info = getDb()
    .prepare(
      "UPDATE notification SET status = 'read', updated_at = ? WHERE id = ? AND status = 'unread'",
    )
    .run(nowIso(), id);
  return info.changes > 0;
}
