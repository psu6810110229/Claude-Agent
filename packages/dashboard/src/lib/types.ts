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
  | "fact.forget"
  | "gmail.draft"
  | "gmail.send"
  | "line_followup.create"
  | "active_topic.create";

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
  description: string | null;
  htmlLink: string | null;
  source: "google";
}

/** GET /api/calendar/* — `available` is false when disabled or on fetch error. */
export interface GoogleEventListResponse {
  events: GoogleEvent[];
  available: boolean;
}

/** Schedule-health finding (Tier 1). Mirrors backend scheduleHealth.ts. */
export type ScheduleFindingKind =
  | "overlap"
  | "tight_travel"
  | "no_buffer"
  | "long_streak"
  | "overloaded_day"
  | "after_hours"
  | "weekend"
  | "protected_day";

export type ScheduleSeverity = "high" | "medium" | "low";

export interface ScheduleFinding {
  kind: ScheduleFindingKind;
  severity: ScheduleSeverity;
  startUtc: string;
  endUtc: string;
  eventIds: string[];
  titles: string[];
  detail: string;
}

/** GET /api/calendar/health — fail-closed (`available:false`) on fetch error. */
export interface ScheduleHealthResponse {
  findings: ScheduleFinding[];
  available: boolean;
}

/** A `google_event.update` payload (Tier 2 reschedule proposal). */
export interface UpdateGoogleEventPayload {
  id: string;
  title?: string;
  starts_at?: string;
  ends_at?: string;
  location?: string;
  notes?: string;
}

/**
 * One AI-proposed schedule fix (Tier 2), AFTER it has been queued as a pending
 * approval. The user approves/rejects `approvalId` through the normal queue.
 */
export interface ScheduleFixProposal {
  approvalId: number;
  actionType: "google_event.update";
  payload: UpdateGoogleEventPayload;
  reason: string;
  /** Kind of the Tier 1 finding this fix addresses, when the model linked one. */
  findingKind: ScheduleFindingKind | string | null;
  /** Current title of the targeted event (display-only). */
  eventTitle: string | null;
}

/**
 * POST /api/calendar/fix-proposals — proposal-only, approval-gated. `available`
 * mirrors the calendar fetch (fail-closed). Empty `proposals` + a `notes` line
 * means the calendar was readable but nothing could be safely proposed.
 */
export interface ScheduleFixResponse {
  available: boolean;
  proposals: ScheduleFixProposal[];
  notes?: string;
}

/**
 * A create-time scheduling clash for a pending `google_event.create` (recomputed
 * on each /api/approvals read). `withTitle` is the EXISTING event it clashes with.
 */
export interface ApprovalConflict {
  kind: "overlap" | "tight_travel" | "no_buffer";
  severity: "high" | "medium" | "low";
  withTitle: string;
  detail: string;
  startUtc: string;
  endUtc: string;
}

/** GET /api/approvals — approvals plus per-id create-time conflict warnings. */
export interface ApprovalsResponse {
  approvals: Approval[];
  conflicts: Record<number, ApprovalConflict[]>;
}

/** Deterministic schedule-health thresholds (GET/PUT /api/settings/schedule). */
export interface SchedulePrefs {
  workStartHour: number;
  workEndHour: number;
  minBufferMin: number;
  travelBufferMin: number;
  streakHours: number;
  overloadDayMin: number;
  /** Bangkok weekdays (0=Sun..6=Sat) kept clear. */
  protectedDays: number[];
}

// --- Gmail (Step 17) -------------------------------------------------------

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  unread: boolean;
}

/** GET /api/gmail/unread — `available` is false when disabled or on fetch error. */
export interface GmailListResponse {
  messages: GmailMessage[];
  available: boolean;
}

// --- Google Drive (Step 19) -----------------------------------------------

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  thumbnailLink?: string;
  iconLink?: string;
  parents?: string[];
  modifiedTime?: string;
  owners?: { displayName: string }[];
  size?: string;
}

