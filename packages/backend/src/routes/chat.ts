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
  routeChat,
  otherAvailableProvider,
  getProvider,
  ProviderError,
  type AiProviderId,
  type ResolvedProvider,
} from "../services/aiProvider.js";
import { isPsuConfigured } from "../services/psuClient.js";
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
import {
  loadChatAttachment,
  type ChatAttachment,
} from "../services/attachmentService.js";
import {
  geminiVisionExtract,
  isGeminiConfigured,
  type VisionPart,
} from "../services/geminiClient.js";
import type { ChatContext } from "../services/chatPrompt.js";
import { OWNER_SECRET_PHRASES, OWNER_PIN } from "../config.js";

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
      if (reason === "locked") return "ลองใหม่อีกครั้งในภายหลังค่ะ";
      if (reason === "not-configured") return "ระบบยังไม่ได้ตั้งค่ารหัสยืนยัน";
      return "ยืนยันไม่สำเร็จค่ะ";
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
    geminiModel,
    psuModel,
  } = body.data;
  const mode = requestedMode ?? "manual";
  
  // Step 16: Dictation normalization
  message = normalizeDictation(message);
  const originalMessage = message;

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
    // 2. Check Secret Phrase / owner openers (any phrase unlocks; strip it,
    //    forward the remainder). First match in the list wins.
    else {
      for (const phrase of OWNER_SECRET_PHRASES) {
        if (!phrase) continue;
        if (cleanMsg.startsWith(phrase)) {
          matchedInline = true;
          unlockSecret = phrase;
          removeLength = phrase.length;
          break;
        } else if (cleanMsg.startsWith("จาวิส " + phrase)) {
          matchedInline = true;
          unlockSecret = phrase;
          removeLength = "จาวิส ".length + phrase.length;
          break;
        } else if (cleanMsg.startsWith("จาวิส" + phrase)) {
          matchedInline = true;
          unlockSecret = phrase;
          removeLength = "จาวิส".length + phrase.length;
          break;
        }
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
  // Auto mode routes through the multi-model intent router ONLY when the PSU
  // gateway is configured; otherwise it falls back to the original
  // claude/gemini auto policy so existing behavior (and smoke tests) is intact.
  const hasFiles = (body.data.attachmentIds?.length ?? 0) > 0;
  let resolved: ResolvedProvider;
  try {
    resolved =
      mode === "auto" && isPsuConfigured()
        ? routeChat({ message, hasFiles })
        : selectProvider({ mode, requestedProvider, message });
  } catch (err) {
    if (err instanceof ProviderError) {
      logActivity(
        "ai.provider.unavailable",
        `requested '${requestedProvider}': ${err.reason}`,
      );
      const forbidden = err.reason === "schedule-forbidden";
      return reply.code(forbidden ? 400 : 503).send({
        kind: "error",
        error: forbidden
          ? "โมเดลนี้ไว้คุยเล่นเท่านั้น ใช้กับเรื่องตาราง/งานสำคัญไม่ได้ค่ะ"
          : providerUnavailableMessage(requestedProvider),
        requestedProvider: requestedProvider ?? null,
        reason: err.reason,
      });
    }
    throw err;
  }

  logActivity("ai.provider.selected", resolved.selection.reason);

  // Per-turn Gemini model override: only honored when the resolved provider is
  // Gemini. Threaded into invoke opts; the Gemini invoker re-checks the
  // allowlist. The chosen model is echoed back as `selectedModel`.
  const selectedProviderId = resolved.selection.selectedProvider;
  const useGeminiModel =
    geminiModel && selectedProviderId === "gemini" ? geminiModel : undefined;
  const usePsuModel =
    psuModel &&
    (selectedProviderId === "qwen" ||
      selectedProviderId === "glm" ||
      selectedProviderId === "gpt4o")
      ? psuModel
      : undefined;
  const overrideModel = useGeminiModel ?? usePsuModel;
  const effectiveModel = overrideModel ?? resolved.selection.selectedModel;

  // Tests inject `aiInvoker`; otherwise invoke the selected provider directly.
  const baseInvoke = injectedInvoker ?? resolved.provider.invoke;
  const invoke: ClaudeInvoker = overrideModel
    ? (prompt, callOpts) =>
        baseInvoke(prompt, { ...callOpts, model: overrideModel })
    : baseInvoke;
  const verified = isVerified(sessionId, true); // `true` updates the idle timeout

  // Chat doc attachments. PRIVACY: only an OWNER-VERIFIED requester's attachments
  // are read — a guest's file content (and its bytes) must never reach the model.
  // Stale/expired ids are silently skipped. Any vision-mode doc (image / scanned
  // PDF) forces the multimodal Gemini path; text-layer docs are injected as text
  // and use the already-resolved provider.
  const attachmentIds = verified ? (body.data.attachmentIds ?? []) : [];
  let attachmentDescriptors: ChatContext["attachments"] = [];
  const visionParts: VisionPart[] = [];
  if (attachmentIds.length > 0) {
    const loaded = (
      await Promise.all(attachmentIds.map((id) => loadChatAttachment(id)))
    ).filter((a): a is ChatAttachment => a !== null);
    attachmentDescriptors = loaded.map((a, i) => {
      if (a.source.mode === "vision") {
        visionParts.push(...a.source.parts);
        return { index: i + 1, mode: "vision" as const, source: a.kind, text: null };
      }
      return { index: i + 1, mode: "text" as const, source: a.kind, text: a.source.text };
    });
  }

  // A vision doc needs Gemini multimodal; refuse cleanly if it is not configured
  // rather than silently dropping the file the user is asking about.
  if (visionParts.length > 0 && !isGeminiConfigured()) {
    logActivity("chat.attachment.vision_unavailable", `parts=${visionParts.length}`);
    return reply.code(503).send({
      kind: "error",
      error: "อ่านรูป/ไฟล์สแกนต้องเปิด Gemini ก่อนค่ะ",
    });
  }

  // For a vision turn, bypass the resolved text provider and send the prompt +
  // file bytes to Gemini vision (honoring a per-turn Gemini model override).
  const finalInvoke: ClaudeInvoker =
    visionParts.length > 0
      ? (prompt, callOpts) =>
          geminiVisionExtract(prompt, visionParts, {
            timeoutMs: callOpts?.timeoutMs,
            model: useGeminiModel ?? callOpts?.model,
          })
      : invoke;

  const result = await runChat(message, finalInvoke, fetchGoogle, {
    verified,
    sessionId,
    originalMessage,
    attachments: attachmentDescriptors,
  });

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
    selectedModel: effectiveModel ?? null,
    requestedProvider: resolved.selection.requestedProvider ?? null,
    providerReason: resolved.selection.reason,
    approvals: result.approvals,
    calendarPlan: result.calendarPlan ?? null,
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
  return `ผู้ช่วย ${name} ยังไม่พร้อมใช้งานค่ะ ตอนนี้ยังไม่ได้ตั้งค่าไว้ ลองเลือก Claude แทนได้`;
}
