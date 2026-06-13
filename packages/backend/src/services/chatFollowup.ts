import { appendMessage } from "../db/repositories/chatRepo.js";
import { dispatchProposedAction } from "./actionDispatcher.js";
import { followupOutputSchema } from "../schemas/chat.js";
import type { AiAction } from "../schemas/aiCommand.js";
import { buildChatContext } from "./chat.js";
import { buildFollowupPrompt } from "./chatPrompt.js";
import { unwrapJsonOutput } from "./jsonOutput.js";
import { ClaudeError, type ClaudeInvoker } from "./claudeClient.js";
import { GeminiError } from "./geminiClient.js";
import {
  realGoogleEventsFetcher,
  type GoogleEventsFetcher,
} from "./googleCalendar.js";
import type { Approval } from "../schemas/approval.js";
import { CLAUDE_BRIEF_TIMEOUT_MS } from "../config.js";

/**
 * Idle FOLLOW-UP (proactive nudge). Fired by the dashboard when the user has
 * gone quiet for a few seconds after the assistant's last turn. Runs ONE AI turn
 * that either offers a short optional suggestion or stays silent. Fails QUIET:
 * any error, disabled provider, or invalid output returns `silent` — a proactive
 * nudge must never surface an error to the user.
 *
 * Like chat, any proposed action flows through the dispatcher (auto-exec or
 * pending) and the assistant message is persisted so it appears in history.
 */
export type FollowupResult =
  | {
      kind: "spoke";
      reply: string;
      spoken?: string;
      approvals: Approval[];
    }
  | { kind: "silent" };

export async function runChatFollowup(
  invoke: ClaudeInvoker,
  fetchGoogle: GoogleEventsFetcher = realGoogleEventsFetcher,
): Promise<FollowupResult> {
  // Build recall context from the existing conversation (no new user message).
  const ctx = await buildChatContext("", fetchGoogle);
  if (ctx.history.length === 0) return { kind: "silent" };

  let raw: string;
  try {
    raw = await invoke(buildFollowupPrompt(ctx), {
      timeoutMs: CLAUDE_BRIEF_TIMEOUT_MS,
    });
  } catch (err) {
    // Stay quiet on any provider failure — never bother the user for a nudge.
    if (err instanceof ClaudeError || err instanceof GeminiError) {
      return { kind: "silent" };
    }
    return { kind: "silent" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJsonOutput(raw));
  } catch {
    return { kind: "silent" };
  }

  const check = followupOutputSchema.safeParse(parsed);
  if (!check.success) return { kind: "silent" };

  // Model chose to stay quiet, or produced no usable reply.
  if (check.data.silent || !check.data.reply) return { kind: "silent" };

  const dispatched = await Promise.all(
    check.data.actions.map((action: AiAction) =>
      dispatchProposedAction(action.action_type, action.payload, "chat-followup"),
    ),
  );
  const approvals: Approval[] = dispatched.map((d) => d.approval);

  const actionsJson =
    approvals.length > 0
      ? JSON.stringify(
          approvals.map((a) => ({ id: a.id, action_type: a.action_type })),
        )
      : null;
  appendMessage("assistant", check.data.reply, actionsJson);

  return {
    kind: "spoke",
    reply: check.data.reply,
    spoken: check.data.spoken,
    approvals,
  };
}
