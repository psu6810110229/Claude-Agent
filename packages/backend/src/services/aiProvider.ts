import { z } from "zod";
import { realClaudeInvoker, type ClaudeInvoker } from "./claudeClient.js";
import {
  realGeminiInvoker,
  geminiStreamInvoker,
  isGeminiConfigured,
} from "./geminiClient.js";
import {
  makePsuInvoker,
  makePsuStreamInvoker,
  isPsuConfigured,
} from "./psuClient.js";
import {
  type StreamInvoker,
  invokerToStream,
} from "./aiStreaming.js";
import {
  CLAUDE_MODEL,
  GEMINI_MODEL,
  PSU_QWEN_MODEL,
  PSU_GLM_MODEL,
  PSU_GPT4O_MODEL,
} from "../config.js";

/**
 * Roadmap 11, Phase 1 — Provider abstraction.
 *
 * The backend remains the orchestrator; AI providers are interchangeable
 * workers that return into the SAME validated, approval-gated proposal path.
 * This phase introduces the provider interface and wraps the existing Claude
 * `claude -p` runtime as `claudeProvider`. No Gemini call, no secrets, no
 * change to approval/validation behavior. Default selection stays Claude.
 *
 * A provider's `invoke` is a `ClaudeInvoker` (prompt + opts -> raw string):
 * keeping the existing signature means the downstream pipeline
 * (unwrapJsonOutput -> JSON.parse -> Zod) and every stubbed smoke test work
 * unchanged. Richer per-call result metadata (ProposalResult) is deferred to
 * later phases where it is actually consumed.
 */

/**
 * Single source of truth for provider/mode ids. Request schemas (e.g.
 * `chatRequestSchema`) import these zod enums so the HTTP contract and the
 * provider registry can never drift apart.
 */
export const aiProviderIdSchema = z.enum([
  "claude",
  "gemini",
  "qwen",
  "glm",
  "gpt4o",
]);
export const aiProviderModeSchema = z.enum(["manual", "auto"]);

export type AiProviderId = z.infer<typeof aiProviderIdSchema>;
export type AiProviderMode = z.infer<typeof aiProviderModeSchema>;

/** A pluggable AI proposal worker. `invoke` returns raw provider output. */
export interface AiProvider {
  readonly id: AiProviderId;
  /** Model identifier this provider invokes, when known. */
  readonly model?: string;
  /** Whether the provider is configured/usable right now. */
  isAvailable(): boolean;
  /** Invoke the provider for a single proposal turn. */
  invoke: ClaudeInvoker;
  /**
   * Native streaming invoke (live thinking + answer deltas), when the provider
   * supports it. Providers without one (e.g. Claude) are adapted via
   * `invokerToStream` in `resolveStreamInvoker`.
   */
  streamInvoke?: StreamInvoker;
}

/** Transparent record of which provider was chosen and why. */
export interface ProviderSelection {
  mode: AiProviderMode;
  requestedProvider?: AiProviderId;
  selectedProvider: AiProviderId;
  selectedModel?: string;
  reason: string;
  /** Intent class the auto router classified this turn as (auto mode only). */
  intent?: ChatIntent;
  /**
   * Gemini thinking-budget hint (tokens). Consumed by the Gemini thinking path
   * in a later phase; carried here so the router decides depth in one place.
   * 0 = no thinking (trivial/casual). Undefined for non-Gemini selections.
   */
  thinkingBudget?: number;
  /**
   * Whether this turn SHOULD stream a live thinking channel. Recorded now;
   * the streaming endpoint that consumes it lands in a later phase.
   */
  stream?: boolean;
}

/** A selection paired with the resolved provider ready to invoke. */
export interface ResolvedProvider {
  selection: ProviderSelection;
  provider: AiProvider;
}

export type ProviderFailureReason =
  | "unknown-provider"
  | "unavailable"
  | "schedule-forbidden";

