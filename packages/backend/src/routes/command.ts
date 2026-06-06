import type { FastifyInstance } from "fastify";
import { commandRequestSchema } from "../schemas/command.js";
import { parseCommand, HELP_EXAMPLES } from "../services/commandParser.js";
import { actionPayloadSchemas, approvalSchema } from "../schemas/approval.js";
import { createApproval } from "../db/repositories/approvalRepo.js";
import { logActivity } from "../db/repositories/activityRepo.js";
import { runAiCommand } from "../services/aiCommand.js";
import {
  realClaudeInvoker,
  type ClaudeInvoker,
} from "../services/claudeClient.js";

/** Plugin options. `aiInvoker` is injectable so tests can stub Claude. */
export interface CommandRouteOptions {
  aiInvoker?: ClaudeInvoker;
}

/**
 * Command bar route.
 *
 * - mode "deterministic" (Step 5): pure server-side parsing, NO LLM.
 * - mode "ai" (Step 6): Claude reasoning runtime, PROPOSAL-ONLY.
 *
 * Both paths share the SAME approval boundary: every mutating intent becomes a
 * *pending* approval via `createApproval`. Nothing executes here — approving a
 * proposal later runs through the existing executor (the single execution gate).
 * Claude never executes actions and never bypasses the approval queue.
 */
export async function commandRoutes(
  app: FastifyInstance,
  opts: CommandRouteOptions,
): Promise<void> {
  const invoke = opts.aiInvoker ?? realClaudeInvoker;

  app.post("/api/command", async (req, reply) => {
    const body = commandRequestSchema.safeParse(req.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ kind: "error", error: body.error.issues[0].message });
    }

    const { input, mode } = body.data;

    if (mode === "ai") {
      return handleAiCommand(input, invoke, reply);
    }

    // --- Deterministic path (Step 5, unchanged) ---
    logActivity("command.received", input);

    const parsed = parseCommand(input);

    if (parsed.kind === "help") {
      return reply.code(200).send({ kind: "help", examples: HELP_EXAMPLES });
    }

    if (parsed.kind === "error") {
      logActivity("command.rejected", `${input} — ${parsed.message}`);
      return reply.code(400).send({ kind: "error", error: parsed.message });
    }

    // Re-validate the parsed payload against the canonical action schema before
    // anything is queued, so the parser and the approval queue share one source
    // of truth and a malformed payload can never reach the executor.
    const schema = actionPayloadSchemas[parsed.actionType];
    const check = schema.safeParse(parsed.payload);
    if (!check.success) {
      const message = check.error.issues.map((i) => i.message).join("; ");
      logActivity("command.rejected", `${input} — ${message}`);
      return reply.code(400).send({ kind: "error", error: message });
    }

    const approval = createApproval(parsed.actionType, check.data);
    logActivity(
      "command.proposed",
      `approval #${approval.id} (${approval.action_type}) from command`,
    );
    return reply
      .code(201)
      .send({ kind: "proposal", approval: approvalSchema.parse(approval) });
  });
}

/** AI command mode (Step 6). Proposal-only; validated output → approval queue. */
async function handleAiCommand(
  input: string,
  invoke: ClaudeInvoker,
  reply: import("fastify").FastifyReply,
): Promise<unknown> {
  logActivity("ai.command.received", input);

  const result = await runAiCommand(input, invoke);

  // Spawn/timeout/disabled/empty errors: fail closed, create zero approvals.
  if (result.kind === "failed") {
    logActivity("ai.command.failed", `${result.reason}: ${result.message}`);
    const code =
      result.reason === "timeout"
        ? 504
        : result.reason === "disabled"
          ? 503
          : 502;
    return reply.code(code).send({ kind: "error", error: result.message });
  }

  // Invalid JSON / schema failure / unknown action type: reject, zero approvals.
  if (result.kind === "rejected") {
    logActivity("ai.command.rejected", `${input} — ${result.message}`);
    return reply.code(400).send({ kind: "error", error: result.message });
  }

  // Valid but no actionable proposals.
  if (result.actions.length === 0) {
    return reply
      .code(200)
      .send({ kind: "none", message: "No actionable proposals were produced." });
  }

  // Valid actions: each becomes a pending approval. Output was already validated
  // by the strict AI schema (which reuses actionPayloadSchemas), so the queue
  // and executor remain the single source of truth.
  const approvals = result.actions.map((action) => {
    const approval = createApproval(action.action_type, action.payload);
    logActivity(
      "ai.command.proposed",
      `approval #${approval.id} (${approval.action_type}) from ai`,
    );
    return approvalSchema.parse(approval);
  });

  return reply.code(201).send({ kind: "proposal", approvals });
}
