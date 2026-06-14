import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ClaudeInvoker } from "./claudeClient.js";
import {
  GEMINI_ENABLED,
  GEMINI_API_KEY,
  GEMINI_MODEL,
  GEMINI_TIMEOUT_MS,
  isAllowedGeminiModel,
} from "../config.js";

/**
 * Roadmap 11 Phase 3 — Gemini provider.
 *
 * Wraps the Gemini API behind the same `ClaudeInvoker` signature so the
 * existing downstream pipeline (unwrapJsonOutput → JSON.parse → Zod) works
 * unchanged. The real invoker is never called from automated tests; tests
 * inject stubs through the provider/route layer.
 *
 * Safety boundaries:
 * - Disabled when GEMINI_ENABLED or GEMINI_API_KEY is missing — fails closed.
 * - GEMINI_API_KEY is never logged.
 * - Hard timeout via Promise.race; in-flight request abandoned on expiry.
 * - Returns raw text only; no parsing, no execution.
 */

export type GeminiFailureReason =
  | "disabled"
  | "timeout"
  | "rate-limit"
  | "api-error"
  | "empty";

export class GeminiError extends Error {
  constructor(
    public readonly reason: GeminiFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

/** True when both the feature flag and API key are present. */
export function isGeminiConfigured(): boolean {
  return GEMINI_ENABLED && GEMINI_API_KEY.length > 0;
}

/** Real invoker: calls the Gemini API. Gated by isGeminiConfigured(). */
export const realGeminiInvoker: ClaudeInvoker = async (prompt, opts) => {
  if (!isGeminiConfigured()) {
    throw new GeminiError(
      "disabled",
      GEMINI_ENABLED
        ? "Gemini is enabled but GEMINI_API_KEY is not set."
        : "Gemini AI is disabled. Set GEMINI_ENABLED=1 and GEMINI_API_KEY.",
    );
  }

  const timeoutMs = opts?.timeoutMs ?? GEMINI_TIMEOUT_MS;
  // Per-call model override, but only if it is on the allowlist; anything else
  // falls back to the configured default (never trust an arbitrary id).
  const modelId =
    opts?.model && isAllowedGeminiModel(opts.model) ? opts.model : GEMINI_MODEL;

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: modelId });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let text: string;
  try {
    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new GeminiError(
                "timeout",
                `Gemini timed out after ${timeoutMs}ms`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
    clearTimeout(timer);
    text = result.response.text();
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof GeminiError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (isRateLimitErrorMessage(msg)) {
      throw new GeminiError(
        "rate-limit",
        "Gemini API rate limit or quota was exceeded.",
      );
    }
    throw new GeminiError("api-error", "Gemini API request failed.");
  }

  if (!text.trim()) {
    throw new GeminiError("empty", "Gemini returned empty response.");
  }
  return text;
};

function isRateLimitErrorMessage(message: string): boolean {
  return (
    /\b429\b/.test(message) ||
    /too many requests/i.test(message) ||
    /quota/i.test(message) ||
    /rate.?limit/i.test(message)
  );
}
