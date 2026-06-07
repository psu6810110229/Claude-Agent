import type { FastifyInstance, FastifyReply } from "fastify";
import { chatRequestSchema, chatHistoryQuerySchema } from "../schemas/chat.js";
import { logActivity } from "../db/repositories/activityRepo.js";
import { archiveActiveMessages, listRecentMessages } from "../db/repositories/chatRepo.js";
import { runChat } from "../services/chat.js";
import {
  realClaudeInvoker,
  type ClaudeInvoker,
} from "../services/claudeClient.js";
import {
  realGoogleEventsFetcher,
  type GoogleEventsFetcher,
} from "../services/googleCalendar.js";

/** Plugin options. Both injectables let tests stub Claude / Google Calendar. */
export interface ChatRouteOptions {
  aiInvoker?: ClaudeInvoker;
  calendarFetcher?: GoogleEventsFetcher;
}

/**
 * Chat routes (Step 12) — conversational agent with recall.
 *
 * POST /api/chat: multi-turn chat. Reads real local state for recall, persists
 * successful exchanges, routes any WRITE through the approval queue. Fails
 * closed on every error path. Claude never executes anything.
 *
 * GET /api/chat/history: recent messages for the dashboard chat page.
 */
export async function chatRoutes(
  app: FastifyInstance,
  opts: ChatRouteOptions,
): Promise<void> {
  const invoke = opts.aiInvoker ?? realClaudeInvoker;
  const fetchGoogle = opts.calendarFetcher ?? realGoogleEventsFetcher;

  app.post("/api/chat", async (req, reply) => handleChat(req, invoke, fetchGoogle, reply));

  app.post("/api/chat/reset", async (_req, reply) => {
    const archived = archiveActiveMessages();
    logActivity("chat.session.reset", `${archived} message(s) archived`);
    return reply.code(200).send({ kind: "reset", archived });
  });

  app.get("/api/chat/history", async (req, reply) => {
    const q = chatHistoryQuerySchema.safeParse(
      (req.query as Record<string, string>) ?? {},
    );
    const limit = q.success ? q.data.limit : 50;
    const messages = listRecentMessages(limit);
    return reply.code(200).send({ messages });
  });
}

async function handleChat(
  req: import("fastify").FastifyRequest,
  invoke: ClaudeInvoker,
  fetchGoogle: GoogleEventsFetcher,
  reply: FastifyReply,
): Promise<unknown> {
  const body = chatRequestSchema.safeParse(req.body);
  if (!body.success) {
    return reply
      .code(400)
      .send({ kind: "error", error: body.error.issues[0].message });
  }

  const { message } = body.data;
  logActivity("chat.message.received", message.slice(0, 120));

  const result = await runChat(message, invoke, fetchGoogle);

  // Spawn/timeout/disabled/empty: fail closed, no approvals, no history written.
  if (result.kind === "failed") {
    logActivity("chat.message.failed", `${result.reason}: ${result.message}`);
    const code =
      result.reason === "timeout"
        ? 504
        : result.reason === "disabled"
          ? 503
          : 502;
    return reply.code(code).send({ kind: "error", error: result.message });
  }

  // Invalid JSON / schema failure: reject, no approvals.
  if (result.kind === "rejected") {
    logActivity("chat.message.rejected", result.message);
    return reply.code(400).send({ kind: "error", error: result.message });
  }

  // Valid reply. Log any queued approvals.
  for (const approval of result.approvals) {
    logActivity(
      "chat.message.proposed",
      `approval #${approval.id} (${approval.action_type}) from chat`,
    );
  }
  logActivity("chat.message.replied", `${result.approvals.length} proposal(s)`);

  return reply.code(201).send({
    kind: "chat",
    reply: result.reply,
    approvals: result.approvals,
    clarification: result.clarification,
    notes: result.notes,
  });
}
