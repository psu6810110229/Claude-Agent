/**
 * Consistency Verifier smoke (Phase 04).
 *
 * Pure deterministic checks. No provider calls, no Google APIs, no DB reads,
 * no LINE exports, and no .env reads. Verifies the turn-consistency gate.
 */

import type { EvidenceScope } from "../src/services/evidenceScope.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

function scope(partial: Partial<EvidenceScope> & Pick<EvidenceScope, "id">): EvidenceScope {
  return {
    source: "google_drive",
    scope_type: "result_set",
    item_ids: ["a", "b", "c"],
    parent_ids: [],
    preview_item_ids: ["a", "b", "c"],
    total_count: 3,
    fetched_at: "2026-06-30T13:00:00.000Z",
    confidence: "medium",
    limitations: [],
    ...partial,
  } as EvidenceScope;
}

async function main(): Promise<void> {
  console.log("Running consistency verifier smoke...");

  const { verifyTurnConsistency } = await import(
    "../src/services/consistencyVerifier.js"
  );

  // --- 1. Aligned scope (answer == preview == scope) → pass ---
  const v1 = verifyTurnConsistency({
    answer: "เจอ 3 ไฟล์",
    previews: [],
    scopes: [scope({ id: "drive:result:x" })],
  });
  assert(v1.status === "pass", "aligned scope passes");
  assert(v1.reason_code === "consistent", "pass reason is consistent");

  // --- 2. No scopes at all → pass (nothing to contradict) ---
  const v2 = verifyTurnConsistency({ answer: "สวัสดี", previews: [], scopes: [] });
  assert(v2.status === "pass", "no scopes passes");

  // --- 3. Duplicate scope id within a turn → block ---
  const v3 = verifyTurnConsistency({
    answer: "x",
    previews: [],
    scopes: [scope({ id: "drive:result:dup" }), scope({ id: "drive:result:dup" })],
  });
  assert(v3.status === "block", "duplicate scope id blocks");
  assert(v3.reason_code === "duplicate_scope_id", "duplicate id reason code");

  // --- 4. Preview id not in item_ids → repairable ---
  const v4 = verifyTurnConsistency({
    answer: "x",
    previews: [],
    scopes: [
      scope({ id: "drive:result:stray", item_ids: ["a", "b"], preview_item_ids: ["a", "z"] }),
    ],
  });
  assert(v4.status === "repairable", "stray preview id is repairable");
  assert(v4.reason_code === "preview_ids_not_in_scope", "stray preview reason code");

  // --- 5. total_count below held item count → repairable ---
  const v5 = verifyTurnConsistency({
    answer: "x",
    previews: [],
    scopes: [scope({ id: "drive:result:lowtotal", item_ids: ["a", "b", "c"], total_count: 1 })],
  });
  assert(v5.status === "repairable", "total below item count is repairable");
  assert(v5.reason_code === "total_below_item_count", "low total reason code");

  // --- 6. Worst finding wins: block beats repairable ---
  const v6 = verifyTurnConsistency({
    answer: "x",
    previews: [],
    scopes: [
      scope({ id: "drive:result:dup2", item_ids: ["a"], preview_item_ids: ["zzz"] }),
      scope({ id: "drive:result:dup2" }),
    ],
  });
  assert(v6.status === "block", "block outranks repairable");
  assert(v6.findings.length >= 2, "all findings collected");

  console.log("Consistency verifier smoke OK.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
