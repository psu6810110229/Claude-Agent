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

/**
 * Repo-root memory/ directory (src/ -> ../../../memory). Memory is durable,
 * human-readable project/user context; the backend owns access control but the
 * files live at the repo root, not inside backend source. Writes are confined
 * to this directory and a fixed target whitelist (see services/memoryStore).
 * Overridable via env so tests can target a throwaway directory.
 */
export const MEMORY_DIR =
  process.env.CLAUDE_AGENT_MEMORY_DIR ??
  path.resolve(__dirname, "..", "..", "..", "memory");

/**
 * Step 6 — Claude reasoning runtime (proposal-only). Claude is invoked through a
 * controlled `claude -p` call and may ONLY produce structured action proposals
 * that flow into the existing approval queue. It never executes anything.
 */

/** Path/name of the Claude Code CLI binary. */
export const CLAUDE_BIN = process.env.CLAUDE_AGENT_CLAUDE_BIN ?? "claude";

/** Hard timeout for a single `claude -p` invocation (ms). Fail closed on expiry. */
export const CLAUDE_TIMEOUT_MS = Number(
  process.env.CLAUDE_AGENT_CLAUDE_TIMEOUT_MS ?? 20_000,
);

/**
 * AI command mode is OFF unless explicitly enabled. When disabled, real Claude
 * invocation fails clearly (the stubbed smoke test injects its own invoker and
 * is unaffected by this flag).
 */
export const CLAUDE_AI_ENABLED = /^(1|true)$/i.test(
  process.env.CLAUDE_AGENT_AI_ENABLED ?? "",
);

/** Max proposed actions accepted from a single AI command (anything more is rejected). */
export const CLAUDE_MAX_ACTIONS = 5;

/** Cap on open tasks included in the compact context snapshot passed to Claude. */
export const CLAUDE_CONTEXT_TASK_CAP = 20;

/** Single source of truth for UTC ISO 8601 timestamps. */
export function nowIso(): string {
  return new Date().toISOString();
}
