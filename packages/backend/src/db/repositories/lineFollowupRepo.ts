import { getDb } from "../connection.js";
import { nowIso } from "../../config.js";
import type {
  LineFollowup,
  LineFollowupStatus,
} from "../../schemas/lineFollowup.js";

/**
 * LINE follow-up watch repository (Step 21).
 *
 * Rows are created only through the approval-gated `line_followup.create` action
 * (see executor). Read-only with respect to LINE itself — this table never
 * mutates exported files or LINE. `keywords` is stored as a JSON array string and
 * hydrated back to string[] on read.
 */

const COLS =
  "id, topic, keywords, chat_filter, due_at, baseline_at, status, created_at, updated_at";

interface LineFollowupRow {
  id: number;
  topic: string;
  keywords: string;
  chat_filter: string | null;
  due_at: string;
  baseline_at: string;
  status: LineFollowupStatus;
  created_at: string;
  updated_at: string;
}

function hydrate(row: LineFollowupRow): LineFollowup {
  let keywords: string[];
  try {
    const parsed = JSON.parse(row.keywords) as unknown;
    keywords = Array.isArray(parsed) ? parsed.map((k) => String(k)) : [];
  } catch {
    keywords = [];
  }
  return { ...row, keywords };
}

export interface CreateLineFollowupInput {
  topic: string;
  keywords: string[];
  chat_filter?: string | null;
  due_at: string;
  /** Baseline instant; messages newer than this count as "new". */
  baseline_at: string;
}

export function createLineFollowup(
  input: CreateLineFollowupInput,
): LineFollowup {
  const ts = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO line_followup
         (topic, keywords, chat_filter, due_at, baseline_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(
      input.topic,
      JSON.stringify(input.keywords),
      input.chat_filter ?? null,
      input.due_at,
      input.baseline_at,
      ts,
      ts,
    );
  return getLineFollowupById(Number(info.lastInsertRowid))!;
}

export function getLineFollowupById(id: number): LineFollowup | undefined {
  const row = getDb()
    .prepare(`SELECT ${COLS} FROM line_followup WHERE id = ?`)
    .get(id) as LineFollowupRow | undefined;
  return row ? hydrate(row) : undefined;
}

/** All active (pending) watches, soonest due first. */
export function listPendingLineFollowups(): LineFollowup[] {
  const rows = getDb()
    .prepare(
      `SELECT ${COLS} FROM line_followup WHERE status = 'pending' ORDER BY due_at ASC`,
    )
    .all() as LineFollowupRow[];
  return rows.map(hydrate);
}

/** Pending watches whose due_at has arrived (due_at <= nowUtc), soonest first. */
export function listDueLineFollowups(nowUtc: string): LineFollowup[] {
  const rows = getDb()
    .prepare(
      `SELECT ${COLS} FROM line_followup
       WHERE status = 'pending' AND due_at <= ?
       ORDER BY due_at ASC`,
    )
    .all(nowUtc) as LineFollowupRow[];
  return rows.map(hydrate);
}

/** Mark a watch checked (status = 'fired'); it will not be re-checked. */
export function markLineFollowupFired(id: number): LineFollowup | undefined {
  const existing = getLineFollowupById(id);
  if (!existing) return undefined;
  getDb()
    .prepare(
      "UPDATE line_followup SET status = 'fired', updated_at = ? WHERE id = ?",
    )
    .run(nowIso(), id);
  return getLineFollowupById(id);
}

/** Cancel a pending watch (status = 'cancelled'). */
export function cancelLineFollowup(id: number): LineFollowup | undefined {
  const existing = getLineFollowupById(id);
  if (!existing) return undefined;
  getDb()
    .prepare(
      "UPDATE line_followup SET status = 'cancelled', updated_at = ? WHERE id = ?",
    )
    .run(nowIso(), id);
  return getLineFollowupById(id);
}
