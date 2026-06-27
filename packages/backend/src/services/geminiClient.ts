import { GoogleGenAI } from "@google/genai";
import type { ClaudeInvoker } from "./claudeClient.js";
import {
  GEMINI_ENABLED,
  GEMINI_API_KEY,
  GEMINI_MODEL,
  GEMINI_TIMEOUT_MS,
  isAllowedGeminiModel,
} from "../config.js";

/**
 * Gemini provider (migrated to @google/genai for native thinking support).
 *
 * Wraps the Gemini API behind the same `ClaudeInvoker` signature so the existing
 * downstream pipeline (unwrapJsonOutput → JSON.parse → Zod) works unchanged. The
 * real invoker is never called from automated tests; tests inject stubs through
 * the provider/route layer.
 *
 * Native thinking: when `opts.thinkingBudget` is set, the call enables Gemini's
 * thinking with that token ceiling (0 disables, undefined = model default). In
 * this non-streaming path the thought text is NOT requested (includeThoughts is
 * off) — only the final answer is returned. Surfacing the live thought channel
 * for the UI is a later (streaming) phase.
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

/** Resolve a requested model to an allowlisted id, else the configured default. */
function resolveModel(requested?: string): string {
  return requested && isAllowedGeminiModel(requested) ? requested : GEMINI_MODEL;
}

/**
 * Build the optional thinkingConfig for a call. Undefined budget → omit (model
 * default); a numeric budget (including 0 to disable) → explicit thinkingConfig.
 * `includeThoughts` stays false here: the non-streaming path only needs the
 * answer, never the thought text.
 */
function thinkingConfigFor(
  budget?: number,
): { thinkingBudget: number; includeThoughts: boolean } | undefined {
  if (budget === undefined) return undefined;
  return { thinkingBudget: budget, includeThoughts: false };
}

/** Run a generateContent call under a hard timeout; classify failures. */
async function runGenerate(
  client: GoogleGenAI,
  params: Parameters<GoogleGenAI["models"]["generateContent"]>[0],
  timeoutMs: number,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      client.models.generateContent(params),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new GeminiError("timeout", `Gemini timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    clearTimeout(timer);
    const text = result.text ?? "";
    if (!text.trim()) {
      throw new GeminiError("empty", "Gemini returned empty response.");
    }
    return text;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof GeminiError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (isRateLimitErrorMessage(msg)) {
      throw new GeminiError("rate-limit", "Gemini API rate limit or quota was exceeded.");
    }
    throw new GeminiError("api-error", "Gemini API request failed.");
  }
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
  const model = resolveModel(opts?.model);
  const thinkingConfig = thinkingConfigFor(opts?.thinkingBudget);

  const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return runGenerate(
    client,
    {
      model,
      contents: prompt,
      ...(thinkingConfig ? { config: { thinkingConfig } } : {}),
    },
    timeoutMs,
  );
};

/** One inline binary part for a multimodal request (image or PDF). */
export interface VisionPart {
  /** Base64-encoded file bytes (no data: prefix). */
  data: string;
  /** MIME type, e.g. "image/png", "image/jpeg", "application/pdf". */
  mimeType: string;
}

/**
 * A multimodal extraction call: a text instruction plus one or more inline
 * binary parts (image / PDF). Same fail-closed + timeout discipline as the text
 * invoker. Returns raw model text only — parsing/validation happens upstream.
 */
export type GeminiVisionInvoker = (
  prompt: string,
  parts: VisionPart[],
  opts?: { timeoutMs?: number; model?: string; thinkingBudget?: number },
) => Promise<string>;

export const geminiVisionExtract: GeminiVisionInvoker = async (
  prompt,
  parts,
  opts,
) => {
  if (!isGeminiConfigured()) {
    throw new GeminiError(
      "disabled",
      "Gemini vision is unavailable. Set GEMINI_ENABLED=1 and GEMINI_API_KEY.",
    );
  }
  if (parts.length === 0) {
    throw new GeminiError("empty", "No file parts supplied to vision extractor.");
  }

  const timeoutMs = opts?.timeoutMs ?? GEMINI_TIMEOUT_MS;
  const model = resolveModel(opts?.model);
  const thinkingConfig = thinkingConfigFor(opts?.thinkingBudget);

  const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const contents = [
    {
      role: "user",
      parts: [
        { text: prompt },
        ...parts.map((p) => ({
          inlineData: { data: p.data, mimeType: p.mimeType },
        })),
      ],
    },
  ];

  return runGenerate(
    client,
    {
      model,
      contents,
      ...(thinkingConfig ? { config: { thinkingConfig } } : {}),
    },
    timeoutMs,
  );
};

function isRateLimitErrorMessage(message: string): boolean {
  return (
    /\b429\b/.test(message) ||
    /too many requests/i.test(message) ||
    /quota/i.test(message) ||
    /rate.?limit/i.test(message)
  );
}