export class ProviderError extends Error {
  constructor(
    public readonly reason: ProviderFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/**
 * Claude provider: thin wrapper over the existing `claude -p` runtime. The
 * underlying invoker already gates on `isClaudeAiEnabled()` and fails closed,
 * so `isAvailable()` mirrors that gate without duplicating spawn logic.
 */
export const claudeProvider: AiProvider = {
  id: "claude",
  model: CLAUDE_MODEL,
  isAvailable: () => true,
  invoke: realClaudeInvoker,
};

/**
 * Gemini provider (Phase 3). `isAvailable()` delegates to `isGeminiConfigured()`
 * so requesting Gemini without GEMINI_ENABLED + GEMINI_API_KEY fails closed with
 * a clear `"unavailable"` reason rather than silently falling back to Claude.
 */
export const geminiProvider: AiProvider = {
  id: "gemini",
  model: GEMINI_MODEL,
  isAvailable: isGeminiConfigured,
  invoke: realGeminiInvoker,
  streamInvoke: geminiStreamInvoker,
};

/**
 * PSU gateway providers — one OpenAI-compatible client, three model bindings.
 * `qwen`/`glm` are the smart/deep reasoning tier; `gpt4o` is casual-only (the
 * router must never send it schedule/critical work). All gated by isPsuConfigured.
 */
export const qwenProvider: AiProvider = {
  id: "qwen",
  model: PSU_QWEN_MODEL,
  isAvailable: isPsuConfigured,
  invoke: makePsuInvoker(PSU_QWEN_MODEL),
  streamInvoke: makePsuStreamInvoker(PSU_QWEN_MODEL),
};

export const glmProvider: AiProvider = {
  id: "glm",
  model: PSU_GLM_MODEL,
  isAvailable: isPsuConfigured,
  invoke: makePsuInvoker(PSU_GLM_MODEL),
  streamInvoke: makePsuStreamInvoker(PSU_GLM_MODEL),
};

export const gpt4oProvider: AiProvider = {
  id: "gpt4o",
  model: PSU_GPT4O_MODEL,
  isAvailable: isPsuConfigured,
  invoke: makePsuInvoker(PSU_GPT4O_MODEL),
  streamInvoke: makePsuStreamInvoker(PSU_GPT4O_MODEL),
};

/** Provider registry. All providers registered; availability gates access. */
const registry: Partial<Record<AiProviderId, AiProvider>> = {
  claude: claudeProvider,
  gemini: geminiProvider,
  qwen: qwenProvider,
  glm: glmProvider,
  gpt4o: gpt4oProvider,
};

/** Look up a registered provider by id (undefined if not registered yet). */
export function getProvider(id: AiProviderId): AiProvider | undefined {
  return registry[id];
}

/** The default provider for the current phase. */
export const DEFAULT_PROVIDER_ID: AiProviderId = "claude";

/** Coarse Auto-mode routing class for an incoming task. */
export type TaskComplexity = "low-risk" | "complex";

/**
 * Patterns that mark a task as low-risk enough for the cheaper/faster model in
 * Auto mode (summarize / rewrite / translate style work). Deterministic and
 * conservative: anything that does NOT clearly match is treated as "complex"
 * and routed to Claude. Thai keywords included since the user writes Thai.
 */
const LOW_RISK_PATTERNS: RegExp[] = [
  /\bsummar(y|ise|ize|ies)\b/i,
  /\brewrite\b/i,
  /\brephrase\b/i,
  /\bparaphrase\b/i,
  /\btranslate\b/i,
  /\bproofread\b/i,
  /\btl;?dr\b/i,
  /\brecap\b/i,
  /\bshorten\b/i,
  /สรุป/,
  /แปล/,
];

/**
 * Deterministic Auto-mode task classifier. Returns "low-risk" only when the
 * message clearly matches a summarize/rewrite-style pattern; otherwise
 * "complex". Defaulting to "complex" keeps Claude as the safe choice for
 * anything ambiguous.
 */
export function classifyTaskComplexity(
  message: string | undefined,
): TaskComplexity {
  if (!message) return "complex";
  return LOW_RISK_PATTERNS.some((re) => re.test(message))
    ? "low-risk"
    : "complex";
}

function resolve(
  provider: AiProvider,
  selection: ProviderSelection,
): ResolvedProvider {
  return { provider, selection };
}

/* ----------------------------------------------------------------------------
 * Multi-model auto router (intent tiers).
 *
 * Deterministic, no AI call. Classifies the turn into one tier, then picks the
 * best AVAILABLE provider for it with a safe fallback chain so the router never
 * fails when a tier's preferred provider is unconfigured. Safety: gpt4o is
 * casual-only and never appears in the schedule/deep fallback chains.
 * ------------------------------------------------------------------------- */

/** Intent tier for a chat turn. */
export type ChatIntent = "casual" | "trivial" | "schedule" | "deep";

/** Schedule/calendar/task signals (Thai + English). */
const SCHEDULE_PATTERNS: RegExp[] = [
  /ตาราง|ปฏิทิน|นัด|ประชุม|เดดไลน์|deadline|ส่งงาน|การบ้าน|งานค้าง|แลป|\blab\b|เลคเชอร์|lecture|เรียน|คาบ|workshop|reminder|เตือน|กี่โมง|ว่างไหม|ว่างมั้ย/i,
  /วันนี้|พรุ่งนี้|มะรืน|เมื่อวาน|สัปดาห์|อาทิตย์หน้า|เดือนหน้า|จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์/i,
  /\bschedule\b|\bcalendar\b|\bevent\b|\bmeeting\b|\btoday\b|\btomorrow\b/i,
];

/** Deep-reasoning signals: multi-step / analytical / planning. */
const DEEP_PATTERNS: RegExp[] = [
  /วิเคราะห์|ทำไม|เพราะอะไร|ควร.*(ก่อน|ดี|ไหม)|วางแผน|จัดการให้|เปรียบเทียบ|ผลกระทบ|trade.?off|prioriti|เชื่อมโยง|หลายเงื่อนไข/i,
];

/** Trivial greeting/ack openers. */
// No trailing \b: an ASCII word boundary does not fire after a Thai glyph
// (e.g. "สวัสดีครับ"), so it would wrongly reject Thai greetings. The
// length<=24 guard in classifyIntent keeps this from over-matching.
const TRIVIAL_PATTERN =
  /^(สวัสดี|หวัดดี|ดีครับ|ดีค่ะ|hello|hi|hey|ขอบคุณ|ขอบใจ|thanks|thank you|โอเค|okay?|ครับ|ค่ะ|จ้า)/i;

/**
 * Classify a turn into an intent tier. Conservative on the casual side: a turn
 * with ANY schedule/task signal is never casual (gpt4o must not touch it), and a
 * missing/empty message defaults to "schedule" (the safe task tier), never casual.
 */
export function classifyIntent(
  message: string | undefined,
  ctx?: { hasFiles?: boolean },
): ChatIntent {
  if (ctx?.hasFiles) return "schedule"; // a file is real work, never casual
  if (!message) return "schedule";
  const m = message.trim();
  const isSchedule = SCHEDULE_PATTERNS.some((re) => re.test(m));
  const isDeep = m.length > 160 || DEEP_PATTERNS.some((re) => re.test(m));
  if (isSchedule) return isDeep ? "deep" : "schedule";
  if (isDeep) return "deep";
  if (m.length <= 24 && TRIVIAL_PATTERN.test(m)) return "trivial";
  return "casual";
}

/** Gemini thinking budget per tier (tokens). 0 = no thinking. */
const TIER_THINKING_BUDGET: Record<ChatIntent, number> = {
  casual: 0,
  trivial: 0,
  schedule: 1024,
  deep: 2048,
};

/**
 * Ordered provider preference per tier. gpt4o is ONLY in the casual chain;
 * schedule/deep deliberately exclude it. claude is the universal safe tail.
 */
const TIER_PREFERENCE: Record<ChatIntent, AiProviderId[]> = {
  casual: ["gpt4o", "gemini", "claude"],
  trivial: ["gemini", "gpt4o", "claude"],
  schedule: ["gemini", "qwen", "glm", "claude"],
  deep: ["gemini", "qwen", "glm", "claude"],
};

/** First available provider in an ordered preference list. */
function firstAvailable(ids: AiProviderId[]): AiProvider | undefined {
  for (const id of ids) {
    const p = registry[id];
    if (p?.isAvailable()) return p;
  }
  return undefined;
}

/**
 * Auto router: classify intent, pick the best available provider for the tier,
 * and record model + thinking budget + stream hint. Never throws — claude is the
 * always-available safe tail. A turn with files forces the multimodal Gemini
 * preference (the vision path / refusal is handled in the chat route).
 */
export function routeChat(opts: {
  message?: string;
  hasFiles?: boolean;
}): ResolvedProvider {
  const intent = classifyIntent(opts.message, { hasFiles: opts.hasFiles });
  const preference = opts.hasFiles
    ? (["gemini", "claude"] as AiProviderId[])
    : TIER_PREFERENCE[intent];

  const provider =
    firstAvailable(preference) ?? claudeProvider; // claude always available
  const budget =
    provider.id === "gemini" ? TIER_THINKING_BUDGET[intent] : undefined;

  return resolve(provider, {
    mode: "auto",
    selectedProvider: provider.id,
    selectedModel: provider.model,
    intent,
    thinkingBudget: budget,
    stream: intent === "schedule" || intent === "deep",
    reason: `auto: intent=${intent}${opts.hasFiles ? "+files" : ""} → ${provider.id} (${provider.model ?? "default"})`,
  });
}

/**
 * The other configured + available provider, if any. Used to surface a VISIBLE
 * Auto-mode fallback the user can retry with explicitly — never to switch
 * providers silently inside one request.
 */
export function otherAvailableProvider(
  excluding: AiProviderId,
): AiProvider | undefined {
  for (const id of ["claude", "gemini"] as AiProviderId[]) {
    if (id === excluding) continue;
    const p = registry[id];
    if (p?.isAvailable()) return p;
  }
  return undefined;
}

/**
 * Pick a provider and record the reason.
 *
 * Manual mode (Phase 2/3):
 * - no request -> default Claude.
 * - explicit Claude -> Claude.
 * - explicit Gemini -> Gemini when isGeminiConfigured(); otherwise fail closed
 *   with `"unavailable"` (never silently substitutes Claude).
 *
 * Auto mode (Phase 4) — transparent deterministic policy:
 * - low-risk summarize/rewrite task AND Gemini configured -> Gemini Flash.
 * - complex task, or Gemini unavailable -> Claude.
 * Every choice records a human-readable `reason`. Auto never throws: Claude is
 * always available as the safe default, so Auto degrades visibly, never blindly.
 *
 * Manual fails closed by throwing `ProviderError` rather than substituting a
 * different provider, so a manual choice is never silently swapped.
 */
export function selectProvider(opts?: {
  mode?: AiProviderMode;
  requestedProvider?: AiProviderId;
  message?: string;
}): ResolvedProvider {
  const mode: AiProviderMode = opts?.mode ?? "manual";
  const requestedProvider = opts?.requestedProvider;

  if (mode === "auto") {
    const gemini = registry.gemini;
    const complexity = classifyTaskComplexity(opts?.message);
    if (gemini?.isAvailable() && complexity === "low-risk") {
      return resolve(gemini, {
        mode,
        requestedProvider,
        selectedProvider: gemini.id,
        selectedModel: gemini.model,
        reason: `auto: low-risk task → ${gemini.id} (${gemini.model ?? "default"})`,
      });
    }
    const claude = registry.claude;
    if (!claude) {
      throw new ProviderError(
        "unknown-provider",
        "Claude provider is not registered.",
      );
    }
    const why = !gemini
      ? "gemini not registered"
      : !gemini.isAvailable()
        ? "gemini unavailable"
        : "complex task";
    return resolve(claude, {
      mode,
      requestedProvider,
      selectedProvider: claude.id,
      selectedModel: claude.model,
      reason: `auto: ${why} → ${claude.id}`,
    });
  }

  const targetId: AiProviderId = requestedProvider ?? DEFAULT_PROVIDER_ID;
  const provider = registry[targetId];
  if (!provider) {
    throw new ProviderError(
      "unknown-provider",
      `AI provider '${targetId}' is not available yet.`,
    );
  }
  if (!provider.isAvailable()) {
    throw new ProviderError(
      "unavailable",
      `AI provider '${targetId}' is not configured.`,
    );
  }

  // Safety: gpt4o is casual-only. Refuse it for schedule/deep work even when the
  // user picks it manually — never let the casual model touch the calendar.
  //
  // Block ONLY on a positive schedule/deep signal in a real message. The user
  // explicitly chose the casual model, so an empty/whitespace message must not
  // be blocked: classifyIntent(undefined|"") defaults to "schedule" as a safety
  // fallback for the AUTO router, which would otherwise wrongly forbid a manual
  // casual pick (and a blank turn carries no schedule intent anyway).
  if (targetId === "gpt4o") {
    const msg = opts?.message?.trim();
    if (msg) {
      const intent = classifyIntent(msg);
      if (intent === "schedule" || intent === "deep") {
        // Diagnostic (intent + length only — never the body, per privacy rules)
        // so a wrongly-blocked casual turn can be traced without logging content.
        throw new ProviderError(
          "schedule-forbidden",
          `gpt4o is casual-only and cannot handle schedule/critical requests. [intent=${intent} len=${msg.length}]`,
        );
      }
    }
  }

  return resolve(provider, {
    mode,
    requestedProvider,
    selectedProvider: provider.id,
    selectedModel: provider.model,
    reason: requestedProvider
      ? `manual selection '${targetId}'`
      : `default provider '${targetId}'`,
  });
}

/**
 * Resolve the default invoker used by routes when no invoker is injected.
 * Centralizing this here means the routes go through provider selection instead
 * of importing `realClaudeInvoker` directly.
 */
export function defaultInvoker(): ClaudeInvoker {
  return selectProvider().provider.invoke;
}

/**
 * Streaming invoker for a resolved provider: its native streaming invoke if it
 * has one, otherwise the plain invoke adapted into a (thinking-less) stream so
 * every provider flows through the streaming endpoint uniformly.
 */
export function resolveStreamInvoker(provider: AiProvider): StreamInvoker {
  return provider.streamInvoke ?? invokerToStream(provider.invoke);
}
