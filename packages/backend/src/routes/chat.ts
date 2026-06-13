import type { FastifyInstance, FastifyReply } from "fastify";
import {
  chatRequestSchema,
  chatHistoryQuerySchema,
  chatVerifyRequestSchema,
} from "../schemas/chat.js";
import { logActivity } from "../db/repositories/activityRepo.js";
import { archiveActiveMessages, listRecentMessages } from "../db/repositories/chatRepo.js";
import { runChat } from "../services/chat.js";
import { runChatFollowup } from "../services/chatFollowup.js";
import { normalizeDictation } from "../services/textNormalizer.js";
import type { ClaudeInvoker } from "../services/claudeClient.js";
import {
  selectProvider,
  otherAvailableProvider,
  getProvider,
  ProviderError,
  type AiProviderId,
} from "../services/aiProvider.js";
import {
  realGoogleEventsFetcher,
  type GoogleEventsFetcher,
} from "../services/googleCalendar.js";
import {
  isVerified,
  verify,
  isGuardEnabled,
  clearVerified,
} from "../services/identityVerifier.js";
import { OWNER_SECRET_PHRASE, OWNER_PIN } from "../config.js";

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

  app.get("/api/chat/challenge", async (_req, reply) => {
    return reply.code(200).send({
      guardEnabled: isGuardEnabled(),
      question: null,
    });
  });

  app.post("/api/chat/verify", async (req, reply) => {
    if (!isGuardEnabled()) {
      return reply.code(200).send({ kind: "disabled" });
    }
    const body = chatVerifyRequestSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ kind: "error", error: "คำขอไม่ถูกต้อง" });
    }
    const { sessionId, input } = body.data;
    const out = verify(sessionId, input); // NEVER log pin/phrase
    if (out.ok) {
      logActivity("chat.identity.verified", "owner verified for a chat session");
      return reply.code(200).send({ kind: "verified" });
    }

    logActivity("chat.identity.denied", `reason=${out.reason}`); // reason only, no values
    const code =
      out.reason === "locked"
        ? 429
        : out.reason === "not-configured"
          ? 503
          : 401;

    const denyMessage = (reason: string): string => {
      if (reason === "locked") return "ลองใหม่อีกครั้งในภายหลังครับ";
      if (reason === "not-configured") return "ระบบยังไม่ได้ตั้งค่ารหัสยืนยัน";
      return "ยืนยันไม่สำเร็จครับ";
    };

    return reply.code(code).send({
      kind: "denied",
      reason: out.reason,
      error: denyMessage(out.reason),
    });
  });

  // Idle proactive follow-up. Gemini-first (the user's primary provider); falls
  // back to Claude only if Gemini is not configured. Fails QUIET: any problem
  // returns kind:"silent" with 200 so the dashboard never shows an error for a
  // nudge the user did not explicitly request.
  app.post("/api/chat/followup", async (req, reply) => {
    const body = req.body as { sessionId?: string } | undefined;
    const sessionId = body?.sessionId;
    if (!isVerified(sessionId)) {
      return reply.code(200).send({ kind: "silent" });
    }

    const invoke =
      opts.aiInvoker ?? pickFollowupProvider()?.invoke;
    if (!invoke) {
      return reply.code(200).send({ kind: "silent" });
    }
    const result = await runChatFollowup(invoke, fetchGoogle);
    if (result.kind === "silent") {
      return reply.code(200).send({ kind: "silent" });
    }
    for (const approval of result.approvals) {
      logActivity(
        "chat.followup.proposed",
        `approval #${approval.id} (${approval.action_type}) from follow-up`,
      );
    }
    logActivity("chat.followup.spoke", `${result.approvals.length} proposal(s)`);
    return reply.code(200).send({
      kind: "followup",
      reply: result.reply,
      spoken: result.spoken ?? null,
      approvals: result.approvals,
    });
  });

  app.post("/api/chat/reset", async (req, reply) => {
    const body = req.body as { sessionId?: string } | undefined;
    const sessionId = body?.sessionId;
    clearVerified(sessionId);

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

  let message = body.data.message;
  const {
    provider: requestedProvider,
    mode: requestedMode,
    sessionId,
  } = body.data;
  const mode = requestedMode ?? "manual";
  
  // Step 16: Dictation normalization
  message = normalizeDictation(message);

  // Step 16: Auto-bypass via PIN or Secret Phrase
  if (isGuardEnabled() && sessionId) {
    const cleanMsg = message.trim().toLowerCase();
    let matchedInline = false;
    let removeLength = 0;
    let unlockSecret = "";

    // 1. Check PIN
    if (OWNER_PIN && cleanMsg === OWNER_PIN.trim().toLowerCase()) {
      matchedInline = true;
      unlockSecret = OWNER_PIN;
      removeLength = cleanMsg.length;
    }
    // 2. Check Secret Phrase
    else if (OWNER_SECRET_PHRASE) {
      const phrase = OWNER_SECRET_PHRASE.trim().toLowerCase();
      if (cleanMsg.startsWith(phrase)) {
        matchedInline = true;
        unlockSecret = OWNER_SECRET_PHRASE;
        removeLength = OWNER_SECRET_PHRASE.length;
      } else if (cleanMsg.startsWith("จาวิส " + phrase)) {
        matchedInline = true;
        unlockSecret = OWNER_SECRET_PHRASE;
        removeLength = "จาวิส ".length + OWNER_SECRET_PHRASE.length;
      } else if (cleanMsg.startsWith("จาวิส" + phrase)) {
        matchedInline = true;
        unlockSecret = OWNER_SECRET_PHRASE;
        removeLength = "จาวิส".length + OWNER_SECRET_PHRASE.length;
      }
    }

    if (matchedInline) {
      const out = verify(sessionId, unlockSecret);
      if (out.ok) {
        logActivity("chat.identity.verified", "owner verified via inline credentials");
        let remainder = message.substring(removeLength).trim();
        if (remainder.length === 0) {
          remainder = "[ผู้ใช้ไม่ได้พิมพ์คำสั่งใดๆ เพิ่มเติม ให้คุณตอบกลับสั้นๆ ยืนยันว่ายืนยันตัวตนสำเร็จแล้วและพร้อมดำเนินการต่อ]";
        }
        message = `[System: ผู้ใช้เพิ่งยืนยันตัวตนด้วยรหัสสำเร็จ ตอนนี้คุณสามารถเข้าถึงข้อมูลส่วนตัวและดำเนินการต่อได้เลย] ${remainder}`;
      }
    }
  }

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
  const verified = isVerified(sessionId, true); // `true` updates the idle timeout
  const result = await runChat(message, invoke, fetchGoogle, { verified, sessionId });

  // Spawn/timeout/disabled/empty: fail closed, no approvals, no history written.
  if (result.kind === "failed") {
    logActivity("chat.message.failed", `${result.reason}: ${result.message}`);
    const code =
      result.reason === "timeout"
        ? 504
        : result.reason === "disabled"
          ? 503
          : result.reason === "rate-limit"
            ? 429
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
    spoken: result.spoken ?? null,
    resultReport: result.resultReport ?? null,
    resultSpoken: result.resultSpoken ?? null,
    mode,
    provider: resolved.selection.selectedProvider,
    selectedModel: resolved.selection.selectedModel ?? null,
    requestedProvider: resolved.selection.requestedProvider ?? null,
    providerReason: resolved.selection.reason,
    approvals: result.approvals,
    clarification: result.clarification,
    clarification_choices: result.clarificationChoices,
    notes: result.notes,
    verificationRequired: result.verificationRequired || undefined,

    sensitivity: result.sensitivity ?? "normal",
  });
}

/**
 * Provider for the idle follow-up: Gemini first (the user's primary provider),
 * else Claude. Returns undefined only if neither is usable (then we stay silent).
 */
function pickFollowupProvider() {
  const gemini = getProvider("gemini");
  if (gemini?.isAvailable()) return gemini;
  const claude = getProvider("claude");
  if (claude?.isAvailable()) return claude;
  return undefined;
}

/** User-facing message when a manually requested provider is not usable yet. */
function providerUnavailableMessage(requested: AiProviderId | undefined): string {
  const name = requested === "gemini" ? "Gemini" : (requested ?? "provider");
  return `ผู้ช่วย ${name} ยังไม่พร้อมใช้งานครับ ตอนนี้ยังไม่ได้ตั้งค่าไว้ ลองเลือก Claude แทนได้`;
}
