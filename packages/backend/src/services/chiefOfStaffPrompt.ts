/**
 * Chief-of-staff prompt template (Step 6).
 *
 * Builds the single prompt string passed to `claude -p`. It is intentionally
 * compact: only the allowed action types, the user's command, a capped open-task
 * list, and the memory TARGET NAMES (never memory file contents, never DB dumps).
 * Claude is instructed to PROPOSE only — it must return strict JSON and nothing
 * else. The backend, not Claude, decides what (if anything) is executed.
 */

export interface CompactContext {
  /** The raw natural-language command from the user. */
  input: string;
  /** Capped list of open tasks (id + short title) for grounding updates/archives. */
  openTasks: { id: number; title: string }[];
  /** Whitelisted memory target names only. */
  memoryTargets: string[];
  /** Current instant (ISO 8601 UTC) for resolving relative dates. */
  nowUtc: string;
  /** Current Asia/Bangkok wall-clock time (the user's local timezone). */
  nowBangkok: string;
}

export function buildChiefOfStaffPrompt(ctx: CompactContext): string {
  const tasks =
    ctx.openTasks.length > 0
      ? ctx.openTasks.map((t) => `  - #${t.id}: ${t.title}`).join("\n")
      : "  (none)";

  return `You are the chief-of-staff reasoning engine for a local-first personal
agent. You PROPOSE structured actions only. You never execute anything; a human
approves every action through a separate approval queue.

Convert the user's command into zero or more proposed actions.

Each action MUST be an object of exactly this shape:
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

Example of a single valid action:
  { "action_type": "task.create", "payload": { "title": "Buy groceries" } }

DATE & TIME RULES (important):
- The user's local timezone is Asia/Bangkok (UTC+7). Interpret all relative or
  local times ("tomorrow", "3pm", "next Monday") in Asia/Bangkok.
- Every datetime you OUTPUT must be ISO 8601 UTC ending in "Z"
  (e.g. "2026-06-07T08:00:00.000Z" for 3pm Bangkok on 2026-06-07).
- If a date or time is ambiguous, missing, or you cannot resolve it confidently,
  DO NOT propose the event/reminder action. Instead return no action for it and
  ask one concise follow-up question in "clarification" (for example: "What time
  should I remind you?"). This must happen before anything reaches approvals.
- For real schedule commitments or meetings that should go on the user's primary
  calendar, prefer "google_event.create" over the local-only "event.create".
  Use local "event.create" only when the user explicitly asks for a local/draft
  event instead of Google Calendar.
- For vague daypart ranges, use conservative Bangkok defaults only when the date
  is otherwise clear: morning = 09:00, afternoon = 13:00, evening/night = 18:00,
  and "morning to evening" = 09:00-18:00. Mention the assumption in "notes".
- CURRENT TIME: ${ctx.nowUtc} (Asia/Bangkok: ${ctx.nowBangkok}).

MEMORY TARGETS (the only valid values for memory.write "target"):
${ctx.memoryTargets.map((t) => `- ${t}`).join("\n")}

OPEN TASKS (for resolving task ids; do not invent ids):
${tasks}

OUTPUT CONTRACT (must follow exactly):
- Output a SINGLE JSON object and nothing else.
- No prose, no explanation, no markdown, no code fences.
- Shape: { "actions": Action[], "clarification"?: string, "notes"?: string }
- "actions" may contain at most 5 items. If the command is unclear or not
  actionable, return { "actions": [] }.
- Use "clarification" only when a direct answer from the user would let you
  safely produce an event/reminder proposal next. Do not create placeholder
  event/reminder times just to satisfy the schema.
- Only use the allowed action types and payload shapes above. Do not invent
  fields, action types, or memory targets.

USER COMMAND:
${ctx.input}`;
}
