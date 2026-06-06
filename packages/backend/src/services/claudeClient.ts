import { execFile } from "node:child_process";
import {
  CLAUDE_BIN,
  CLAUDE_MODEL,
  CLAUDE_TIMEOUT_MS,
  CLAUDE_AI_ENABLED,
} from "../config.js";

/**
 * Controlled wrapper around `claude -p` (Step 6).
 *
 * Safety boundaries enforced here:
 * - Uses `execFile` (NOT a shell): the prompt is a single argv argument, so
 *   there is no shell interpolation / command injection surface.
 * - Hard timeout; the process is killed and the call fails closed on expiry.
 * - Does NOT forward `ANTHROPIC_API_KEY` to the child (the Claude CLI uses its
 *   own logged-in auth; we avoid leaking an ambient key into the subprocess).
 * - Returns raw stdout ONLY. It never parses, executes, or trusts the output —
 *   parsing/validation happens upstream against strict Zod schemas.
 */

export type ClaudeFailureReason =
  | "disabled"
  | "timeout"
  | "spawn"
  | "nonzero-exit"
  | "empty";

export class ClaudeError extends Error {
  constructor(
    public readonly reason: ClaudeFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "ClaudeError";
  }
}

/** Per-call options for an invocation. */
export interface ClaudeInvokeOptions {
  /** Override the hard timeout (ms) for this call. Defaults to CLAUDE_TIMEOUT_MS. */
  timeoutMs?: number;
}

/**
 * A function that takes a prompt (and optional per-call options) and resolves
 * with Claude's raw stdout. The options arg is optional so existing/stub
 * invokers that accept only a prompt remain compatible.
 */
export type ClaudeInvoker = (
  prompt: string,
  opts?: ClaudeInvokeOptions,
) => Promise<string>;

/**
 * Build a child env that deliberately drops sensitive Anthropic credentials so
 * they are never blindly forwarded into the spawned process.
 */
function sanitizedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

/** Real invoker: spawns the Claude CLI. Gated by CLAUDE_AI_ENABLED. */
export const realClaudeInvoker: ClaudeInvoker = (prompt, opts) =>
  new Promise<string>((resolve, reject) => {
    if (!CLAUDE_AI_ENABLED) {
      reject(
        new ClaudeError(
          "disabled",
          "AI command mode is disabled. Set CLAUDE_AGENT_AI_ENABLED=1 to enable.",
        ),
      );
      return;
    }

    const timeoutMs = opts?.timeoutMs ?? CLAUDE_TIMEOUT_MS;

    execFile(
      CLAUDE_BIN,
      ["--model", CLAUDE_MODEL, "-p", prompt],
      {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        env: sanitizedEnv(),
      },
      (err, stdout) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean };
          if (e.killed) {
            reject(
              new ClaudeError(
                "timeout",
                `claude -p timed out after ${timeoutMs}ms`,
              ),
            );
            return;
          }
          if (e.code === "ENOENT") {
            reject(
              new ClaudeError(
                "spawn",
                `Claude binary not found (CLAUDE_BIN='${CLAUDE_BIN}').`,
              ),
            );
            return;
          }
          reject(
            new ClaudeError("nonzero-exit", `claude -p failed: ${e.message}`),
          );
          return;
        }
        const out = stdout?.toString() ?? "";
        if (out.trim() === "") {
          reject(new ClaudeError("empty", "claude -p returned empty output."));
          return;
        }
        resolve(out);
      },
    );
  });
