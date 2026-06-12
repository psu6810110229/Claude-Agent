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

/**
 * Pick a provider and record the reason. Phase 3 policy:
 * - no request -> default Claude.
 * - explicit Claude -> Claude.
 * - explicit Gemini -> Gemini when isGeminiConfigured(); otherwise fail closed
 *   with `"unavailable"` (never silently substitutes Claude).
 * - Auto mode resolves to the default provider; real Auto rules arrive in Phase 4.
 *
 * Fails closed by throwing `ProviderError` rather than substituting a different
 * provider, so a manual choice is never silently swapped.
 */
export function selectProvider(opts?: {
  mode?: AiProviderMode;
  requestedProvider?: AiProviderId;
}): ResolvedProvider {
  const mode: AiProviderMode = opts?.mode ?? "manual";
  const requestedProvider = opts?.requestedProvider;

  // Auto mode: Phase 1 has a single registered provider, so the deterministic
  // policy trivially resolves to the default. Real Auto rules arrive in Phase 4.
  const targetId: AiProviderId =
    mode === "auto"
      ? DEFAULT_PROVIDER_ID
      : (requestedProvider ?? DEFAULT_PROVIDER_ID);

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

  const reason =
    mode === "auto"
      ? `auto selected '${targetId}' (only configured provider)`
      : requestedProvider
        ? `manual selection '${targetId}'`
        : `default provider '${targetId}'`;

  return {
    provider,
    selection: {
      mode,
      requestedProvider,
      selectedProvider: provider.id,
      selectedModel: provider.model,
      reason,
    },
  };
}

/**
 * Resolve the default invoker used by routes when no invoker is injected.
 * Centralizing this here means the routes go through provider selection instead
 * of importing `realClaudeInvoker` directly.
 */
export function defaultInvoker(): ClaudeInvoker {
  return selectProvider().provider.invoke;
}
