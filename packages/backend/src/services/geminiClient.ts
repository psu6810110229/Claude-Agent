import { GoogleGenAI } from "@google/genai";
import type { ClaudeInvoker } from "./claudeClient.js";
import type { StreamInvoker } from "./aiStreaming.js";
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

/**
 * Default streaming thinking budget (tokens) when the caller passes none. A
 * manual Gemini pick (esp. flash-lite) leaves the budget undefined; "lite"
 * models default to ~0 thinking, so they'd stream NO thought parts. Setting a
 * floor makes the live-thinking UI actually populate for manual turns. The auto
 * router always passes an explicit budget (0 / 1024 / 2048), so this only
 * affects the manual/undefined path.
 */
const DEFAULT_STREAM_THINKING_BUDGET = 1024;

/**
 * Streaming thinkingConfig: for the live-thinking UI we DO want thought parts,
 * so includeThoughts is on unless thinking is explicitly disabled (budget 0).
 * An undefined budget falls back to DEFAULT_STREAM_THINKING_BUDGET so manual
 * picks still produce visible thinking.
 */
function streamThinkingConfig(
  budget?: number,
): { thinkingBudget: number; includeThoughts: boolean } {
  if (budget === 0) return { thinkingBudget: 0, includeThoughts: false };
  const effective = budget ?? DEFAULT_STREAM_THINKING_BUDGET;
  return { thinkingBudget: effective, includeThoughts: true };
}

/**
 * Streaming invoker: emits live thinking (thought parts) + answer deltas, and
 * resolves with the full accumulated answer text for the JSON pipeline. Hard
 * timeout via AbortController on the genai stream.
 */
export const geminiStreamInvoker: StreamInvoker = async (prompt, sink, opts) => {
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
  const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let answer = "";
  try {
    const stream = await client.models.generateContentStream({
      model,
      contents: prompt,
      config: {
        thinkingConfig: streamThinkingConfig(opts?.thinkingBudget),
        abortSignal: controller.signal,
      },
    });
    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const p of parts) {
        const text = p.text ?? "";
        if (!text) continue;
        if (p.thought) {
          sink({ type: "thinking", delta: text });
        } else {
          answer += text;
          sink({ type: "content", delta: text });
        }
      }
    }
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new GeminiError("timeout", `Gemini stream timed out after ${timeoutMs}ms`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (isRateLimitErrorMessage(msg)) {
      throw new GeminiError("rate-limit", "Gemini API rate limit or quota was exceeded.");
    }
    throw new GeminiError("api-error", "Gemini stream request failed.");
  }
  clearTimeout(timer);
  if (!answer.trim()) {
    throw new GeminiError("empty", "Gemini stream returned empty answer.");
  }
  return answer;
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
