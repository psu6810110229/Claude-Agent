/**
 * Types hand-mirrored from the backend Zod schemas (packages/backend/src/schemas).
 * Kept in sync manually for now; a shared types package is a later step.
 */

export type TaskStatus = "open" | "done" | "archived";

export interface Task {
  id: number;
  title: string;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

/** PATCH /api/tasks/:id — `archived` is intentionally not settable here. */
export interface UpdateTaskBody {
  title?: string;
  status?: "open" | "done";
}

export type ActionType =
  | "task.create"
  | "task.update"
  | "task.archive"
  | "memory.write"
  | "event.create"
  | "event.update"
  | "event.archive"
  | "reminder.create"
  | "reminder.update"
  | "reminder.archive";

// --- Events & reminders (Step 9) ------------------------------------------

export type EventStatus = "scheduled" | "archived";

export interface CalendarEvent {
  id: number;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  notes: string | null;
  status: EventStatus;
  created_at: string;
  updated_at: string;
}

// --- Google Calendar (Step 10, read-only, PRIMARY schedule) ---------------

/**
 * Normalized Google Calendar event. Read-only projection mirrored from the
 * backend (schemas/googleCalendar.ts). `start`/`end` are RFC 3339 strings as
 * Google returns them: an instant for timed events, a `YYYY-MM-DD` date for
 * all-day events (`allDay` disambiguates).
 */
export interface GoogleEvent {
  id: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
  htmlLink: string | null;
  source: "google";
}

/** GET /api/calendar/* — `available` is false when disabled or on fetch error. */
export interface GoogleEventListResponse {
  events: GoogleEvent[];
  available: boolean;
}

export type ReminderStatus = "active" | "archived";

export interface Reminder {
  id: number;
  title: string;
  due_at: string;
  notes: string | null;
  status: ReminderStatus;
  created_at: string;
  updated_at: string;
}

// --- Memory ---------------------------------------------------------------

export type MemoryTarget =
  | "preferences"
  | "routines"
  | "projects"
  | "decisions";

export type MemoryWriteMode = "append" | "replace";

export interface MemoryEntry {
  id: number;
  slug: string;
  path: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryContent {
  target: MemoryTarget;
  path: string;
  exists: boolean;
  content: string;
}

/** POST /api/memory/proposals body. */
export interface CreateMemoryProposalBody {
  target: MemoryTarget;
  mode: MemoryWriteMode;
  content: string;
  summary?: string;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Approval {
  id: number;
  action_type: ActionType;
  payload: unknown;
  status: ApprovalStatus;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: number;
  event_type: string;
  detail: string | null;
  created_at: string;
}

// --- Command bar ----------------------------------------------------------

/** POST /api/command — which path the backend should take. */
export type CommandMode = "deterministic" | "ai";

/**
 * POST /api/command result (2xx shapes). Error responses arrive as 4xx/5xx and
 * are surfaced via ApiError by the client, so callers handle them in a catch
 * block rather than as a returned value.
 *
 * - `help`     — deterministic mode help listing.
 * - `proposal` — deterministic mode: exactly one queued approval (`approval`).
 *                AI mode: zero-or-more queued approvals (`approvals`). The two
 *                paths use different field names, so both are optional here and
 *                the consumer reads whichever is present.
 * - `none`     — AI mode produced valid output but no actionable proposals.
 */
export type CommandResult =
  | { kind: "help"; examples: string[] }
  | { kind: "proposal"; approval?: Approval; approvals?: Approval[] }
  | { kind: "none"; message: string };

// --- Briefs ---------------------------------------------------------------

/** Daily Brief vs Evening Review. */
export type BriefType = "daily" | "evening";

/**
 * POST /api/briefs/:type success shape (200). The `summary` is the primary
 * product; `approvals` are any pending proposals the brief queued (may be
 * empty). Briefs are stateless and proposal-only — nothing executes. Failures
 * arrive as 4xx/5xx via ApiError (503 disabled, 504 timeout, 502 failure, 400
 * invalid output), handled in a catch like the command bar.
 */
export interface BriefResult {
  kind: "brief";
  type: BriefType;
  summary: string;
  notes?: string;
  approvals: Approval[];
}
