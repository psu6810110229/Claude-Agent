import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./connection.js";
import { ensureMemoryFiles } from "../services/memoryStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Applies schema.sql idempotently (CREATE TABLE IF NOT EXISTS) and ensures the
 * whitelisted memory files exist (seeded with a template header if missing).
 */
export function initDb(): void {
  const db = getDb();
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);
  ensureApprovalExecutionColumns();
  ensureChatMessageSourcePreviewsColumn();
  ensureNotificationDedupColumn();
  ensureCalendarPlanItemTriageColumns();
  ensureMemoryFiles();
}

/**
 * Triage redesign — additive migration for the per-item category + the existing
 * clashing event's time (shown as "already on calendar at HH:MM"). Fresh DBs get
 * these from schema.sql; pre-existing DBs add them here. Legacy rows default to
 * category='clean' (NULL-safe) and NULL conflict times — the UI falls back to the
 * conflict_with snapshot, so old pending plans keep rendering.
 */
function ensureCalendarPlanItemTriageColumns(): void {
  const db = getDb();
  const columns = new Set(
    (
      db
        .prepare("PRAGMA table_info(calendar_plan_item)")
        .all() as { name: string }[]
    ).map((col) => col.name),
  );
  const additions: Record<string, string> = {
    category: "TEXT NOT NULL DEFAULT 'clean'",
    conflict_starts_at: "TEXT",
    conflict_ends_at: "TEXT",
  };
  for (const [name, decl] of Object.entries(additions)) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE calendar_plan_item ADD COLUMN ${name} ${decl}`);
    }
  }
}

/**
 * Source previews are deterministic evidence cards for assistant turns. Persist
 * them with chat history so Drive/Gmail previews survive dashboard refreshes.
 */
function ensureChatMessageSourcePreviewsColumn(): void {
  const db = getDb();
  const columns = new Set(
    (
      db
        .prepare("PRAGMA table_info(chat_message)")
        .all() as { name: string }[]
    ).map((col) => col.name),
  );
  if (!columns.has("source_previews_json")) {
    db.exec("ALTER TABLE chat_message ADD COLUMN source_previews_json TEXT");
  }
}

/**
 * Step 22 — additive migration for the active-topic triage dedup key. On a fresh
 * DB the column is created by schema.sql; on a pre-existing DB CREATE TABLE IF NOT
 * EXISTS is a no-op, so add the nullable `dedup_key` column here (mirrors
 * ensureApprovalExecutionColumns). Existing rows keep dedup_key = NULL and their
 * (kind, source_id) dedup; the partial unique index (schema.sql) excludes NULLs.
 */
function ensureNotificationDedupColumn(): void {
  const db = getDb();
  const columns = new Set(
    (
      db
        .prepare("PRAGMA table_info(notification)")
        .all() as { name: string }[]
    ).map((col) => col.name),
  );
  if (!columns.has("dedup_key")) {
    db.exec("ALTER TABLE notification ADD COLUMN dedup_key TEXT");
  }
  // Idempotent; partial index so legacy NULL dedup_key rows never collide.
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_dedup ON notification (dedup_key) WHERE dedup_key IS NOT NULL",
  );
}

function ensureApprovalExecutionColumns(): void {
  const db = getDb();
  const columns = new Set(
    (
      db
        .prepare("PRAGMA table_info(approval)")
        .all() as { name: string }[]
    ).map((col) => col.name),
  );

  const additions: Record<string, string> = {
    execution_status: "TEXT NOT NULL DEFAULT 'not_started'",
    executed_at: "TEXT",
    execution_error: "TEXT",
    result_summary: "TEXT",
    undo_json: "TEXT",
  };

  for (const [name, definition] of Object.entries(additions)) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE approval ADD COLUMN ${name} ${definition}`);
    }
  }
}

// Allow running directly: `tsx src/db/init.ts`
const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  initDb();
  console.log("Database initialized.");
}
