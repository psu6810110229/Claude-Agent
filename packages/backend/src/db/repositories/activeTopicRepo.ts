import { getDb } from "../connection.js";
import { nowIso } from "../../config.js";
import type {
  ActiveTopic,
  ActiveTopicStatus,
  CreateActiveTopicInput,
} from "../../schemas/activeTopic.js";

/**
 * Active topic repository (Step 22).
 *
 * Rows are created only through the approval-gated `active_topic.create` action.
 * Read-only with respect to LINE — this table never mutates exported files or
 * LINE itself. `keywords` is stored as a JSON array string and hydrated to
 * string[] on read. `updated_at` is maintained in app code per project convention.
 * Rows are soft-archived (status='resolved'/'paused'), never hard-deleted.
 */

const COLS = [
  "id", "title", "source", "keywords", "chat_filter", "status",
  "priority", "baseline_at", "last_checked_at", "last_evidence_at",
  "last_summary", "cooldown_minutes", "created_from", "created_at", "updated_at",
].join(", ");

interface ActiveTopicRow {
  id: number;
  title: string;
  source: string;
  keywords: string;
  chat_filter: string | null;
  status: ActiveTopicStatus;
  priority: number;
  baseline_at: string;
  last_checked_at: string | null;
  last_evidence_at: string | null;
  last_summary: string | null;
  cooldown_minutes: number;
  created_from: string;
  created_at: string;
  updated_at: string;
}

function hydrate(row: ActiveTopicRow): ActiveTopic {
  let keywords: string[];
  try {
    const parsed = JSON.parse(row.keywords) as unknown;
    keywords = Array.isArray(parsed) ? parsed.map((k) => String(k)) : [];
  } catch {
    keywords = [];
  }
  return {
    ...row,
    keywords,
    source: row.source as ActiveTopic["source"],
    status: row.status as ActiveTopic["status"],
    created_from: row.created_from as ActiveTopic["created_from"],
  };
}

export function createActiveTopic(input: CreateActiveTopicInput): ActiveTopic {
  const ts = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO active_topic
         (title, source, keywords, chat_filter, status, priority, baseline_at,
          last_checked_at, last_evidence_at, last_summary, cooldown_minutes,
          created_from, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)`,
    )
    .run(
      input.title,
      input.source,
      JSON.stringify(input.keywords),
      input.chat_filter ?? null,
      input.priority ?? 50,
      input.baseline_at,
      input.cooldown_minutes ?? 30,
      input.created_from,
      ts,
      ts,
    );
  return getActiveTopicById(Number(info.lastInsertRowid))!;
}

export function getActiveTopicById(id: number): ActiveTopic | undefined {
  const row = getDb()
    .prepare(`SELECT ${COLS} FROM active_topic WHERE id = ?`)
    .get(id) as ActiveTopicRow | undefined;
  return row ? hydrate(row) : undefined;
}

export function listActiveTopics(options?: {
  status?: string;
  source?: string;
  limit?: number;
}): ActiveTopic[] {
  const conditions: string[] = [];

  if (options?.status !== undefined) conditions.push("status = ?");
  if (options?.source !== undefined) conditions.push("source = ?");

  let sql = `SELECT ${COLS} FROM active_topic`;
  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY priority DESC, updated_at DESC";
  if (options?.limit !== undefined) sql += " LIMIT ?";

  // Build param list matching the conditions order
  const binds: (string | number)[] = [];
  if (options?.status !== undefined) binds.push(options.status);
  if (options?.source !== undefined) binds.push(options.source);
  if (options?.limit !== undefined) binds.push(options.limit);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = getDb().prepare(sql).all(...(binds as any[])) as ActiveTopicRow[];
  return rows.map(hydrate);
}

/**
 * Active topics eligible for a LINE evidence check: status='active', source
 * line/mixed, and cooldown elapsed (or never checked). Ordered by priority DESC.
 * Cooldown is checked in JS because SQLite datetime arithmetic with ISO 8601
 * milliseconds (e.g. ".000Z") is unreliable across SQLite versions.
 */
export function listDueActiveTopicsForLineCheck(nowUtc: string): ActiveTopic[] {
  const rows = getDb()
    .prepare(
      `SELECT ${COLS} FROM active_topic
       WHERE status = 'active' AND (source = 'line' OR source = 'mixed')
       ORDER BY priority DESC`,
    )
    .all() as ActiveTopicRow[];
  const topics = rows.map(hydrate);
  const nowMs = new Date(nowUtc).getTime();
  return topics.filter((t) => {
    if (t.last_checked_at === null) return true;
    const checkedMs = new Date(t.last_checked_at).getTime();
    return nowMs - checkedMs >= t.cooldown_minutes * 60 * 1000;
  });
}

/**
 * Cheap candidate prefilter for the resolver: active topics whose title or any
 * keyword appears as a case-insensitive substring of `message`. Returns capped
 * list; scoring and final resolution happen in `activeTopicIntelligence`.
 */
export function findRelevantActiveTopics(
  message: string,
  limit: number,
): ActiveTopic[] {
  const all = listActiveTopics({ status: "active" });
  const msgLower = message.toLowerCase();
  const relevant = all.filter((topic) => {
    const titleLower = topic.title.toLowerCase();
    if (msgLower.includes(titleLower)) return true;
    const firstWord = msgLower.split(/\s+/)[0] ?? "";
    if (
      titleLower.length <= 20 &&
      firstWord.length >= 2 &&
      titleLower.includes(firstWord)
    )
      return true;
    return topic.keywords.some((k) => msgLower.includes(k.toLowerCase()));
  });
  return relevant.slice(0, limit);
}

/**
 * Partial update after a scheduler/evidence pass. Only the provided fields are
 * mutated; `updated_at` is always bumped.
 */
export function updateActiveTopicCheck(
  id: number,
  patch: {
    last_checked_at?: string | null;
    last_evidence_at?: string | null;
    last_summary?: string | null;
    baseline_at?: string;
  },
): ActiveTopic | undefined {
  if (!getActiveTopicById(id)) return undefined;
  const ts = nowIso();

  const sets: string[] = ["updated_at = ?"];
  const params: (string | null | number)[] = [ts];

  if ("last_checked_at" in patch) {
    sets.push("last_checked_at = ?");
    params.push(patch.last_checked_at ?? null);
  }
  if ("last_evidence_at" in patch) {
    sets.push("last_evidence_at = ?");
    params.push(patch.last_evidence_at ?? null);
  }
  if ("last_summary" in patch) {
    sets.push("last_summary = ?");
    params.push(patch.last_summary ? patch.last_summary.slice(0, 200) : null);
  }
  if (patch.baseline_at !== undefined) {
    sets.push("baseline_at = ?");
    params.push(patch.baseline_at);
  }

  params.push(id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDb()
    .prepare(`UPDATE active_topic SET ${sets.join(", ")} WHERE id = ?`)
    .run(...(params as any[]));
  return getActiveTopicById(id);
}

export function pauseActiveTopic(id: number): ActiveTopic | undefined {
  if (!getActiveTopicById(id)) return undefined;
  getDb()
    .prepare(
      "UPDATE active_topic SET status = 'paused', updated_at = ? WHERE id = ?",
    )
    .run(nowIso(), id);
  return getActiveTopicById(id);
}

export function resolveActiveTopic(id: number): ActiveTopic | undefined {
  if (!getActiveTopicById(id)) return undefined;
  getDb()
    .prepare(
      "UPDATE active_topic SET status = 'resolved', updated_at = ? WHERE id = ?",
    )
    .run(nowIso(), id);
  return getActiveTopicById(id);
}
