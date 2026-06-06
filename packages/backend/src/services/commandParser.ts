import type { ActionType } from "../schemas/approval.js";

/**
 * Deterministic command-bar parser (Step 5). Pure string parsing only — NO LLM,
 * NO `claude -p`, NO natural-language understanding. It maps a fixed grammar to
 * an *intent*; the route then re-validates the payload against the canonical
 * `actionPayloadSchemas` and creates an approval. Nothing executes here.
 */
export type ParseResult =
  | { kind: "help" }
  | { kind: "proposal"; actionType: ActionType; payload: unknown }
  | { kind: "error"; message: string };

/** Whitelisted memory targets (mirrors memoryTargetSchema). */
const MEMORY_TARGETS = ["preferences", "routines", "projects", "decisions"];

/** Examples shown by `help` and as command-bar placeholder guidance. */
export const HELP_EXAMPLES = [
  "help",
  "add task: Buy groceries",
  "update task 12: done",
  "update task 12: New title text",
  "archive task 12",
  "append memory preferences: I prefer concise answers",
];

export function parseCommand(rawInput: string): ParseResult {
  const input = rawInput.trim();
  if (input === "") {
    return { kind: "error", message: "Empty command. Type 'help' for examples." };
  }

  // help
  if (/^help$/i.test(input)) {
    return { kind: "help" };
  }

  // add task: <title>
  let m = /^add task:\s*(.+)$/i.exec(input);
  if (m) {
    const title = m[1].trim();
    if (!title) return { kind: "error", message: "Task title is required." };
    return { kind: "proposal", actionType: "task.create", payload: { title } };
  }

  // update task <id>: <title|status>
  m = /^update task\s+(\d+):\s*(.+)$/i.exec(input);
  if (m) {
    const id = Number(m[1]);
    const value = m[2].trim();
    if (!value) return { kind: "error", message: "Update value is required." };
    // Deterministic disambiguation: exact `open`/`done` => status, else title.
    const lowered = value.toLowerCase();
    const payload =
      lowered === "open" || lowered === "done"
        ? { id, status: lowered }
        : { id, title: value };
    return { kind: "proposal", actionType: "task.update", payload };
  }

  // archive task <id>
  m = /^archive task\s+(\d+)$/i.exec(input);
  if (m) {
    const id = Number(m[1]);
    return { kind: "proposal", actionType: "task.archive", payload: { id } };
  }

  // append memory <target>: <content>
  m = /^append memory\s+(\w+):\s*(.+)$/i.exec(input);
  if (m) {
    const target = m[1].toLowerCase();
    const content = m[2].trim();
    if (!MEMORY_TARGETS.includes(target)) {
      return {
        kind: "error",
        message: `Unknown memory target '${target}'. Must be one of: ${MEMORY_TARGETS.join(", ")}.`,
      };
    }
    if (!content) return { kind: "error", message: "Memory content is required." };
    return {
      kind: "proposal",
      actionType: "memory.write",
      payload: { target, mode: "append", content },
    };
  }

  return {
    kind: "error",
    message: "Unrecognized command. Type 'help' for supported commands.",
  };
}
