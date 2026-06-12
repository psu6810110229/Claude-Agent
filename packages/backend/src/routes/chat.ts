import type { FastifyInstance, FastifyReply } from "fastify";
import { chatRequestSchema, chatHistoryQuerySchema } from "../schemas/chat.js";
import { logActivity } from "../db/repositories/activityRepo.js";
import { archiveActiveMessages, listRecentMessages } from "../db/repositories/chatRepo.js";
import { runChat } from "../services/chat.js";
import type { ClaudeInvoker } from "../services/claudeClient.js";
import {
  selectProvider,
  otherAvailableProvider,
  ProviderError,
  type AiProviderId,
} from "../services/aiProvider.js";
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
  const fetchGoogle = opts.calendarFetcher ?? realGoogleEventsFetcher;

  app.post("/api/chat", async (req, reply) =>
    handleChat(req, opts.aiInvoker, fetchGoogle, reply),
  );

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
  injectedInvoker: ClaudeInvoker | undefined,
  fetchGoogle: GoogleEventsFetcher,
  reply: FastifyReply,
): Promise<unknown> {
  const body = chatRequestSchema.safeParse(req.body);
  if (!body.success) {
    return reply
      .code(400)
      .send({ kind: "error", error: body.error.issues[0].message });
  }

  const { message, provider: requestedProvider, mode: requestedMode } = body.data;
  const mode = requestedMode ?? "manual";
  logActivity("chat.message.received", message.slice(0, 120));

  // Roadmap 11 Phase 2/4 — provider selection. Manual resolves the requested
  // provider per request (an unconfigured provider fails closed here: no
  // invocation, no fake success, requested provider echoed back so the UI never
  // hides the choice). Auto routes transparently and never throws (Claude is the
  // always-available safe default); the message drives low-risk classification.
  let resolved: ReturnType<typeof selectProvider>;
  try {
    resolved = selectProvider({ mode, requestedProvider, message });
  } catch (err) {
    if (err instanceof ProviderError) {
      logActivity(
        "ai.provider.unavailable",
        `requested '${requestedProvider}': ${err.reason}`,
      );
      return reply.code(503).send({
        kind: "error",
        error: providerUnavailableMessage(requestedProvider),
        requestedProvider: requestedProvider ?? null,
        reason: err.reason,
      });
    }
    throw err;
  }

  logActivity("ai.provider.selected", resolved.selection.reason);

  // Tests inject `aiInvoker`; otherwise invoke the selected provider directly.
  const invoke = injectedInvoker ?? resolved.provider.invoke;
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
    // Phase 4 — VISIBLE Auto fallback. The budget allows one provider call per
    // chat command, so we never retry silently. On an Auto failure we surface
    // the other available provider for an EXPLICIT user retry instead.
    const fallback =
      mode === "auto"
        ? otherAvailableProvider(resolved.selection.selectedProvider)
        : undefined;
    if (fallback) {
      logActivity(
        "ai.provider.fallback_requested",
        `${resolved.selection.selectedProvider} failed (${result.reason}); offer ${fallback.id}`,
      );
    }
    return reply.code(code).send({
      kind: "error",
      error: result.userMessage,
      mode,
      provider: resolved.selection.selectedProvider,
      fallbackProvider: fallback?.id ?? null,
    });
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
    mode,
    provider: resolved.selection.selectedProvider,
    selectedModel: resolved.selection.selectedModel ?? null,
    requestedProvider: resolved.selection.requestedProvider ?? null,
    providerReason: resolved.selection.reason,
    approvals: result.approvals,
    clarification: result.clarification,
    clarification_choices: result.clarificationChoices,
    notes: result.notes,
  });
}

/** User-facing message when a manually requested provider is not usable yet. */
function providerUnavailableMessage(requested: AiProviderId | undefined): string {
  const name = requested === "gemini" ? "Gemini" : (requested ?? "provider");
  return `ผู้ช่วย ${name} ยังไม่พร้อมใช้งานครับ ตอนนี้ยังไม่ได้ตั้งค่าไว้ ลองเลือก Claude แทนได้`;
}
