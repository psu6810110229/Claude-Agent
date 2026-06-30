/**
 * Safe provider comparison runner for conversation reference evals.
 *
 * Default mode is offline: validate fixtures and report provider evals as
 * skipped. Live calls require CONVERSATION_REFERENCE_LIVE_EVAL=1 plus the
 * provider's normal enable flag and API key in the process environment.
 *
 * This script never reads .env, DB contents, Google data, or LINE exports.
 */

import {
  GEMINI_MODEL,
  PSU_QWEN_MODEL,
} from "../src/config.js";
import {
  ConversationReferenceActualSchema,
  evaluateConversationReferenceActual,
  validateConversationReferenceSuite,
  type ConversationReferenceCase,
} from "../src/evals/conversationReferenceEval.js";
import { conversationReferenceBaselineSuite } from "../src/evals/conversationReferenceFixtures.js";
import {
  isGeminiConfigured,
  realGeminiInvoker,
} from "../src/services/geminiClient.js";
import {
  isPsuConfigured,
  makePsuInvoker,
} from "../src/services/psuClient.js";

type ProviderEvalRow = {
  provider: string;
  model: string;
  status: "skipped" | "passed" | "failed";
  cases: number;
  passed: number;
  latency_ms: number | null;
  reason?: string;
};

function liveEvalEnabled(): boolean {
  return /^(1|true)$/i.test(process.env.CONVERSATION_REFERENCE_LIVE_EVAL ?? "");
}

function liveLimit(total: number): number {
  const raw = Number(process.env.CONVERSATION_REFERENCE_EVAL_LIMIT ?? "3");
  if (!Number.isFinite(raw) || raw <= 0) return Math.min(total, 3);
  return Math.min(total, Math.floor(raw));
}

function buildPrompt(testCase: ConversationReferenceCase): string {
  return [
    "You are evaluating conversation reference resolution for a local-first personal assistant.",
    "Return JSON only. Do not include explanations.",
    "Choose whether the latest user message should reuse a previous evidence scope, run a fresh search, ask a clarification, or be unsupported.",
    "",
    "Allowed JSON shape:",
    '{"behavior":"reuse_scope|fresh_search|clarify|unsupported","source":"google_drive|gmail|line_export|google_calendar|local_reminder|google_contacts|mixed","scope_id":"optional","count":0,"preview_item_ids":[],"clarification":false,"approval_required":false}',
    "",
    `Case id: ${testCase.id}`,
    `Title: ${testCase.title}`,
    "Turns:",
    JSON.stringify(testCase.turns, null, 2),
    "Evidence scopes:",
    JSON.stringify(testCase.scopes, null, 2),
  ].join("\n");
}

function parseProviderActual(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("provider returned non-JSON output");
  }
}

async function runProvider(
  provider: {
    provider: string;
    model: string;
    configured: boolean;
    invoke: (prompt: string) => Promise<string>;
  },
  cases: ConversationReferenceCase[],
): Promise<ProviderEvalRow> {
  if (!liveEvalEnabled()) {
    return {
      provider: provider.provider,
      model: provider.model,
      status: "skipped",
      cases: 0,
      passed: 0,
      latency_ms: null,
      reason: "set CONVERSATION_REFERENCE_LIVE_EVAL=1 to enable live calls",
    };
  }

  if (!provider.configured) {
    return {
      provider: provider.provider,
      model: provider.model,
      status: "skipped",
      cases: 0,
      passed: 0,
      latency_ms: null,
      reason: "provider enable flag or API key is not set in this process",
    };
  }

  const started = Date.now();
  let passed = 0;
  const failures: string[] = [];

  for (const testCase of cases) {
    try {
      const text = await provider.invoke(buildPrompt(testCase));
      const actual = ConversationReferenceActualSchema.parse(
        parseProviderActual(text),
      );
      const result = evaluateConversationReferenceActual(testCase, actual);
      if (result.passed) {
        passed += 1;
      } else {
        failures.push(`${testCase.id}: ${result.failures.join("; ")}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${testCase.id}: ${message}`);
    }
  }

  return {
    provider: provider.provider,
    model: provider.model,
    status: failures.length === 0 ? "passed" : "failed",
    cases: cases.length,
    passed,
    latency_ms: Date.now() - started,
    reason: failures.slice(0, 3).join(" | ") || undefined,
  };
}

async function main(): Promise<void> {
  const suite = validateConversationReferenceSuite(
    conversationReferenceBaselineSuite,
  );
  const cases = suite.cases.slice(0, liveLimit(suite.cases.length));

  const rows = await Promise.all([
    runProvider(
      {
        provider: "gemini",
        model: GEMINI_MODEL,
        configured: isGeminiConfigured(),
        invoke: (prompt) =>
          realGeminiInvoker(prompt, {
            model: GEMINI_MODEL,
            timeoutMs: 60_000,
            thinkingBudget:
              process.env.GEMINI_THINKING_BUDGET === undefined
                ? undefined
                : Number(process.env.GEMINI_THINKING_BUDGET),
          }),
      },
      cases,
    ),
    runProvider(
      {
        provider: "qwen",
        model: PSU_QWEN_MODEL,
        configured: isPsuConfigured(),
        invoke: makePsuInvoker(PSU_QWEN_MODEL),
      },
      cases,
    ),
  ]);

  console.log("Conversation reference provider eval");
  console.log(`fixture_cases=${suite.cases.length}`);
  console.table(rows);

  const failed = rows.some((row) => row.status === "failed");
  if (failed) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(
    "Conversation reference provider eval FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});

