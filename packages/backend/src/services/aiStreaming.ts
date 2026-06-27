import type { ClaudeInvokeOptions, ClaudeInvoker } from "./claudeClient.js";

/**
 * Streaming primitives shared by the provider clients.
 *
 * The chat pipeline produces a JSON proposal that must be parsed as one whole
 * blob (it carries approvals), so the ANSWER is never streamed to the user token
 * by token. Instead a streaming invoke surfaces the model's live THINKING for
 * the UI while accumulating the answer text; the accumulated answer is then fed
 * into the existing unwrap → JSON.parse → Zod path unchanged.
 */

/** A single streamed delta: a slice of live thinking, or of the answer text. */
export interface StreamEvent {
  type: "thinking" | "content";
  delta: string;
}

/** Receives streamed deltas as they arrive (e.g. an SSE writer). */
export type ThinkingSink = (event: StreamEvent) => void;

/**
 * Streaming-capable invoke. Emits thinking/content deltas through `sink` and
 * resolves with the FULL accumulated content (the answer text / JSON blob) so
 * the caller can run the normal non-streaming parse pipeline on it.
 */
export type StreamInvoker = (
  prompt: string,
  sink: ThinkingSink,
  opts?: ClaudeInvokeOptions,
) => Promise<string>;

/**
 * Adapt a plain (non-streaming) `ClaudeInvoker` to the streaming shape: no
 * thinking is emitted, and the whole answer is emitted as a single content
 * delta once it resolves. Lets providers without a native stream (e.g. Claude)
 * still flow through the streaming endpoint.
 */
export function invokerToStream(invoke: ClaudeInvoker): StreamInvoker {
  return async (prompt, sink, opts) => {
    const answer = await invoke(prompt, opts);
    sink({ type: "content", delta: answer });
    return answer;
  };
}
