/**
 * Brief prompt template (Step 8).
 *
 * Builds the single prompt string passed to `claude -p` for a Daily Brief or an
 * Evening Review. Like the chief-of-staff prompt it is intentionally compact and
 * LOCAL-ONLY: capped open tasks, a short pending-approval list (ids + types),
 * recent activity (event types + short details), and memory_index SUMMARIES
 * only — never memory file contents and never DB dumps. Claude PROPOSES only:
 * it returns a human-readable summary plus zero or more structured actions; the
 * backend, not Claude, decides what (if anything) is queued for approval.
 */

import type { BriefType } from "../schemas/brief.js";

export interface BriefContext {
  /** Capped list of open tasks (id + short title) for grounding the brief. */
  openTasks: { id: number; title: string }[];
  /** Total number of pending approvals (may exceed the listed subset). */
  pendingApprovalCount: number;
  /** Short subset of pending approvals: id + action type only. */
  pendingApprovals: { id: number; action_type: string }[];
  /** Recent activity rows (event type + short detail), newest first. */
  recentActivity: { event_type: string; detail: string | null }[];
  /** memory_index summaries only (slug + short summary). Never file contents. */
  memorySummaries: { slug: string; summary: string | null }[];
  /** Current instant (ISO 8601 UTC) for resolving relative dates. */
  nowUtc: string;
  /** Current Asia/Bangkok wall-clock time (the user's local timezone). */
  nowBangkok: string;
  /**
   * Google Calendar events (the PRIMARY schedule): today + upcoming
   * (7-day), with start (RFC 3339), short title, all-day flag, and bucket.
   */
  googleEvents: {
    start: string;
    title: string;
    allDay: boolean;
    bucket: "today" | "upcoming";
  }[];
  /** Local (secondary) events (id + start + short title). */
  events: { id: number; starts_at: string; title: string }[];
  /** Overdue + today + upcoming reminders (id + due + short title + bucket). */
  reminders: {
    id: number;
    due_at: string;
    title: string;
    bucket: "overdue" | "today" | "upcoming";
  }[];
}

const FRAMING: Record<BriefType, { heading: string; intent: string }> = {
  daily: {
    heading: "Daily Brief",
    intent:
      "Write a short, forward-looking Daily Brief that orients the user for the day ahead: highlight what is open, what likely needs attention, and any approvals waiting on them.",
  },
  evening: {
    heading: "Evening Review",
    intent:
      "Write a short Evening Review that reflects on the day: summarise the recent changes listed below, what is still open, and what to carry into tomorrow. The listed changes are the only record of the day; do not infer system health, errors, or backlog beyond them.",
  },
};

