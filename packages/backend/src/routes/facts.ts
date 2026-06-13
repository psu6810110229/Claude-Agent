import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  factListResponseSchema,
  createFactProposalBodySchema,
  factUpdatePayloadSchema,
  factForgetPayloadSchema,
} from "../schemas/fact.js";
import { approvalSchema, type ActionType } from "../schemas/approval.js";
import { listActiveFacts } from "../db/repositories/factRepo.js";
import { dispatchProposedAction } from "../services/actionDispatcher.js";
import { logActivity } from "../db/repositories/activityRepo.js";

/**
 * Step 16 — facts API. Read the known facts and propose fact actions from the
 * dashboard ("teach a fact", "forget", "edit"). Every proposal flows through the
 * same dispatcher as chat-proposed facts: fact.remember may auto-execute (when
 * auto-execute is on); fact.update/fact.forget always stay pending for confirm.
 */

/** Discriminated body for POST /api/facts/proposals — remember | update | forget. */
const factProposalBodySchema = z.discriminatedUnion("action_type", [
  z.object({
    action_type: z.literal("fact.remember"),
    payload: createFactProposalBodySchema,
  }),
  z.object({
    action_type: z.literal("fact.update"),
    payload: factUpdatePayloadSchema,
  }),
  z.object({
    action_type: z.literal("fact.forget"),
    payload: factForgetPayloadSchema,
  }),
]);

export async function factRoutes(app: FastifyInstance): Promise<void> {
  // List active (non-archived) facts — the user's real memory.
  app.get("/api/facts", async () => {
    return factListResponseSchema.parse({ facts: listActiveFacts() });
  });

  // Propose a fact action. remember (append) may auto-run; update/forget stay
  // pending. Nothing bypasses the dispatcher / executor.
  app.post("/api/facts/proposals", async (req, reply) => {
    const body = factProposalBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0].message });
    }
    const { action_type, payload } = body.data;
    const { mode, approval } = await dispatchProposedAction(
      action_type as ActionType,
      payload,
      "facts",
    );
    logActivity(
      "fact.propose",
      `approval #${approval.id}: ${action_type} [${mode}]`,
    );
    return reply.code(201).send(approvalSchema.parse(approval));
  });
}
