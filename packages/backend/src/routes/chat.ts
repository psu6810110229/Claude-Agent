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
import type { ClaudeInvoker, ClaudeInvokeOptions } from "../services/claudeClient.js";
import {
  selectProvider,
  routeChat,
  resolveStreamInvoker,
  otherAvailableProvider,
  getProvider,
  ProviderError,
  type AiProviderId,
  type AiProviderMode,
  type AiProvider,
  type ResolvedProvider,
} from "../services/aiProvider.js";
import { isPsuConfigured } from "../services/psuClient.js";
import { invokerToStream, type ThinkingSink } from "../services/aiStreaming.js";
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
import { getRecentChatJobProgress } from "../services/activeJob.js";
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

  app.post("/api/chat/stream", async (req, reply) =>
    handleChatStream(req, opts.aiInvoker, fetchGoogle, reply),
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

/** Everything the chat pipeline needs after request parsing + provider routing. */
interface ChatPrepOk {
  ok: true;
  message: string;
  originalMessage: string;
  sessionId?: string;
  mode: AiProviderMode;
  resolved: ResolvedProvider;
  provider: AiProvider;
  verified: boolean;
  effectiveModel?: string;
  extraOpts: ClaudeInvokeOptions;
  useGeminiModel?: string;
  thinkingBudget?: number;
  visionParts: VisionPart[];
  attachmentDescriptors: ChatContext["attachments"];
  /** Plain (non-streaming) invoke with model/budget overrides already applied. */
  invoke: ClaudeInvoker;
}
interface ChatPrepError {
  ok: false;
  code: number;
  body: Record<string, unknown>;
}
type ChatPrep = ChatPrepOk | ChatPrepError;

/**
 * Shared pre-invoke work for BOTH the JSON and the SSE chat endpoints: parse,
 * inline owner-unlock, provider routing, model/budget overrides, attachment +
 * vision loading. Keeping it in one place means the security-sensitive unlock
 * and the routing/guard logic can never drift between the two endpoints.
 */
async function prepareChat(
  req: import("fastify").FastifyRequest,
  injectedInvoker: ClaudeInvoker | undefined,
): Promise<ChatPrep> {
  const body = chatRequestSchema.safeParse(req.body);
  if (!body.success) {
    return { ok: false, code: 400, body: { kind: "error", error: body.error.issues[0].message } };
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

    if (OWNER_PIN && cleanMsg === OWNER_PIN.trim().toLowerCase()) {
      matchedInline = true;
      unlockSecret = OWNER_PIN;
      removeLength = cleanMsg.length;
    } else {
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
          remainder = "ตอบกลับสั้นๆ ว่ายืนยันตัวตนสำเร็จแล้วและพร้อมดำเนินการต่อ";
        }
        message = `ผู้ใช้เพิ่งยืนยันตัวตนด้วยรหัสสำเร็จ ตอนนี้เข้าถึงข้อมูลส่วนตัวได้แล้ว ให้ดำเนินการต่อจากคำขอนี้: ${remainder}`;
      }
    }
  }

  logActivity("chat.message.received", message.slice(0, 120));

  // Auto mode routes through the multi-model intent router ONLY when the PSU
  // gateway is configured; otherwise it falls back to the original claude/gemini
  // auto policy so existing behavior (and smoke tests) is intact.
  const hasFiles = (body.data.attachmentIds?.length ?? 0) > 0;
  let resolved: ResolvedProvider;
  try {
    resolved =
      mode === "auto" && isPsuConfigured()
        ? routeChat({ message, hasFiles })
        : selectProvider({ mode, requestedProvider, message });
  } catch (err) {
    if (err instanceof ProviderError) {
      logActivity("ai.provider.unavailable", `requested '${requestedProvider}': ${err.reason} — ${err.message}`);
      const forbidden = err.reason === "schedule-forbidden";
      return {
        ok: false,
        code: forbidden ? 400 : 503,
        body: {
          kind: "error",
          error: forbidden
            ? "โมเดลนี้ไว้คุยเล่นเท่านั้น ใช้กับเรื่องตาราง/งานสำคัญไม่ได้ค่ะ"
            : providerUnavailableMessage(requestedProvider),
          requestedProvider: requestedProvider ?? null,
          reason: err.reason,
        },
      };
    }
    throw err;
  }

  logActivity("ai.provider.selected", resolved.selection.reason);

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
  const thinkingBudget =
    selectedProviderId === "gemini" ? resolved.selection.thinkingBudget : undefined;

  const baseInvoke = injectedInvoker ?? resolved.provider.invoke;
  const extraOpts: ClaudeInvokeOptions = {};
  if (overrideModel) extraOpts.model = overrideModel;
  if (thinkingBudget !== undefined) extraOpts.thinkingBudget = thinkingBudget;
  const invoke: ClaudeInvoker =
    Object.keys(extraOpts).length > 0
      ? (prompt, callOpts) => baseInvoke(prompt, { ...callOpts, ...extraOpts })
      : baseInvoke;
  const verified = isVerified(sessionId, true); // `true` updates the idle timeout

  // Chat doc attachments. PRIVACY: only an OWNER-VERIFIED requester's attachments
  // are read. Stale/expired ids are silently skipped.
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

  if (visionParts.length > 0 && !isGeminiConfigured()) {
    logActivity("chat.attachment.vision_unavailable", `parts=${visionParts.length}`);
    return {
      ok: false,
      code: 503,
      body: { kind: "error", error: "อ่านรูป/ไฟล์สแกนต้องเปิด Gemini ก่อนค่ะ" },
    };
  }

  return {
    ok: true,
    message,
    originalMessage,
    sessionId,
    mode,
    resolved,
    provider: resolved.provider,
    verified,
    effectiveModel,
    extraOpts,
    useGeminiModel,
    thinkingBudget,
    visionParts,
    attachmentDescriptors,
    invoke,
  };
}