export function buildBriefPrompt(type: BriefType, ctx: BriefContext): string {
  const f = FRAMING[type];

  const tasks =
    ctx.openTasks.length > 0
      ? ctx.openTasks.map((t) => `  - #${t.id}: ${t.title}`).join("\n")
      : "  (none)";

  const approvals =
    ctx.pendingApprovals.length > 0
      ? ctx.pendingApprovals
          .map((a) => `  - #${a.id} (${a.action_type})`)
          .join("\n")
      : "  (none)";

  const activity =
    ctx.recentActivity.length > 0
      ? ctx.recentActivity
          .map((a) => `  - ${a.event_type}${a.detail ? `: ${a.detail}` : ""}`)
          .join("\n")
      : "  (none)";

  const memory =
    ctx.memorySummaries.length > 0
      ? ctx.memorySummaries
          .map((m) => `  - ${m.slug}: ${m.summary ?? "(no summary)"}`)
          .join("\n")
      : "  (none)";

  const googleEvents =
    ctx.googleEvents.length > 0
      ? ctx.googleEvents
          .map(
            (e) =>
              `  - [${e.bucket}] ${e.start}${e.allDay ? " (all-day)" : ""}: ${e.title}`,
          )
          .join("\n")
      : "  (none)";

  const events =
    ctx.events.length > 0
      ? ctx.events
          .map((e) => `  - #${e.id} ${e.starts_at}: ${e.title}`)
          .join("\n")
      : "  (none)";

  const reminders =
    ctx.reminders.length > 0
      ? ctx.reminders
          .map((r) => `  - #${r.id} [${r.bucket}] due ${r.due_at}: ${r.title}`)
          .join("\n")
      : "  (none)";

  return `You are the chief-of-staff reasoning engine for a local-first personal
agent. ${f.intent}

You PROPOSE only. You never execute anything; a human approves every action
through a separate approval queue. The brief itself is informational text.

Each proposed action MUST be an object of exactly this shape:
  { "action_type": <one allowed type below>, "payload": { ...fields for that type... } }
"action_type" is the literal string (e.g. "task.create"); the matching payload
goes in the separate "payload" object. Do not inline payload fields at the top
level and do not rename "action_type".

ALLOWED ACTION TYPES (the literal "action_type" value -> its "payload" shape):
- "task.create"      payload: { "title": string, "status"?: "open" | "done" }
- "task.update"      payload: { "id": number, "title"?: string, "status"?: "open" | "done" }  (at least one of title/status)
- "task.archive"     payload: { "id": number }
- "memory.write"     payload: { "target": "preferences" | "routines" | "projects" | "decisions", "mode": "append" | "replace", "content": string, "summary"?: string }
- "event.create"     payload: { "title": string, "starts_at": <ISO UTC>, "ends_at"?: <ISO UTC>, "location"?: string, "notes"?: string }
- "event.update"     payload: { "id": number, ...one or more of title/starts_at/ends_at/location/notes }
- "event.archive"    payload: { "id": number }
- "reminder.create"  payload: { "title": string, "due_at": <ISO UTC>, "notes"?: string }
- "reminder.update"  payload: { "id": number, ...one or more of title/due_at/notes }
- "reminder.archive" payload: { "id": number }
- "google_event.create" payload: { "title": string, "starts_at": <ISO UTC>, "ends_at": <ISO UTC>, "location"?: string, "notes"?: string }

DATE & TIME RULES: the user's local timezone is Asia/Bangkok (UTC+7). Interpret
relative/local times in Asia/Bangkok but OUTPUT every datetime as ISO 8601 UTC
ending in "Z". If a date/time is ambiguous, do not propose that action.
CURRENT TIME: ${ctx.nowUtc} (Asia/Bangkok: ${ctx.nowBangkok}).

LOCAL CONTEXT (read-only; this is all you have — do not assume anything else):

OPEN TASKS (for resolving task ids; do not invent ids):
${tasks}

GOOGLE CALENDAR (the user's PRIMARY schedule; today + next 7 days; read this
context for awareness. Only propose "google_event.create" if the brief context
clearly requires adding a missing future event; there are no Google update/delete
action types):
${googleEvents}

LOCAL EVENTS (secondary/local-only; today + next 7 days; do not invent ids):
${events}

REMINDERS (overdue / today / upcoming; do not invent ids):
${reminders}

PENDING APPROVALS (${ctx.pendingApprovalCount} total, ids + types only):
${approvals}

RECENT CHANGES (genuine state changes only, newest first; NOT a system-health or error report):
${activity}

MEMORY SUMMARIES (slug + short summary only; full contents are NOT available):
${memory}

OUTPUT CONTRACT (must follow exactly):
- Output a SINGLE JSON object and nothing else.
- No prose, no explanation, no markdown, no code fences.
- Shape: { "summary": string, "actions": Action[], "notes"?: string }
- "summary" is the human-readable ${f.heading} (plain text, concise).
- "actions" may contain at most 5 items and may be empty. Only propose an action
  if it clearly follows from the context above. If nothing should change, return
  "actions": [].
- Only use the allowed action types and payload shapes above. Do not invent
  fields, action types, or memory targets.`;
}
