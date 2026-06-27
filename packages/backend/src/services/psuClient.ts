import type { ClaudeInvoker } from "./claudeClient.js";
import type { StreamInvoker } from "./aiStreaming.js";
import {
  PSU_ENABLED,
  PSU_API_KEY,
  PSU_BASE_URL,
  PSU_TIMEOUT_MS,
  isAllowedPsuModel,
} from "../config.js";

/**
 * PSU AI gateway client (ai.psu.blue) — OpenAI-compatible.
 *
 * One key + base URL drives several upstream models (qwen / glm / gpt-4o-mini);
 * the model id selects the worker. Wrapped behind the same `ClaudeInvoker`
 * signature as the Claude/Gemini invokers so the existing downstream pipeline
 * (unwrapJsonOutput → JSON.parse → Zod) and every stubbed smoke test work
 * unchanged.
 *
 * Safety boundaries (mirror geminiClient):
 * - Disabled unless PSU_ENABLED=1 AND PSU_API_KEY set — fails closed.
 * - PSU_API_KEY is never logged.
 * - Hard timeout via AbortController; in-flight request aborted on expiry.
 * - `stream:false` — the gateway streams SSE by default; we want one JSON body
 *   here (live streaming is a later phase with a dedicated invoker).
 * - Returns the assistant message text ONLY; no parsing, no execution. The
 *   model's `reasoning` trace is intentionally discarded in this non-stream path.
 */

export type PsuFailureReason =
  | "disabled"
  | "bad-model"
  | "timeout"
  | "rate-limit"
  | "api-error"
  | "empty";

export class PsuError extends Error {
  constructor(
    public readonly reason: PsuFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "PsuError";
  }
}

/** True when both the feature flag and API key are present. */
export function isPsuConfigured(): boolean {
  return PSU_ENABLED && PSU_API_KEY.length > 0;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/**
 * Build a `ClaudeInvoker` bound to a default PSU model. A per-call `opts.model`
 * overrides it, but only if on the allowlist (otherwise fail closed — never
 * trust an arbitrary id). The single `prompt` string becomes one user message,
 * matching how the Claude/Gemini invokers receive their prompt.
 */
export function makePsuInvoker(defaultModel: string): ClaudeInvoker {
  return async (prompt, opts) => {
    if (!isPsuConfigured()) {
      throw new PsuError(
        "disabled",
        PSU_ENABLED
          ? "PSU is enabled but PSU_API_KEY is not set."
          : "PSU gateway is disabled. Set PSU_ENABLED=1 and PSU_API_KEY.",
      );
    }

    const requested = opts?.model;
    if (requested && !isAllowedPsuModel(requested)) {
      throw new PsuError(
        "bad-model",
        `PSU model '${requested}' is not on the allowlist.`,
      );
    }
    const model = requested ?? defaultModel;
    const timeoutMs = opts?.timeoutMs ?? PSU_TIMEOUT_MS;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${PSU_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PSU_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new PsuError("timeout", `PSU timed out after ${timeoutMs}ms`);
      }
      throw new PsuError("api-error", "PSU request failed.");
    }
    clearTimeout(timer);

    if (!res.ok) {
      // Never include the response body verbatim (avoid leaking anything); the
      // status code is enough to classify. 429 = rate limit / quota.
      if (res.status === 429) {
        throw new PsuError(
          "rate-limit",
          "PSU rate limit or quota was exceeded.",
        );
      }
      throw new PsuError("api-error", `PSU returned HTTP ${res.status}.`);
    }

    let body: ChatCompletionResponse;
    try {
      body = (await res.json()) as ChatCompletionResponse;
    } catch {
      throw new PsuError("api-error", "PSU returned a non-JSON response.");
    }

    const text = body.choices?.[0]?.message?.content ?? "";
    if (text.trim() === "") {
      throw new PsuError("empty", "PSU returned empty response.");
    }
    return text;
  };
}

interface StreamChunk {
  choices?: Array<{
    delta?: { reasoning?: string | null; content?: string | null };
  }>;
}

/**
 * Streaming variant: `stream:true` SSE. Maps `delta.reasoning` → live thinking
 * and `delta.content` → answer text (accumulated + emitted). Resolves with the
 * full answer for the JSON pipeline. Same model allowlist + timeout + fail-closed
 * discipline as the non-streaming invoker; the key is never logged.
 */
export function makePsuStreamInvoker(defaultModel: string): StreamInvoker {
  return async (prompt, sink, opts) => {
    if (!isPsuConfigured()) {
      throw new PsuError(
        "disabled",
        PSU_ENABLED
          ? "PSU is enabled but PSU_API_KEY is not set."
          : "PSU gateway is disabled. Set PSU_ENABLED=1 and PSU_API_KEY.",
      );
    }
    const requested = opts?.model;
    if (requested && !isAllowedPsuModel(requested)) {
      throw new PsuError("bad-model", `PSU model '${requested}' is not on the allowlist.`);
    }
    const model = requested ?? defaultModel;
    const timeoutMs = opts?.timeoutMs ?? PSU_TIMEOUT_MS;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${PSU_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PSU_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new PsuError("timeout", `PSU stream timed out after ${timeoutMs}ms`);
      }
      throw new PsuError("api-error", "PSU stream request failed.");
    }

    if (!res.ok) {
      clearTimeout(timer);
      if (res.status === 429) {
        throw new PsuError("rate-limit", "PSU rate limit or quota was exceeded.");
      }
      throw new PsuError("api-error", `PSU returned HTTP ${res.status}.`);
    }
    if (!res.body) {
      clearTimeout(timer);
      throw new PsuError("api-error", "PSU stream had no response body.");
    }

    let answer = "";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "" || data === "[DONE]") continue;
          let chunk: StreamChunk;
          try {
            chunk = JSON.parse(data) as StreamChunk;
          } catch {
            continue; // ignore keep-alive / partial frames
          }
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;
          if (typeof delta.reasoning === "string" && delta.reasoning) {
            sink({ type: "thinking", delta: delta.reasoning });
          }
          if (typeof delta.content === "string" && delta.content) {
            answer += delta.content;
            sink({ type: "content", delta: delta.content });
          }
        }
      }
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw new PsuError("timeout", `PSU stream timed out after ${timeoutMs}ms`);
      }
      throw new PsuError("api-error", "PSU stream read failed.");
    }
    clearTimeout(timer);
    if (answer.trim() === "") {
      throw new PsuError("empty", "PSU stream returned empty answer.");
    }
    return answer;
  };
}
