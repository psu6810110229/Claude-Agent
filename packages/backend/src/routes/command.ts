import type { FastifyInstance } from "fastify";
import { commandRequestSchema } from "../schemas/command.js";
import { parseCommand, HELP_EXAMPLES } from "../services/commandParser.js";
import { actionPayloadSchemas, approvalSchema } from "../schemas/approval.js";
import { createApproval } from "../db/repositories/approvalRepo.js";
import { logActivity } from "../db/repositories/activityRepo.js";

/**
 * Command bar (Step 5). Deterministic parsing only. Every mutating command
 * becomes a *pending* approval — nothing executes here. Approving the proposal
 * later runs through the existing executor (the single approval boundary).
 */
export async function commandRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/command", async (req, reply) => {
    const body = commandRequestSchema.safeParse(req.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ kind: "error", error: body.error.issues[0].message });
    }

    const input = body.data.input;
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
