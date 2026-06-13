import { getDb } from "../connection.js";
import { nowIso } from "../../config.js";
import type {
  FactCategory,
  FactRememberPayload,
  FactUpdatePayload,
  MemoryFact,
} from "../../schemas/fact.js";

/**
 * Step 16 — repository for `memory_fact`. Facts are durable, recallable
 * statements about the user. Soft-archive only (status='archived'); never hard
 * deleted. `pinned` is stored as INTEGER 0/1 and mapped to boolean at the edge.
 */

const COLS =
  "id, content, keywords, category, pinned, source, status, created_at, updated_at";

/** Raw DB row shape (pinned as 0/1 integer). */
interface FactRow {
  id: number;
  content: string;
  keywords: string;
  category: FactCategory;
  pinned: number;
  source: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Map a raw row to the API/domain shape (drops `status`, pinned -> boolean). */
function toFact(row: FactRow): MemoryFact {
  return {
    id: row.id,
    content: row.content,
    keywords: row.keywords,
    category: row.category,
    pinned: row.pinned === 1,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** All active facts, pinned first, then most-recently updated. */
export function listActiveFacts(): MemoryFact[] {
  const rows = getDb()
    .prepare(
      `SELECT ${COLS} FROM memory_fact WHERE status = 'active'
       ORDER BY pinned DESC, updated_at DESC`,
    )
    .all() as FactRow[];
  return rows.map(toFact);
}

export function getFact(id: number): MemoryFact | undefined {
  const row = getDb()
    .prepare(`SELECT ${COLS} FROM memory_fact WHERE id = ?`)
    .get(id) as FactRow | undefined;
  return row ? toFact(row) : undefined;
}

/**
 * Case-insensitive exact-content lookup among active facts, used to dedupe an
 * identical `fact.remember`. Returns the existing fact if found.
 */
export function findActiveFactByContent(
  content: string,
): MemoryFact | undefined {
  const row = getDb()
    .prepare(
      `SELECT ${COLS} FROM memory_fact
       WHERE status = 'active' AND lower(trim(content)) = lower(trim(?))
       LIMIT 1`,
    )
    .get(content) as FactRow | undefined;
  return row ? toFact(row) : undefined;
}

/**
 * Insert a fact, or — if an identical active fact already exists — touch its
 * `updated_at` and return it (dedupe). `source` defaults to 'chat'.
 */
export function createFact(
  payload: FactRememberPayload,
  source: string = "chat",
): MemoryFact {
  const existing = findActiveFactByContent(payload.content);
  const ts = nowIso();
  if (existing) {
    getDb()
      .prepare("UPDATE memory_fact SET updated_at = ? WHERE id = ?")
      .run(ts, existing.id);
    return getFact(existing.id)!;
  }
  const info = getDb()
    .prepare(
      `INSERT INTO memory_fact
         (content, keywords, category, pinned, source, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(
      payload.content,
      payload.keywords ?? "",
      payload.category ?? "general",
      payload.pinned ? 1 : 0,
      source,
      ts,
      ts,
    );
  return getFact(Number(info.lastInsertRowid))!;
}

/**
 * Patch any subset of mutable fields. Returns undefined if the fact does not
 * exist. `updated_at` always refreshed (per project convention; no triggers).
 */
export function updateFact(
  id: number,
  fields: Omit<FactUpdatePayload, "id">,
): MemoryFact | undefined {
  const existing = getFact(id);
  if (!existing) return undefined;
  const next = {
    content: fields.content ?? existing.content,
    keywords: fields.keywords ?? existing.keywords,
    category: fields.category ?? existing.category,
    pinned:
      fields.pinned !== undefined ? (fields.pinned ? 1 : 0) : existing.pinned ? 1 : 0,
    updated_at: nowIso(),
  };
  getDb()
    .prepare(
      "UPDATE memory_fact SET content = ?, keywords = ?, category = ?, pinned = ?, updated_at = ? WHERE id = ?",
    )
    .run(next.content, next.keywords, next.category, next.pinned, next.updated_at, id);
  return getFact(id);
}

/** Soft-archive (status='archived'); never hard-deletes. */
export function archiveFact(id: number): MemoryFact | undefined {
  const existing = getFact(id);
  if (!existing) return undefined;
  getDb()
    .prepare("UPDATE memory_fact SET status = ?, updated_at = ? WHERE id = ?")
    .run("archived", nowIso(), id);
  return getFact(id);
}
