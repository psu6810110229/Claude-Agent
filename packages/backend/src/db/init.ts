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
  ensureMemoryFiles();
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
