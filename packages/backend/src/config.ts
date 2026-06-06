import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Backend binds to localhost only (safety: no external exposure). */
export const HOST = "127.0.0.1";

/** Default port, overridable via env. */
export const PORT = Number(process.env.CLAUDE_AGENT_PORT ?? 8787);

/** packages/backend/data (src/ -> ../data) */
export const DATA_DIR = path.resolve(__dirname, "..", "data");

/** SQLite database file path. */
export const DB_PATH = path.join(DATA_DIR, "claude_agent.db");

/** Single source of truth for UTC ISO 8601 timestamps. */
export function nowIso(): string {
  return new Date().toISOString();
}
