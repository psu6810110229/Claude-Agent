import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Minimal .env loader (zero-dep). Reads simple KEY=VALUE lines from a local,
 * gitignored `.env` so runtime flags + secrets (e.g. GEMINI_ENABLED,
 * GEMINI_API_KEY) persist across restarts without exporting them every shell.
 * An already-set process.env value ALWAYS wins, so an inline env var still
 * overrides the file. Secrets are never logged. Loaded before any export reads
 * process.env below.
 */
function loadEnvFile(file: string): void {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return; // No file — nothing to load.
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (key in process.env) continue; // real env wins
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// Repo root first, then the backend package; existing process.env still wins.
loadEnvFile(path.resolve(__dirname, "..", "..", "..", ".env"));
loadEnvFile(path.resolve(__dirname, "..", ".env"));

/** Backend binds to localhost only (safety: no external exposure). */
export const HOST = "127.0.0.1";

/** Default port, overridable via env. */
export const PORT = Number(process.env.CLAUDE_AGENT_PORT ?? 8787);

/** packages/backend/data (src/ -> ../data) */
export const DATA_DIR = path.resolve(__dirname, "..", "data");

/**
 * SQLite database file path. Overridable via env so smoke tests can target a
 * throwaway temp file instead of the real data/claude_agent.db.
 */
export const DB_PATH =
  process.env.CLAUDE_AGENT_DB_PATH ?? path.join(DATA_DIR, "claude_agent.db");

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
  process.env.CLAUDE_AGENT_CLAUDE_MODEL ?? "claude-haiku-4-5-20251001";

/** Hard timeout for a single command-mode `claude -p` invocation (ms). */
export const CLAUDE_TIMEOUT_MS = Number(
  process.env.CLAUDE_AGENT_CLAUDE_TIMEOUT_MS ?? 60_000,
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
export const CLAUDE_MAX_ACTIONS = 10;

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

/**
 * Chat recall uses a WIDER Google Calendar window than the 7-day agenda so the
 * model can see (and therefore target by real id) semester-scale events months
 * out. Without this, update/delete proposals for far-future events have no real
 * id in context and the model is tempted to fabricate one. Capped to bound the
 * prompt size.
 */
export const CHAT_GOOGLE_WINDOW_DAYS = Number(
  process.env.CLAUDE_AGENT_CHAT_GOOGLE_WINDOW_DAYS ?? 120,
);
export const CHAT_GOOGLE_EVENT_CAP = Number(
  process.env.CLAUDE_AGENT_CHAT_GOOGLE_EVENT_CAP ?? 50,
);

/** Cap on reminders included in a brief's compact context. */
export const BRIEF_REMINDER_CAP = 20;

/**
 * Step 10+ - Google Calendar connector.
 *
 * Google Calendar is the PRIMARY schedule source; local events/reminders
 * (Step 9) remain secondary. Reads are available through dashboard/brief routes.
 * Writes are approval-gated via `google_event.create|update|delete` (Step 14);
 * delete is additionally always confirm-gated and never auto-executed. Disabled
 * by default; real Google calls fail closed when off or unconfigured.
 */

/** Google Calendar integration is OFF unless explicitly enabled. */
export const GOOGLE_CALENDAR_ENABLED = /^(1|true)$/i.test(
  process.env.GOOGLE_CALENDAR_ENABLED ?? "",
);

/** Which calendar to read/write. Defaults to the user's primary calendar. */
export const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID ?? "primary";

/** OAuth client secret JSON (Desktop app). Gitignored; never logged. */
export const GOOGLE_CLIENT_SECRET_PATH =
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET_PATH ??
  path.join(DATA_DIR, "google-client-secret.json");

/** Stored OAuth token (refresh token) JSON. Gitignored; never logged. */
export const GOOGLE_TOKEN_PATH =
  process.env.GOOGLE_CALENDAR_TOKEN_PATH ??
  path.join(DATA_DIR, "google-token.json");

/** Narrow event scope: view/edit events only, not calendar sharing/settings. */
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
];

/** Loopback redirect port used only by the one-time `google-auth` script. */
export const GOOGLE_OAUTH_REDIRECT_PORT = Number(
  process.env.GOOGLE_CALENDAR_OAUTH_PORT ?? 8799,
);

/** Cap on events fetched per Google Calendar query. */
export const GOOGLE_CALENDAR_MAX_RESULTS = 50;

/**
 * Step 11 — Background scheduler (reminder/event firing + notifications).
 *
 * Scheduler is OFF unless explicitly enabled. When on, it ticks on a fixed
 * interval, detects newly-due reminders and soon-starting events, writes
 * dedup'd notification rows to the DB, logs activity, and optionally fires a
 * Windows desktop toast. No Claude, no approval queue, no calendar writes.
 */

/** Background scheduler is OFF unless explicitly enabled. */
export const SCHEDULER_ENABLED = /^(1|true)$/i.test(
  process.env.CLAUDE_AGENT_SCHEDULER_ENABLED ?? "",
);

/** How often the scheduler ticks (ms). Overridable for tests/speed. */
export const SCHEDULER_INTERVAL_MS = Number(
  process.env.CLAUDE_AGENT_SCHEDULER_INTERVAL_MS ?? 60_000,
);

/**
 * How far ahead to look for events "starting soon" (ms). Events whose
 * `starts_at` is within [now, now + lead) trigger a notification.
 * Default: 15 minutes.
 */
export const SCHEDULER_EVENT_LEAD_MS = Number(
  process.env.CLAUDE_AGENT_SCHEDULER_EVENT_LEAD_MS ?? 15 * 60_000,
);

/** Desktop OS toast notifications are OFF unless explicitly enabled. */
export const DESKTOP_NOTIFICATIONS_ENABLED = /^(1|true)$/i.test(
  process.env.CLAUDE_AGENT_DESKTOP_NOTIFICATIONS_ENABLED ?? "",
);

/**
 * Roadmap 11 Phase 3 — Gemini provider.
 *
 * Gemini is OFF unless both GEMINI_ENABLED=1 and GEMINI_API_KEY are set.
 * Missing either disables Gemini cleanly; the backend never logs the key.
 */

/** Gemini integration is OFF unless explicitly enabled. */
export const GEMINI_ENABLED = /^(1|true)$/i.test(
  process.env.GEMINI_ENABLED ?? "",
);

/** Gemini API key. Gitignored; never logged. Empty string = not configured. */
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";

/** Gemini model to use for proposal calls (the default when none requested). */
export const GEMINI_MODEL =
  process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";

/**
 * Allowlist of selectable Gemini models. The UI may request any id in this set
 * per chat turn; anything else is rejected (fail closed — never silently swaps
 * to a different model). Override the whole list via the GEMINI_MODELS env
 * (comma-separated) without touching code. The default model above is always
 * included so a valid baseline exists even if the env omits it.
 */
export const GEMINI_MODELS: readonly string[] = (() => {
  const fromEnv = (process.env.GEMINI_MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const base = fromEnv.length > 0
    ? fromEnv
    : [
        "gemini-3.1-flash-lite",
        "gemini-2.5-flash-lite",
        "gemini-3-flash",
        "gemini-3.5-flash",
      ];
  return base.includes(GEMINI_MODEL) ? base : [GEMINI_MODEL, ...base];
})();

/** True when `model` is a selectable Gemini model. */
export function isAllowedGeminiModel(model: string): boolean {
  return GEMINI_MODELS.includes(model);
}

/** Hard timeout for a single Gemini API call (ms). */
export const GEMINI_TIMEOUT_MS = Number(
  process.env.GEMINI_TIMEOUT_MS ?? 60_000,
);

/**
 * Step 12 — Conversational chat agent.
 *
 * Number of recent chat messages fed back into the prompt as conversation
 * history. Older messages are excluded to keep the context compact.
 */
export const CHAT_HISTORY_LIMIT = Number(
  process.env.CLAUDE_AGENT_CHAT_HISTORY_LIMIT ?? 20,
);

/**
 * Step 13 — Voice output (TTS). All flags off by default; fail-soft to text.
 * Real Edge endpoint is cloud (outbound to Microsoft only, no API key).
 */

/** TTS synthesis is OFF unless explicitly enabled. */
export const TTS_ENABLED = /^(1|true)$/i.test(
  process.env.CLAUDE_AGENT_TTS_ENABLED ?? "",
);

/** Default TTS preset. Validated to TtsPreset in tts.ts. */
export const TTS_PRESET = process.env.CLAUDE_AGENT_TTS_PRESET ?? "warm";

/** Backend speaker playback is OFF unless explicitly enabled. */
export const TTS_SPEAKER_ENABLED = /^(1|true)$/i.test(
  process.env.CLAUDE_AGENT_TTS_SPEAKER_ENABLED ?? "",
);

/** How long a pending approval must be unactioned before the first nag (ms). */
export const TTS_APPROVAL_NAG_DELAY_MS = Number(
  process.env.CLAUDE_AGENT_TTS_APPROVAL_NAG_DELAY_MS ?? 120_000,
);

/** Minimum gap between repeated nag announcements for the same pending set (ms). */
export const TTS_APPROVAL_NAG_INTERVAL_MS = Number(
  process.env.CLAUDE_AGENT_TTS_APPROVAL_NAG_INTERVAL_MS ?? 120_000,
);

/**
 * Step 14 — Auto-execute engine.
 *
 * When ON, proposed actions that are reversible/non-destructive are executed
 * immediately (no manual approve click) and the REAL executor outcome is
 * reported. Destructive actions (Google delete, *.archive, memory replace) are
 * NEVER auto-executed — they stay pending and require an explicit confirm.
 * OFF by default: every action stays pending exactly as before.
 */
export const AUTO_EXECUTE_ENABLED = /^(1|true)$/i.test(
  process.env.CLAUDE_AGENT_AUTO_EXECUTE_ENABLED ?? "",
);

/**
 * Step 14 follow-up — allow RECOVERABLE destructive actions (currently only
 * `google_event.delete`, which snapshots the prior event into `undo_json`) to
 * auto-execute without a confirm click. OFF by default so destructive auto-exec
 * stays opt-in even when AUTO_EXECUTE is on. Archive + memory-replace remain
 * confirm-gated regardless of this flag.
 */
export const AUTO_EXECUTE_DESTRUCTIVE_ENABLED = /^(1|true)$/i.test(
  process.env.CLAUDE_AGENT_AUTO_EXECUTE_DESTRUCTIVE_ENABLED ?? "",
);

/**
 * Step 15 — Privacy guard & owner identity verification.
 *
 * When ON, an UNVERIFIED chat requester only receives coarse free/busy context
 * (private memory/schedule detail is redacted before the prompt is built) and is
 * offered an identity check. Verification needs BOTH the PIN and the challenge
 * answer. Secrets are read here, compared only in identityVerifier, and NEVER
 * logged or placed in any prompt. OFF by default: behavior identical to today.
 */
export const PRIVACY_GUARD_ENABLED = /^(1|true)$/i.test(
  process.env.CLAUDE_AGENT_PRIVACY_GUARD_ENABLED ?? "",
);

/** Owner PIN (secret). Empty string = not configured -> guard cannot be unlocked. */
export const OWNER_PIN = process.env.CLAUDE_AGENT_OWNER_PIN ?? "";

/** Secret Phrase. Checked case-insensitively and space-trimmed. Empty string = not configured. */
export const OWNER_SECRET_PHRASE =
  process.env.CLAUDE_AGENT_OWNER_SECRET_PHRASE ?? "โอเค";

/** Max failed verify attempts per session before a temporary lockout. */
export const PRIVACY_VERIFY_MAX_ATTEMPTS = Number(
  process.env.CLAUDE_AGENT_PRIVACY_VERIFY_MAX_ATTEMPTS ?? 5,
);

/** Lockout duration after too many failed attempts (ms). Default 5 min. */
export const PRIVACY_VERIFY_LOCKOUT_MS = Number(
  process.env.CLAUDE_AGENT_PRIVACY_VERIFY_LOCKOUT_MS ?? 5 * 60_000,
);

/**
 * Idle timeout (ms). If the session has no activity for this duration, it
 * auto-locks. Default 120 s — long enough that a verified owner is not
 * re-prompted after a short pause (the old 30 s default made the guard feel
 * like it "forgot" the code). Override via env for stricter envs.
 */
export const PRIVACY_VERIFY_IDLE_TIMEOUT_MS = Number(
  process.env.CLAUDE_AGENT_PRIVACY_VERIFY_IDLE_TIMEOUT_MS ?? 120_000,
);

/** True only when the guard is on AND at least one secret (PIN or phrase) is present. */
export const PRIVACY_GUARD_CONFIGURED =
  PRIVACY_GUARD_ENABLED && (OWNER_PIN.length > 0 || OWNER_SECRET_PHRASE.length > 0);

/**
 * Step 17 — Gmail connector.
 *
 * Uses the same OAuth client secret + token file as Google Calendar. Requires
 * gmail.readonly + gmail.compose scopes — re-run `npm run google-auth` after
 * enabling to get a fresh token with the expanded scopes. Disabled by default.
 */

/** Gmail connector is OFF unless explicitly enabled. */
export const GMAIL_ENABLED = /^(1|true)$/i.test(process.env.GMAIL_ENABLED ?? "");

/** Cap on messages fetched per Gmail query. */
export const GMAIL_MAX_RESULTS = Number(process.env.GMAIL_MAX_RESULTS ?? 20);

/** Gmail OAuth scopes. Combined with Calendar scopes in google-auth. */
export const GOOGLE_GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

/**
 * Step 18 — Google Contacts connector.
 *
 * Uses the same OAuth client secret + token file as Calendar and Gmail.
 * Requires contacts.readonly scope — re-run `npm run google-auth` after
 * enabling to get a token with the expanded scope. Disabled by default.
 */

/** Google Contacts connector is OFF unless explicitly enabled. */
export const GOOGLE_CONTACTS_ENABLED = /^(1|true)$/i.test(
  process.env.GOOGLE_CONTACTS_ENABLED ?? "",
);

/** Cap on contacts fetched (People API max page is 1000). */
export const GOOGLE_CONTACTS_MAX_RESULTS = Number(
  process.env.GOOGLE_CONTACTS_MAX_RESULTS ?? 200,
);

/** Contacts OAuth scope. */
export const GOOGLE_CONTACTS_SCOPES = [
  "https://www.googleapis.com/auth/contacts.readonly",
];

/**
 * Step 19 — Google Drive connector.
 *
 * Uses the same OAuth client + credential files as Calendar, Gmail, Contacts.
 * Requires drive.readonly (search + read) and drive.file (upload) scopes.
 * Re-run `npm run google-auth` after enabling. Disabled by default.
 */

/** Google Drive connector is OFF unless explicitly enabled. */
export const GOOGLE_DRIVE_ENABLED = /^(1|true)$/i.test(
  process.env.GOOGLE_DRIVE_ENABLED ?? "",
);

/** Max files returned per search query. */
export const GOOGLE_DRIVE_MAX_RESULTS = Number(
  process.env.GOOGLE_DRIVE_MAX_RESULTS ?? 30,
);

/** Max characters read from a single file's content before truncation. */
export const GOOGLE_DRIVE_CONTENT_MAX_CHARS = Number(
  process.env.GOOGLE_DRIVE_CONTENT_MAX_CHARS ?? 30_000,
);

/** Drive OAuth scopes: read all files + create/upload files this app manages. */
export const GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

/** All Google OAuth scopes requested in a single consent flow. */
export const GOOGLE_ALL_SCOPES = [
  ...GOOGLE_CALENDAR_SCOPES,
  ...GOOGLE_GMAIL_SCOPES,
  ...GOOGLE_CONTACTS_SCOPES,
  ...GOOGLE_DRIVE_SCOPES,
];

/**
 * Step 20 — LINE connector (READ-ONLY, local export ingest).
 *
 * The LINE Windows desktop app stores chat history in an ENCRYPTED + locked
 * SQLite `.edb` file that better-sqlite3 cannot open, so reading the live DB is
 * impossible. Instead this connector ingests LINE's manual chat-export `.txt`
 * files dropped into a local folder. Read-only: NO write action types exist for
 * LINE. Disabled by default; fails closed (disabled / missing dir / parse error
 * → empty + available:false). Message text is NEVER logged.
 */

/** LINE connector is OFF unless explicitly enabled. DB config overrides env. */
export const LINE_ENABLED = /^(1|true)$/i.test(process.env.LINE_ENABLED ?? "");

/** Folder holding LINE chat-export .txt files. Gitignored (under data/). */
export const LINE_EXPORT_DIR =
  process.env.LINE_EXPORT_DIR ?? path.join(DATA_DIR, "line-exports");

/** Max messages returned per LINE query. */
export const LINE_MAX_RESULTS = Number(process.env.LINE_MAX_RESULTS ?? 50);

/** Recent LINE messages (across all chats) injected into chat recall context. */
export const LINE_CHAT_CONTEXT_CAP = Number(
  process.env.LINE_CHAT_CONTEXT_CAP ?? 8,
);

/** Recent messages included PER chat in chat recall context (Part 1). */
export const LINE_CONTEXT_PER_CHAT = Number(
  process.env.LINE_CONTEXT_PER_CHAT ?? 6,
);

/**
 * Max messages loaded for a FOCUSED chat (when the user asks about one specific
 * LINE chat/group by name or alias). Lets Jarvis summarise that chat's content
 * even when it is not among the most-active chats shown in the recent window.
 */
export const LINE_FOCUSED_MSG_CAP = Number(
  process.env.LINE_FOCUSED_MSG_CAP ?? 20,
);

/** Max chats (most-recently-active first) surfaced with recent messages. */
export const LINE_CONTEXT_MAX_CHATS = Number(
  process.env.LINE_CONTEXT_MAX_CHATS ?? 6,
);

/**
 * Max keyword-matched LINE messages injected into chat recall context. Read-only
 * retrieval over the ingested exports. Clamped to [0, 50]; invalid/NaN → 12.
 */
export const LINE_SEARCH_CAP = (() => {
  const raw = Number(process.env.LINE_SEARCH_CAP ?? 12);
  if (!Number.isFinite(raw)) return 12;
  return Math.max(0, Math.min(50, Math.trunc(raw)));
})();

/**
 * Step 21 — LINE follow-up watches (scheduled READ-ONLY export check).
 *
 * At a watch's due_at the scheduler searches the EXPORTED LINE files for the
 * saved keywords (no live LINE, no Claude) and fires one notification. These
 * caps bound how many matched snippets land in the user-facing notification
 * body. Snippets NEVER appear in activity logs (counts only there).
 */

/** Max matched snippets shown in a line.followup notification body. */
export const LINE_FOLLOWUP_SNIPPET_CAP = Number(
  process.env.LINE_FOLLOWUP_SNIPPET_CAP ?? 2,
);

/** Max characters per snippet shown in a line.followup notification body. */
export const LINE_FOLLOWUP_SNIPPET_CHARS = Number(
  process.env.LINE_FOLLOWUP_SNIPPET_CHARS ?? 80,
);

/** Cap on matched messages the follow-up search scans/considers per check. */
export const LINE_FOLLOWUP_SEARCH_CAP = Number(
  process.env.LINE_FOLLOWUP_SEARCH_CAP ?? 50,
);

/**
 * Step 16 — real memory (fact store). Facts are durable, recallable statements
 * about the user. Local-only like the memory files, so no enable flag: auto-
 * capture is governed by the existing auto-execute flag; recall is always on.
 */

/** Max characters in a single fact's content (safety cap; local single-user). */
export const FACT_CONTENT_MAX = Number(
  process.env.CLAUDE_AGENT_FACT_CONTENT_MAX ?? 500,
);

/** Max facts recalled into a prompt (pinned facts always included, then top-scored). */
export const FACT_RECALL_CAP = Number(
  process.env.CLAUDE_AGENT_FACT_RECALL_CAP ?? 20,
);

/** Single source of truth for UTC ISO 8601 timestamps. */
export function nowIso(): string {
  return new Date().toISOString();
}
