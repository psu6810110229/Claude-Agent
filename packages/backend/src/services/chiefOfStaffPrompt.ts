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
- "task.create"   payload: { "title": string, "status"?: "open" | "done" }
- "task.update"   payload: { "id": number, "title"?: string, "status"?: "open" | "done" }  (at least one of title/status)
- "task.archive"  payload: { "id": number }
- "memory.write"  payload: { "target": <memory target>, "mode": "append" | "replace", "content": string, "summary"?: string }

Example of a single valid action:
  { "action_type": "task.create", "payload": { "title": "Buy groceries" } }

MEMORY TARGETS (the only valid values for memory.write "target"):
${ctx.memoryTargets.map((t) => `- ${t}`).join("\n")}

OPEN TASKS (for resolving task ids; do not invent ids):
${tasks}

OUTPUT CONTRACT (must follow exactly):
- Output a SINGLE JSON object and nothing else.
- No prose, no explanation, no markdown, no code fences.
- Shape: { "actions": Action[], "notes"?: string }
- "actions" may contain at most 5 items. If the command is unclear or not
  actionable, return { "actions": [] }.
- Only use the allowed action types and payload shapes above. Do not invent
  fields, action types, or memory targets.

USER COMMAND:
${ctx.input}`;
}
