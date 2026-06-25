import { getDb } from "../connection.js";
import { nowIso } from "../../config.js";
import type {
  ClassBlock,
  CreateClassBlockInput,
  UpdateClassBlockInput,
} from "../../schemas/classBlock.js";

/**
 * class_block repository — the LOCAL store for an imported/hand-entered weekly
 * timetable. Soft-archive only (status='archived'); never hard-deletes, matching
 * the project convention for user data. `updated_at` is app-maintained.
 */

const COLS =
  "id, subject, weekday, start_local, end_local, location, active_from, active_until, status, source, created_at, updated_at";

/** All active class blocks, ordered by weekday then start time. */
export function listActiveClassBlocks(): ClassBlock[] {
  return getDb()
    .prepare(
      `SELECT ${COLS} FROM class_block WHERE status = 'active' ORDER BY weekday ASC, start_local ASC`,
    )
    .all() as ClassBlock[];
}

export function getClassBlockById(id: number): ClassBlock | undefined {
  return getDb()
    .prepare(`SELECT ${COLS} FROM class_block WHERE id = ?`)
    .get(id) as ClassBlock | undefined;
}

export function createClassBlock(input: CreateClassBlockInput): ClassBlock {
  const ts = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO class_block
         (subject, weekday, start_local, end_local, location, active_from, active_until, status, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    .run(
      input.subject,
      input.weekday,
      input.start_local,
      input.end_local,
      input.location ?? null,
      input.active_from ?? null,
      input.active_until ?? null,
      input.source ?? "manual",
      ts,
      ts,
    );
  return getClassBlockById(Number(info.lastInsertRowid))!;
}

/**
 * Idempotent create: skips when an ACTIVE block with the same
 * (subject, weekday, start_local) already exists, returning the existing row.
 * Keeps a re-import or overlapping fact-vs-block from duplicating a class.
 */
export function createClassBlockDedup(input: CreateClassBlockInput): {
  block: ClassBlock;
  created: boolean;
} {
  const existing = getDb()
    .prepare(
      `SELECT ${COLS} FROM class_block
       WHERE status = 'active' AND subject = ? AND weekday = ? AND start_local = ?`,
    )
    .get(input.subject, input.weekday, input.start_local) as
    | ClassBlock
    | undefined;
  if (existing) return { block: existing, created: false };
  return { block: createClassBlock(input), created: true };
}

export function updateClassBlock(
  id: number,
  fields: UpdateClassBlockInput,
): ClassBlock | undefined {
  const existing = getClassBlockById(id);
  if (!existing) return undefined;
  const next = {
    subject: fields.subject ?? existing.subject,
    weekday: fields.weekday ?? existing.weekday,
    start_local: fields.start_local ?? existing.start_local,
    end_local: fields.end_local ?? existing.end_local,
    location: fields.location !== undefined ? fields.location : existing.location,
    active_from:
      fields.active_from !== undefined ? fields.active_from : existing.active_from,
    active_until:
      fields.active_until !== undefined
        ? fields.active_until
        : existing.active_until,
    updated_at: nowIso(),
  };
  getDb()
    .prepare(
      `UPDATE class_block SET subject = ?, weekday = ?, start_local = ?, end_local = ?,
         location = ?, active_from = ?, active_until = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      next.subject,
      next.weekday,
      next.start_local,
      next.end_local,
      next.location,
      next.active_from,
      next.active_until,
      next.updated_at,
      id,
    );
  return getClassBlockById(id);
}

/** Soft-archive (status='archived'); never hard-deletes. */
export function archiveClassBlock(id: number): ClassBlock | undefined {
  const existing = getClassBlockById(id);
  if (!existing) return undefined;
  getDb()
    .prepare("UPDATE class_block SET status = 'archived', updated_at = ? WHERE id = ?")
    .run(nowIso(), id);
  return getClassBlockById(id);
}
