import { listTasks } from "../db/repositories/taskRepo.js";
import { memoryTargetSchema } from "../schemas/memory.js";
import { aiOutputSchema, type AiAction } from "../schemas/aiCommand.js";
import { buildChiefOfStaffPrompt } from "./chiefOfStaffPrompt.js";
import { bangkokWallClock } from "./agenda.js";
import { unwrapJsonOutput } from "./jsonOutput.js";
import { ClaudeError, type ClaudeInvoker } from "./claudeClient.js";
import { CLAUDE_CONTEXT_TASK_CAP, nowIso } from "../config.js";

/**
 * AI command orchestration (Step 6). Pure proposal pipeline — it reads a compact
 * context, invokes Claude, and validates the output. It performs NO database or
 * file writes; the route is responsible for routing valid actions into the
 * approval queue. Every branch fails closed.
 */
export type AiCommandResult =
  | {
      kind: "proposed";
      actions: AiAction[];
      clarification?: string;
      notes?: string;
    }
  | { kind: "rejected"; message: string }
  | { kind: "failed"; reason: string; message: string };

/** Build the compact context snapshot: open tasks (capped) + memory target names. */
function buildContext(input: string): {
  input: string;
  openTasks: { id: number; title: string }[];
  memoryTargets: string[];
  nowUtc: string;
  nowBangkok: string;
} {
  const openTasks = listTasks()
    .filter((t) => t.status === "open")
    .slice(0, CLAUDE_CONTEXT_TASK_CAP)
    .map((t) => ({ id: t.id, title: t.title.slice(0, 120) }));

  const now = new Date();
  return {
    input,
    openTasks,
    memoryTargets: [...memoryTargetSchema.options],
    nowUtc: nowIso(),
    nowBangkok: bangkokWallClock(now),
  };
}

export async function runAiCommand(
  input: string,
  invoke: ClaudeInvoker,
): Promise<AiCommandResult> {
  const prompt = buildChiefOfStaffPrompt(buildContext(input));

  // 1. Invoke Claude. Any spawn/timeout/disabled error fails closed.
  let raw: string;
  try {
    raw = await invoke(prompt);
  } catch (err) {
    if (err instanceof ClaudeError) {
      return { kind: "failed", reason: err.reason, message: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "failed", reason: "spawn", message };
  }

  // 2. Normalize (trim + unwrap a single outer code fence only) then strict
  //    JSON parse. No first-{-to-last-} extraction, no repair; prose still fails.
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJsonOutput(raw));
  } catch {
    const snippet = raw.slice(0, 300).replace(/\n/g, "\\n");
    return {
      kind: "rejected",
      message: `Claude output was not valid JSON. Raw(300): ${snippet}`,
    };
  }

  // 3. Validate against the strict schema (unknown action types / bad payloads
  //    / extra keys / too many actions are all rejected here).
  const check = aiOutputSchema.safeParse(parsed);
  if (!check.success) {
    const detail = check.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return {
      kind: "rejected",
      message: `Claude output failed validation: ${detail}`,
    };
  }

  return {
    kind: "proposed",
    actions: check.data.actions,
    clarification: check.data.clarification,
    notes: check.data.notes,
  };
}
