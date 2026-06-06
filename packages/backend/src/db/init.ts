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
  ensureMemoryFiles();
}

// Allow running directly: `tsx src/db/init.ts`
const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  initDb();
  console.log("Database initialized.");
}
