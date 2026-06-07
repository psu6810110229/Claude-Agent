/**
 * Chat prompt template (Step 12).
 *
 * Builds the single prompt passed to `claude -p` for a conversational chat
 * turn. Based on the chief-of-staff prompt (same action allowlist, same
 * Bangkok/UTC rules, same "propose only" framing) but extended with:
 *   - Full recall context: real tasks, Google + local events, reminders, and
 *     memory_index SUMMARIES (never file contents — project safety invariant).
 *   - Conversation history (last N turns, oldest first).
 *   - Required `reply` in the output contract so every response is conversational.
 */

export interface ChatContext {
  /** The new user message for this turn. */
  message: string;
  /** Capped open tasks (id + short title). */
  openTasks: { id: number; title: string }[];
  /** memory_index summaries only — never file contents. */
  memorySummaries: { slug: string; summary: string | null }[];
  /** Current instant (ISO 8601 UTC). */
  nowUtc: string;
  /** Current Asia/Bangkok wall-clock time. */
  nowBangkok: string;
  /**
   * Google Calendar events (PRIMARY schedule): today + upcoming (7-day),
   * with start (RFC 3339), short title, all-day flag, and bucket.
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
  /** Prior conversation turns (oldest first), capped to CHAT_HISTORY_LIMIT. */
  history: { role: "user" | "assistant"; content: string }[];
}

export function buildChatPrompt(ctx: ChatContext): string {
  const tasks =
    ctx.openTasks.length > 0
      ? ctx.openTasks.map((t) => `  - #${t.id}: ${t.title}`).join("\n")
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

  const history =
    ctx.history.length > 0
      ? ctx.history
          .map((m) => `  [${m.role}]: ${m.content}`)
          .join("\n")
      : "  (none — this is the first turn)";

  return `You are the chief-of-staff reasoning engine for a local-first personal
agent. You have a natural conversation with the user, recalling their real
schedule, tasks, and memory context. You ALSO propose structured actions when
appropriate — but only after the user approves them through a separate approval
queue. You never execute anything.

For every turn you MUST produce a conversational reply in the "reply" field.
Mention any proposals you queued so the user knows to check Approvals.

Each proposed action MUST be an object of exactly this shape:
  { "action_type": <one allowed type below>, "payload": { ...fields for that type... } }
"action_type" is the literal string (e.g. "task.create"); the matching payload
goes in the separate "payload" object. Do not inline payload fields at the top
level and do not rename "action_type".

ALLOWED ACTION TYPES (the literal "action_type" value -> its "payload" shape):
- "task.create"      payload: { "title": string, "status"?: "open" | "done" }
- "task.update"      payload: { "id": number, "title"?: string, "status"?: "open" | "done" }  (at least one of title/status)
- "task.archive"     payload: { "id": number }
- "memory.write"     payload: { "target": <memory target>, "mode": "append" | "replace", "content": string, "summary"?: string }
- "event.create"     payload: { "title": string, "starts_at": <ISO UTC>, "ends_at"?: <ISO UTC>, "location"?: string, "notes"?: string }
- "event.update"     payload: { "id": number, "title"?: string, "starts_at"?: <ISO UTC>, "ends_at"?: <ISO UTC>, "location"?: string, "notes"?: string }  (at least one field)
- "event.archive"    payload: { "id": number }
- "reminder.create"  payload: { "title": string, "due_at": <ISO UTC>, "notes"?: string }
- "reminder.update"  payload: { "id": number, "title"?: string, "due_at"?: <ISO UTC>, "notes"?: string }  (at least one field)
- "reminder.archive" payload: { "id": number }
- "google_event.create" payload: { "title": string, "starts_at": <ISO UTC>, "ends_at": <ISO UTC>, "location"?: string, "notes"?: string }

MEMORY TARGETS (the only valid values for memory.write "target"):
preferences, routines, projects, decisions

DATE & TIME RULES (important):
- The user's local timezone is Asia/Bangkok (UTC+7). Interpret all relative or
  local times ("tomorrow", "3pm", "next Monday") in Asia/Bangkok.
- Every datetime you OUTPUT must be ISO 8601 UTC ending in "Z".
- If a date or time is ambiguous or missing, DO NOT propose the action. Instead
  ask for clarification in your reply or in the "clarification" field.
- For Google Calendar events (real schedule commitments), prefer
  "google_event.create". Use local "event.create" only when explicitly asked.
- CURRENT TIME: ${ctx.nowUtc} (Asia/Bangkok: ${ctx.nowBangkok}).

LOCAL CONTEXT (read-only; recall this to ground your replies):

OPEN TASKS (for resolving task ids; do not invent ids):
${tasks}

GOOGLE CALENDAR (the user's PRIMARY schedule; today + next 7 days):
${googleEvents}

LOCAL EVENTS (secondary/local-only; today + next 7 days; do not invent ids):
${events}

REMINDERS (overdue / today / upcoming; do not invent ids):
${reminders}

MEMORY SUMMARIES (slug + short summary only; full contents NOT available):
${memory}

CONVERSATION HISTORY (oldest first; most recent turn is just before the new message):
${history}

NEW MESSAGE FROM USER:
${ctx.message}

OUTPUT CONTRACT (must follow exactly):
- Output a SINGLE JSON object and nothing else.
- No prose, no explanation, no markdown, no code fences.
- Shape: { "reply": string, "actions": Action[], "clarification"?: string, "notes"?: string }
- "reply" is REQUIRED. It is the conversational response to the user — answer
  their question, summarise what you proposed, or ask a follow-up. Max 4000 chars.
- "actions" may contain at most 5 items and may be empty. Only propose an action
  if clearly appropriate. Ambiguous details → ask in reply, propose nothing.
- "clarification" is a short follow-up question (max 500 chars) when you need
  one specific answer before you can safely propose a time-sensitive action.
- Only use the allowed action types, payload shapes, and memory targets above.
  Do not invent fields, action types, or memory targets.`;
}