/** GET /api/drive/files — `available` is false when disabled or on fetch error. */
export interface DriveListResponse {
  files: DriveFile[];
  available: boolean;
}

/** GET /api/drive/files/:id/content */
export interface DriveContentResponse {
  id: string;
  name: string;
  content: string | null;
  truncated: boolean;
  available: boolean;
  message?: string;
}

/** POST /api/drive/upload */
export interface DriveUploadBody {
  name: string;
  mimeType: string;
  contentBase64: string;
  folderId?: string;
}

export interface DriveUploadResponse {
  id?: string;
  name?: string;
  webViewLink?: string | null;
  available: boolean;
  message?: string;
}

// --- Schedule Import (local timetable) ------------------------------------

/** A local weekly class block (never a Google event). HH:MM Bangkok local. */
export interface ClassBlock {
  id: number;
  subject: string;
  weekday: number; // 0=Sun..6=Sat
  start_local: string; // "HH:MM"
  end_local: string; // "HH:MM"
  location: string | null;
  active_from: string | null; // "YYYY-MM-DD"
  active_until: string | null;
  status: string;
  source: string;
  created_at: string;
  updated_at: string;
}

/** A staging session created from a parsed timetable upload. */
export interface ScheduleImport {
  id: number;
  status: string; // pending | approved | discarded
  source_kind: string; // image | pdf
  term_from: string | null;
  term_until: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** One candidate class awaiting review. Null fields must be filled before approve. */
export interface ScheduleImportItem {
  id: number;
  import_id: number;
  subject: string;
  weekday: number | null;
  start_local: string | null;
  end_local: string | null;
  location: string | null;
  selected: number; // 0 | 1
  status: string; // candidate | approved | rejected
  created_at: string;
  updated_at: string;
}

/** POST /api/uploads response. */
export interface UploadResult {
  id: string;
  kind: "image" | "pdf";
  mime: string;
}

/** POST /api/schedule-imports response. */
export interface ScheduleImportResult {
  import: ScheduleImport;
  items: ScheduleImportItem[];
}

/** A composer attachment staged before send (chat doc by default). */
export interface StagedAttachment {
  /** Opaque upload id from POST /api/uploads. */
  id: string;
  /** Original filename, for the chip label. */
  name: string;
  kind: "image" | "pdf";
}

/** POST /api/schedule-imports/:id/approve response. */
export interface ApproveImportResult {
  created: ClassBlock[];
  skipped: ScheduleImportItem[];
  rejected: number;
}

/** A staged bulk Google Calendar add awaiting review (from a chat turn). */
export interface CalendarPlan {
  id: number;
  status: string; // pending | approved | discarded
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** One proposed Google event in a plan. starts_at/ends_at are UTC ISO strings. */
export interface CalendarPlanItem {
  id: number;
  plan_id: number;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  notes: string | null;
  selected: number; // 0 | 1
  override_conflict: number; // 0 | 1
  conflict_with: string | null;
  conflict_detail: string | null;
  category: string; // clean | duplicate | overlap
  conflict_starts_at: string | null; // existing clashing event's time (UTC ISO)
  conflict_ends_at: string | null;
  status: string; // ready | conflict | created | rejected | skipped
  created_at: string;
  updated_at: string;
}

/** GET/chat-embedded calendar plan payload. */
export interface CalendarPlanResult {
  plan: CalendarPlan;
  items: CalendarPlanItem[];
}

/** POST /api/calendar-plans/:id/approve response. */
export interface ApproveCalendarPlanResult {
  created: { id: number; title: string }[];
  skippedConflict: { id: number; title: string; conflict_with: string | null }[];
  rejected: number;
  failed: { id: number; title: string; error: string }[];
}

/** One open window from GET /api/free-slots. */
export interface FreeSlot {
  startUtc: string;
  endUtc: string;
  minutes: number;
}

export interface FreeSlotsResult {
  date: string | null;
  slots: FreeSlot[];
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

export type NotificationKind =
  | "reminder.due"
  | "event.soon"
  | "line.followup"
  | "line.active_topic";
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
  source_previews_json: string | null;
  status: ChatMessageStatus;
  created_at: string;
  updated_at: string;
}

export type ActiveJobStatus =
  | "queued"
  | "understanding"
  | "searching"
  | "verifying"
  | "needs_user"
  | "reporting"
  | "done"
  | "failed"
  | "cancelled";

export interface ActiveJobProgressEvent {
  id: number;
  event_type:
    | "created"
    | "progress"
    | "evidence"
    | "status"
    | "clarification"
    | "result"
    | "error";
  status: ActiveJobStatus;
  message: string;
  created_at: string;
  metadata: unknown | null;
}

export interface ActiveJobProgress {
  job_id: number;
  kind: string;
  title: string;
  status: ActiveJobStatus;
  source: string | null;
  source_ref: string | null;
  result_summary: string | null;
  error: string | null;
  clarification: string | null;
  evidence: unknown | null;
  updated_at: string;
  milestones: ActiveJobProgressEvent[];
}

/**
 * POST /api/chat success shape (201). `reply` is the conversational response;
 * `approvals` are any pending write proposals queued by this turn (may be
 * empty). Failures arrive as 4xx/5xx via ApiError.
 */
/** Manual AI provider choice carried per chat request (Roadmap 11 Phase 2). */
export type AiProviderId = "claude" | "gemini" | "qwen" | "glm" | "gpt4o";

/** Provider routing mode (Roadmap 11 Phase 4). */
export type AiProviderMode = "manual" | "auto";

/**
 * What the user picks in the UI: a specific provider (manual) or `"auto"`
 * (backend routes transparently). Maps to either `{ provider }` or
 * `{ mode: "auto" }` on the wire.
 */
export type ProviderChoice = AiProviderId | "auto";

/**
 * Selectable Gemini models (mirrors backend GEMINI_MODELS default; the backend
 * is the source of truth and validates the id, so an extra/stale entry here
 * just fails closed rather than running a wrong model). `id` is the API model
 * string; `label` is the short UI name.
 */
export const GEMINI_MODEL_OPTIONS: { id: string; label: string }[] = [
  { id: "gemini-3.1-flash-lite", label: "3.1 Flash Lite" },
  { id: "gemini-2.5-flash-lite", label: "2.5 Flash Lite" },
  { id: "gemini-3-flash", label: "3 Flash" },
  { id: "gemini-3.5-flash", label: "3.5 Flash" },
];

/** Default Gemini model (fastest, matches backend default). */
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

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
  /** Gmail/Drive evidence previews read by the backend for this turn. */
  sourcePreviews?: ChatSourcePreview[];
  /** Recent durable job milestones, sanitized for compact chat-native display. */
  jobProgress?: ActiveJobProgress[];
  /** Staged bulk Google Calendar add for review; null on ordinary turns. */
  calendarPlan?: CalendarPlanResult | null;
  clarification?: string;
  clarification_choices?: string[];
  notes?: string;
  /** Step 15: true when guard on, unverified requester asked for private data. */
  verificationRequired?: boolean;
  /** Step 15: challenge question to show in the verify panel. */

  /** Step 15: UX signal — "private" if user probed owner's private specifics. */
  sensitivity?: "private" | "normal";
}

export type ChatSourcePreview =
  | {
      kind: "gmail";
      query: string;
      status: "found" | "empty";
      items: {
        id: string;
        from: string;
        subject: string;
        receivedAt: string;
        preview: string;
        truncated: boolean;
      }[];
    }
  | {
      kind: "drive";
      query: string;
      status: "found" | "empty";
      totalItems?: number;
      items: {
        id: string;
        name: string;
        mimeType: string;
        webViewLink: string | null;
        thumbnailLink: string | null;
        iconLink: string | null;
        folderId: string | null;
        folderName: string | null;
        folderLink: string | null;
        previewKind: "image" | "pdf" | "folder" | "text" | "file";
        preview: string | null;
        childNames: string[] | null;
        truncated: boolean;
        readable: boolean;
      }[];
    };

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
