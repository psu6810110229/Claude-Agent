import { scheduleFixAiOutputSchema } from "../schemas/scheduleFix.js";
import type { UpdateGoogleEventPayload } from "../schemas/googleCalendar.js";
import {
  buildScheduleFixPrompt,
  type ScheduleFixContext,
} from "./scheduleFixPrompt.js";
import { unwrapJsonOutput } from "./jsonOutput.js";
import { ClaudeError, type ClaudeInvoker } from "./claudeClient.js";
import { GeminiError } from "./geminiClient.js";
import { CLAUDE_BRIEF_TIMEOUT_MS } from "../config.js";

/**
 * Tier 2 — schedule-fix proposer. Pure proposal pipeline (mirrors `aiCommand`):
 * it builds the prompt, invokes the provider, and validates the output. It does
 * NO database writes — the route is responsible for queuing each validated
 * proposal as a PENDING approval. Every branch fails closed.
 */

/** A validated reschedule proposal (no approval row yet). */
export interface ValidatedScheduleFix {
  payload: UpdateGoogleEventPayload;
  reason: string;
  /** Kind of the finding this fix addresses, when the model linked a valid one. */
  findingKind: string | null;
}

export type ScheduleFixResult =
  | { kind: "proposed"; proposals: ValidatedScheduleFix[]; notes?: string }
  | { kind: "rejected"; message: string }
  | { kind: "failed"; reason: string; message: string };

export async function proposeScheduleFixes(
  ctx: ScheduleFixContext,
  invoke: ClaudeInvoker,
): Promise<ScheduleFixResult> {
  const prompt = buildScheduleFixPrompt(ctx);

  // 1. Invoke. Any spawn/timeout/disabled/rate-limit error fails closed.
  let raw: string;
  try {
    raw = await invoke(prompt, { timeoutMs: CLAUDE_BRIEF_TIMEOUT_MS });
  } catch (err) {
    if (err instanceof ClaudeError || err instanceof GeminiError) {
      return { kind: "failed", reason: err.reason, message: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "failed", reason: "spawn", message };
  }

  // 2. Normalize (unwrap a single outer fence) then strict JSON parse.
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJsonOutput(raw));
  } catch {
    const snippet = raw.slice(0, 300).replace(/\n/g, "\\n");
    return {
      kind: "rejected",
      message: `Schedule-fix output was not valid JSON. Raw(300): ${snippet}`,
    };
  }

  // 3. Validate against the strict schema (each payload is the canonical
  //    google_event.update schema, so bad/incomplete payloads are rejected here).
  const check = scheduleFixAiOutputSchema.safeParse(parsed);
  if (!check.success) {
    const detail = check.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return {
      kind: "rejected",
      message: `Schedule-fix output failed validation: ${detail}`,
    };
  }

  // 4. Post-validate: drop any proposal that targets an id NOT in the events the
  //    model was given (defense against fabricated/hallucinated targets). The
  //    executor would reject a bad id anyway, but never queue one in the first place.
  const validIds = new Set(ctx.events.map((e) => e.id));
  const proposals: ValidatedScheduleFix[] = [];
  for (const p of check.data.proposals) {
    if (!validIds.has(p.payload.id)) continue;
    const linked =
      p.finding_ref !== undefined ? ctx.findings[p.finding_ref] : undefined;
    proposals.push({
      payload: p.payload,
      reason: p.reason,
      findingKind: linked ? linked.kind : null,
    });
  }

  return { kind: "proposed", proposals, notes: check.data.notes };
}
