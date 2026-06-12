import { z } from "zod";
import { realClaudeInvoker, type ClaudeInvoker } from "./claudeClient.js";
import {
  realGeminiInvoker,
  isGeminiConfigured,
} from "./geminiClient.js";
import { CLAUDE_MODEL, GEMINI_MODEL } from "../config.js";

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
export const aiProviderIdSchema = z.enum(["claude", "gemini"]);
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
}

/** Transparent record of which provider was chosen and why. */
export interface ProviderSelection {
  mode: AiProviderMode;
  requestedProvider?: AiProviderId;
  selectedProvider: AiProviderId;
  selectedModel?: string;
  reason: string;
}

/** A selection paired with the resolved provider ready to invoke. */
export interface ResolvedProvider {
  selection: ProviderSelection;
  provider: AiProvider;
}

export type ProviderFailureReason = "unknown-provider" | "unavailable";

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
};

/** Provider registry. Both providers registered; availability gates access. */
const registry: Partial<Record<AiProviderId, AiProvider>> = {
  claude: claudeProvider,
  gemini: geminiProvider,
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
