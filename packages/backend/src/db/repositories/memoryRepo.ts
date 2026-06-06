import { getDb } from "../connection.js";
import { nowIso } from "../../config.js";
import type { MemoryEntry } from "../../schemas/memory.js";

/** All memory_index rows, newest activity first. */
export function listMemoryEntries(): MemoryEntry[] {
  return getDb()
    .prepare(
      "SELECT id, slug, path, summary, created_at, updated_at FROM memory_index ORDER BY slug ASC",
    )
    .all() as MemoryEntry[];
}

export function getMemoryEntryBySlug(slug: string): MemoryEntry | undefined {
  return getDb()
    .prepare(
      "SELECT id, slug, path, summary, created_at, updated_at FROM memory_index WHERE slug = ?",
    )
    .get(slug) as MemoryEntry | undefined;
}

/**
 * Upsert one memory_index entry keyed by slug. memory_index has no UNIQUE
 * constraint, so we look up first: existing rows are updated (summary/path +
 * updated_at), new ones inserted. created_at is preserved on update.
 */
export function upsertMemoryEntry(
  slug: string,
  path: string,
  summary: string | null,
): MemoryEntry {
  const db = getDb();
  const ts = nowIso();
  const existing = getMemoryEntryBySlug(slug);
  if (existing) {
    db.prepare(
      "UPDATE memory_index SET path = ?, summary = ?, updated_at = ? WHERE slug = ?",
    ).run(path, summary, ts, slug);
  } else {
    db.prepare(
      "INSERT INTO memory_index (slug, path, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(slug, path, summary, ts, ts);
  }
  return getMemoryEntryBySlug(slug)!;
}
