import { getDb } from "../connection.js";
import { nowIso } from "../../config.js";

/** Return the stored boolean for `key`, or null if the key is absent (env-var fallback applies). */
export function getConfigBool(key: string): boolean | null {
  const row = getDb()
    .prepare("SELECT value FROM config WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!row) return null;
  return row.value === "1";
}

/** Upsert a boolean config value. */
export function setConfigBool(key: string, value: boolean): void {
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value ? "1" : "0", ts);
}
