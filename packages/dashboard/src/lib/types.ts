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
  | "reminder.done"
  | "reminder.archive"
  | "google_event.create"
  | "google_event.update"
  | "google_event.delete"
  | "fact.remember"
  | "fact.update"
  | "fact.forget";

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

// --- Google Calendar (Step 10, PRIMARY schedule) --------------------------

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

export type ReminderStatus = "active" | "done" | "archived";

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

// --- Memory facts (Step 16, real memory) ---------------------------------

export type FactCategory =
  | "identity"
  | "preference"
  | "relationship"
  | "routine"
  | "project"
  | "general";

export interface MemoryFact {
  id: number;
  content: string;
  keywords: string;
  category: FactCategory;
  pinned: boolean;
  source: string;
  created_at: string;
  updated_at: string;
}

/** POST /api/facts/proposals body for a manual "teach a fact". */
export interface CreateFactProposalBody {
  content: string;
  keywords?: string;
  category?: FactCategory;
  pinned?: boolean;
}

/** POST /api/memory/proposals body. */
export interface CreateMemoryProposalBody {
  target: MemoryTarget;
  mode: MemoryWriteMode;
  content: string;
  summary?: string;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ExecutionStatus = "not_started" | "succeeded" | "failed";

export interface Approval {
  id: number;
  action_type: ActionType;
  payload: unknown;
  status: ApprovalStatus;
  execution_status: ExecutionStatus;
  executed_at: string | null;
  execution_error: string | null;
  result_summary: string | null;
  /** Prior-state JSON snapshot for reversible undo (Step 14); null otherwise. */
  undo_json: string | null;
  created_at: string;
  updated_at: string;
}

export type ActivityEventType =
  | "chat.message.received"
  | "chat.message.replied"
  | "chat.message.proposed"
  | "chat.message.failed"
  | "chat.message.rejected"
  | "chat.session.reset"
  | "command.received"
  | "command.proposed"
  | "command.rejected"
  | "ai.command.received"
  | "ai.command.proposed"
  | "ai.command.failed"
  | "ai.command.rejected"
  | "ai.command.clarification"
  | "brief.daily.requested"
  | "brief.daily.generated"
  | "brief.daily.proposed"
  | "brief.daily.failed"
  | "brief.daily.rejected"
  | "brief.evening.requested"
  | "brief.evening.generated"
  | "brief.evening.proposed"
  | "brief.evening.failed"
  | "brief.evening.rejected"
  | "approval.approve"
  | "approval.create"
  | "approval.reject"
  | "approval.execute_succeeded"
  | "approval.execute_failed"
  | "notification.fired"
  | "notification.desktop_failed"
  | "scheduler.tick_error"
  | "task.create"
  | "task.update"
  | "task.archive"
  | "event.create"
  | "event.update"
  | "event.archive"
  | "reminder.create"
  | "reminder.update"
  | "reminder.done"
  | "reminder.archive"
  | "memory.write"
  | "google_event.create";

export interface Activity {
  id: number;
  event_type: ActivityEventType | string;
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
 * - `clarification` — AI mode needs one follow-up answer before queueing.
 * - `none`     — AI mode produced valid output but no actionable proposals.
 */
export type CommandResult =
  | { kind: "help"; examples: string[] }
  | { kind: "proposal"; approval?: Approval; approvals?: Approval[]; notes?: string }
  | {
      kind: "clarification";
      message: string;
      question: string;
      notes?: string;
    }
  | { kind: "none"; message: string; notes?: string };

// --- Notifications (Step 11) ---------------------------------------------

export type NotificationKind = "reminder.due" | "event.soon";
export type NotificationStatus = "unread" | "read";

export interface Notification {
  id: number;
  kind: NotificationKind;
  source_id: number;
  title: string;
  body: string | null;
  fire_at: string;
  status: NotificationStatus;
  created_at: string;
  updated_at: string;
}

// --- Chat (Step 12) -------------------------------------------------------

export type ChatRole = "user" | "assistant";
export type ChatMessageStatus = "active" | "archived";

export interface ChatMessage {
  id: number;
  role: ChatRole;
  content: string;
  actions_json: string | null;
  status: ChatMessageStatus;
  created_at: string;
  updated_at: string;
}

/**
 * POST /api/chat success shape (201). `reply` is the conversational response;
 * `approvals` are any pending write proposals queued by this turn (may be
 * empty). Failures arrive as 4xx/5xx via ApiError.
 */
/** Manual AI provider choice carried per chat request (Roadmap 11 Phase 2). */
export type AiProviderId = "claude" | "gemini";

/** Provider routing mode (Roadmap 11 Phase 4). */
export type AiProviderMode = "manual" | "auto";

/**
 * What the user picks in the UI: a specific provider (manual) or `"auto"`
 * (backend routes transparently). Maps to either `{ provider }` or
 * `{ mode: "auto" }` on the wire.
 */
export type ProviderChoice = AiProviderId | "auto";

export interface ChatResult {
  kind: "chat";
  reply: string;
  /** Short spoken summary of `reply` for TTS; null when the model omitted it. */
  spoken?: string | null;
  /** Truthful outcome line posted AFTER the ack reply; null for pure Q&A. */
  resultReport?: string | null;
  /** Short spoken form of resultReport for sequential TTS; null when none. */
  resultSpoken?: string | null;
  /** Routing mode the backend applied. */
  mode: AiProviderMode;
  /** Provider that actually produced this reply. */
  provider: AiProviderId;
  /** Model the selected provider used, when known. */
  selectedModel?: string | null;
  /** Provider the user explicitly requested, or null when defaulted/auto. */
  requestedProvider: AiProviderId | null;
  providerReason?: string;
  approvals: Approval[];
  clarification?: string;
  clarification_choices?: string[];
  notes?: string;
  /** Step 15: true when guard on, unverified requester asked for private data. */
  verificationRequired?: boolean;
  /** Step 15: challenge question to show in the verify panel. */

  /** Step 15: UX signal — "private" if user probed owner's private specifics. */
  sensitivity?: "private" | "normal";
}

/** Step 15 — POST /api/chat/verify response. */
export type VerifyResult =
  | { kind: "verified" }
  | { kind: "denied"; reason: string; error: string }
  | { kind: "disabled" };

/**
 * POST /api/chat/followup result. The backend stays QUIET (`silent`) unless it
 * has a useful proactive nudge; on `followup` the assistant message is already
 * persisted, so the dashboard just refetches history + plays the spoken form.
 */
export type FollowupResult =
  | { kind: "silent" }
  | {
      kind: "followup";
      reply: string;
      spoken?: string | null;
      approvals: Approval[];
    };

// --- Settings -------------------------------------------------------------

export interface Setting {
  key: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  description: string;
}

export interface SettingsResponse {
  settings: Setting[];
}

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
