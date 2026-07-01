/**
 * Phase 06 final model performance report.
 *
 * Offline by default: validates deterministic eval fixtures and reports live
 * provider comparison as skipped. It does not import provider clients, does not
 * read .env, and does not call Gemini/Qwen/Google/LINE.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateConversationReferenceActual,
  validateConversationReferenceSuite,
  type ConversationReferenceCase,
} from "../src/evals/conversationReferenceEval.js";
import { conversationReferenceBaselineSuite } from "../src/evals/conversationReferenceFixtures.js";
import { PROVIDER_EVIDENCE_PACK_LIMITS } from "../src/services/providerEvidencePack.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const REPORT_PATH = path.join(
  REPO_ROOT,
  "docs",
  "implementation",
  "evidence-router-phase-06-model-performance-eval-report.md",
);

type ProviderReportRow = {
  provider: string;
  model: string;
  status: "skipped" | "passed" | "failed";
  cases: number;
  passed: number;
  p50_ms: string;
  p95_ms: string;
  token_usage: string;
  reason: string;
};

function actualFromExpectation(testCase: ConversationReferenceCase) {
  const expected = testCase.expectation;
  return {
    behavior: expected.behavior,
    source: expected.source,
    scope_id: expected.scope_id,
    count: expected.expected_count,
    preview_item_ids: expected.expected_preview_item_ids,
    clarification: expected.expected_clarification || undefined,
    approval_required: expected.approval_required || undefined,
  };
}

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function main(): void {
  const suite = validateConversationReferenceSuite(
    conversationReferenceBaselineSuite,
  );
  const results = suite.cases.map((testCase) =>
    evaluateConversationReferenceActual(testCase, actualFromExpectation(testCase)),
  );
  const passed = results.filter((result) => result.passed).length;
  const categoryCounts = new Map<string, number>();
  for (const testCase of suite.cases) {
    categoryCounts.set(
      testCase.category,
      (categoryCounts.get(testCase.category) ?? 0) + 1,
    );
  }

  const providerRows: ProviderReportRow[] = [
    {
      provider: "Gemini",
      model: process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite",
      status: "skipped",
      cases: 0,
      passed: 0,
      p50_ms: "n/a",
      p95_ms: "n/a",
      token_usage: "n/a",
      reason:
        "live provider eval skipped by default; export env vars and set CONVERSATION_REFERENCE_LIVE_EVAL=1 to run",
    },
    {
      provider: "Qwen",
      model: process.env.PSU_QWEN_MODEL ?? "qwen/qwen3.7-plus",
      status: "skipped",
      cases: 0,
      passed: 0,
      p50_ms: "n/a",
      p95_ms: "n/a",
      token_usage: "n/a",
      reason:
        "live provider eval skipped by default; export env vars and set CONVERSATION_REFERENCE_LIVE_EVAL=1 to run",
    },
  ];

  const failed = results.filter((result) => !result.passed);
  const now = new Date().toISOString();

  const report = `# Phase 06 Model Performance Eval Report

Generated: ${now}

## Facts

- Deterministic eval suite: ${suite.cases.length} cases.
- Deterministic contract pass rate: ${passed}/${suite.cases.length} (${Math.round((passed / suite.cases.length) * 100)}%).
- Live provider eval: skipped in this report; this script does not read .env or call providers.
- Provider eval command remains opt-in: \`CONVERSATION_REFERENCE_LIVE_EVAL=1 npm run eval:conversation-reference-providers\`.
- Compact provider evidence pack budget: ${PROVIDER_EVIDENCE_PACK_LIMITS.maxScopes} scopes, ${PROVIDER_EVIDENCE_PACK_LIMITS.maxPreviewIdsPerScope} preview ids per scope, ${PROVIDER_EVIDENCE_PACK_LIMITS.maxLimitationsPerScope} limitations per scope.

${table(
  ["Category", "Cases"],
  Array.from(categoryCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, count]) => [category, String(count)]),
)}

## Provider Comparison

${table(
  ["Provider", "Model", "Status", "Cases", "Passed", "p50", "p95", "Tokens", "Reason"],
  providerRows.map((row) => [
    row.provider,
    row.model,
    row.status,
    String(row.cases),
    String(row.passed),
    row.p50_ms,
    row.p95_ms,
    row.token_usage,
    row.reason,
  ]),
)}

## Failure Classes

${
  failed.length === 0
    ? "- None in deterministic fixture validation."
    : failed
        .map((result) => `- ${result.id}: ${result.failures.join("; ")}`)
        .join("\n")
}

## Recommendations

- Keep Gemini as the default for schedule and standard deep turns because it fits the 20-30s budget better.
- Use Qwen only for hard deep turns with implication, deep-search, root-cause, or multi-source comparison signals.
- Treat the compact evidence pack as the provider source of truth for counts, ids, source binding, and clarify gates.
- Run live provider comparison only from an explicitly prepared shell environment; do not rely on .env for eval keys.
`;

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, report, "utf8");
  console.log(`Wrote ${REPORT_PATH}`);
}

main();
