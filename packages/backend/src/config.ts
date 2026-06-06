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

/**
 * Model the agent uses for its `claude -p` reasoning calls. Pinned to Sonnet 4.6
 * (cheaper/faster) and passed explicitly via `--model`, so it is independent of
 * whatever default the interactive Claude Code CLI is configured to use for
 * coding. Overridable via env.
 */
export const CLAUDE_MODEL =
  process.env.CLAUDE_AGENT_CLAUDE_MODEL ?? "claude-sonnet-4-6";

/** Hard timeout for a single `claude -p` invocation (ms). Fail closed on expiry. */
export const CLAUDE_TIMEOUT_MS = Number(
  process.env.CLAUDE_AGENT_CLAUDE_TIMEOUT_MS ?? 20_000,
);

/**
 * Separate, longer timeout for brief generation (ms). Briefs read more context
 * and produce a narrative summary plus optional actions, so they legitimately
 * take longer than the lightweight command bar. Kept independent so command AI
 * stays snappy. Fail closed on expiry. Overridable via env.
 */
export const CLAUDE_BRIEF_TIMEOUT_MS = Number(
  process.env.CLAUDE_AGENT_BRIEF_TIMEOUT_MS ?? 90_000,
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

/**
 * Step 8 — Daily Brief / Evening Review (proposal-only, AI-gated). Briefs reuse
 * the Claude reasoning runtime and the approval queue; they are stateless (never
 * persisted) and emit only the existing allowlisted action types.
 */

/** Max recent activity rows included in a brief's compact context. */
export const BRIEF_ACTIVITY_LIMIT = 15;

/** Max pending approvals listed (by id + type only) in a brief's context. */
export const BRIEF_APPROVALS_CAP = 10;

/**
 * Step 9 — local events & reminders.
 *
 * The user's local timezone for INTERPRETING natural-language dates/times is
 * Asia/Bangkok (UTC+7, no DST). This offset is used to compute "today" / 7-day
 * "upcoming" day boundaries and to tell Claude the local wall-clock time. All
 * datetimes are still STORED and emitted as ISO 8601 UTC.
 */
export const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Default "upcoming" window length in days (excludes today). */
export const UPCOMING_WINDOW_DAYS = 7;

/** Cap on events included in a brief's compact context. */
export const BRIEF_EVENT_CAP = 20;

/** Cap on reminders included in a brief's compact context. */
export const BRIEF_REMINDER_CAP = 20;

/**
 * Step 10 — Google Calendar read-only connector.
 *
 * READ-ONLY by design: the only OAuth scope ever requested is
 * `calendar.readonly`. The backend never creates, updates, or deletes calendar
 * events, and there are NO calendar write action types in the approval
 * allowlist. Google Calendar is the PRIMARY schedule source; local
 * events/reminders (Step 9) remain secondary. Disabled by default; the real
 * fetcher fails closed when off or unconfigured (the stubbed smoke test injects
 * its own fetcher and is unaffected by this flag).
 */

/** Google Calendar integration is OFF unless explicitly enabled. */
export const GOOGLE_CALENDAR_ENABLED = /^(1|true)$/i.test(
  process.env.GOOGLE_CALENDAR_ENABLED ?? "",
);

/** Which calendar to read. Defaults to the user's primary calendar. */
export const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID ?? "primary";

/** OAuth client secret JSON (Desktop app). Gitignored; never logged. */
export const GOOGLE_CLIENT_SECRET_PATH =
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET_PATH ??
  path.join(DATA_DIR, "google-client-secret.json");

/** Stored OAuth token (refresh token) JSON. Gitignored; never logged. */
export const GOOGLE_TOKEN_PATH =
  process.env.GOOGLE_CALENDAR_TOKEN_PATH ??
  path.join(DATA_DIR, "google-token.json");

/** The ONLY scope ever requested. Read-only — no write access, ever. */
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
];

/** Loopback redirect port used only by the one-time `google-auth` script. */
export const GOOGLE_OAUTH_REDIRECT_PORT = Number(
  process.env.GOOGLE_CALENDAR_OAUTH_PORT ?? 8799,
);

/** Cap on events fetched per Google Calendar query. */
export const GOOGLE_CALENDAR_MAX_RESULTS = 50;

/** Single source of truth for UTC ISO 8601 timestamps. */
export function nowIso(): string {
  return new Date().toISOString();
}