/** A non-streaming invoke that routes a vision turn to Gemini multimodal. */
function finalInvokeFor(prep: ChatPrepOk): ClaudeInvoker {
  if (prep.visionParts.length === 0) return prep.invoke;
  return (prompt, callOpts) =>
    geminiVisionExtract(prompt, prep.visionParts, {
      timeoutMs: callOpts?.timeoutMs,
      model: prep.useGeminiModel ?? callOpts?.model,
      thinkingBudget: prep.thinkingBudget ?? callOpts?.thinkingBudget,
    });
}

/** Map a runChat result + prep into a {code, body} response (shared by both endpoints). */
function chatResultResponse(
  result: Awaited<ReturnType<typeof runChat>>,
  prep: ChatPrepOk,
): { code: number; body: Record<string, unknown> } {
  const { mode, resolved, effectiveModel } = prep;
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
    return {
      code,
      body: {
        kind: "error",
        error: result.userMessage,
        mode,
        provider: resolved.selection.selectedProvider,
        fallbackProvider: fallback?.id ?? null,
      },
    };
  }

  if (result.kind === "rejected") {
    logActivity("chat.message.rejected", result.message);
    return { code: 400, body: { kind: "error", error: result.message } };
  }

  for (const approval of result.approvals) {
    logActivity(
      "chat.message.proposed",
      `approval #${approval.id} (${approval.action_type}) from chat`,
    );
  }
  logActivity("chat.message.replied", `${result.approvals.length} proposal(s)`);

  return {
    code: 201,
    body: {
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
      sourcePreviews: result.sourcePreviews ?? [],
      clarification: result.clarification,
      clarification_choices: result.clarificationChoices,
      notes: result.notes,
      verificationRequired: result.verificationRequired || undefined,
      sensitivity: result.sensitivity ?? "normal",
      jobProgress: safeJobProgress(),
    },
  };
}

function safeJobProgress(): ReturnType<typeof getRecentChatJobProgress> {
  try {
    return getRecentChatJobProgress(5, 6);
  } catch {
    return [];
  }
}

async function handleChat(
  req: import("fastify").FastifyRequest,
  injectedInvoker: ClaudeInvoker | undefined,
  fetchGoogle: GoogleEventsFetcher,
  reply: FastifyReply,
): Promise<unknown> {
  const prep = await prepareChat(req, injectedInvoker);
  if (!prep.ok) return reply.code(prep.code).send(prep.body);

  const result = await runChat(prep.message, finalInvokeFor(prep), fetchGoogle, {
    verified: prep.verified,
    sessionId: prep.sessionId,
    originalMessage: prep.originalMessage,
    attachments: prep.attachmentDescriptors,
  });

  const { code, body } = chatResultResponse(result, prep);
  return reply.code(code).send(body);
}

/**
 * Streaming variant of POST /api/chat. Streams the model's live THINKING as SSE
 * `thinking` events while the answer is accumulated; once the full JSON answer is
 * parsed through the SAME approval-gated pipeline, a single `done` (or `error`)
 * event carries the final payload — identical in shape to the JSON endpoint.
 * The answer itself is never streamed token-by-token (it must parse as one blob).
 */
async function handleChatStream(
  req: import("fastify").FastifyRequest,
  injectedInvoker: ClaudeInvoker | undefined,
  fetchGoogle: GoogleEventsFetcher,
  reply: FastifyReply,
): Promise<unknown> {
  const prep = await prepareChat(req, injectedInvoker);
  if (!prep.ok) return reply.code(prep.code).send(prep.body);

  // Switch to manual SSE on the raw socket; fastify must not also respond.
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const send = (event: string, data: unknown): void => {
    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Diagnostic: count thinking deltas per turn so we can confirm WHICH provider
  // actually streamed reasoning. Counts + char total only — never the content
  // (privacy rule: no reasoning bodies in logs).
  let thinkingDeltas = 0;
  let thinkingChars = 0;
  const sink: ThinkingSink = (e) => {
    if (e.type === "thinking") {
      thinkingDeltas += 1;
      thinkingChars += e.delta.length;
      send("thinking", { delta: e.delta });
    }
  };

  // A vision turn has no native thinking stream → adapt the (non-stream) vision
  // invoke. Otherwise use the provider's streaming invoke, or an injected stub.
  const streamInvoker =
    prep.visionParts.length > 0 || injectedInvoker
      ? invokerToStream(finalInvokeFor(prep))
      : resolveStreamInvoker(prep.provider);
  const streamingInvoke: ClaudeInvoker = (prompt, callOpts) =>
    streamInvoker(prompt, sink, { ...callOpts, ...prep.extraOpts });

  try {
    const result = await runChat(prep.message, streamingInvoke, fetchGoogle, {
      verified: prep.verified,
      sessionId: prep.sessionId,
      originalMessage: prep.originalMessage,
      attachments: prep.attachmentDescriptors,
    });
    const { body } = chatResultResponse(result, prep);
    logActivity(
      "chat.stream.thinking",
      `provider=${prep.resolved.selection.selectedProvider} model=${prep.effectiveModel ?? "default"} deltas=${thinkingDeltas} chars=${thinkingChars}`,
    );
    send("done", body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logActivity("chat.stream.failed", msg.slice(0, 120));
    send("error", { kind: "error", error: "เกิดข้อผิดพลาดระหว่างประมวลผลค่ะ" });
  } finally {
    raw.end();
  }
  return reply;
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
