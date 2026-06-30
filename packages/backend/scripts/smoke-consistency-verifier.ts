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
  const base = {
    source: "google_drive",
    scope_type: "result_set",
    item_ids: ["a", "b", "c"],
    parent_ids: [],
    total_count: 3,
    fetched_at: "2026-06-30T13:00:00.000Z",
    confidence: "medium",
    limitations: [],
    ...partial,
  } as EvidenceScope;
  // Default the preview ids to the (possibly overridden) item ids so fixtures
  // don't trip the scope-metadata subset check unless they mean to.
  if (partial.preview_item_ids === undefined) base.preview_item_ids = base.item_ids;
  return base;
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

  const { repairPreviewCounts, extractCountClaims } = await import(
    "../src/services/consistencyVerifier.js"
  );

  // --- 7. Headline case: answer says 5 but preview total is 30 → repairable ---
  const v7 = verifyTurnConsistency({
    answer: "เจอ 5 รูปในโฟลเดอร์",
    previews: [],
    scopes: [
      scope({
        id: "drive:folder:F1",
        scope_type: "folder",
        item_ids: ["a", "b", "c", "d", "e"],
        preview_item_ids: ["a", "b", "c", "d", "e"],
        total_count: 30,
      }),
    ],
  });
  assert(v7.status === "repairable", "answer 5 vs preview 30 fails verifier");
  assert(v7.reason_code === "preview_overflow_unexplained", "overflow reason code");

  // --- 8. Answer overstates evidence (claims 40, scope holds 30) → block ---
  const v8 = verifyTurnConsistency({
    answer: "มี 40 รูป",
    previews: [],
    scopes: [scope({ id: "drive:f", item_ids: ["a"], total_count: 30 })],
  });
  assert(v8.status === "block", "answer overstating evidence blocks");
  assert(v8.reason_code === "count_vs_evidence_mismatch", "overstate reason code");

  // --- 9. Answer count matches total → pass ---
  const v9 = verifyTurnConsistency({
    answer: "มี 30 รูป",
    previews: [],
    scopes: [scope({ id: "drive:f2", item_ids: ["a"], total_count: 30 })],
  });
  assert(v9.status === "pass", "matching count passes");

  // --- 10. Overflow explained by a limitation → pass ---
  const v10 = verifyTurnConsistency({
    answer: "โชว์ 5 รูป",
    previews: [],
    scopes: [
      scope({
        id: "drive:f3",
        item_ids: ["a", "b", "c", "d", "e"],
        total_count: 30,
        limitations: ["preview shows 5 of 30 matches"],
      }),
    ],
  });
  assert(v10.status === "pass", "explained overflow passes");

  // --- 11. Two sources → ambiguous generic count is not judged ---
  const v11 = verifyTurnConsistency({
    answer: "มี 2 อัน",
    previews: [],
    scopes: [
      scope({ id: "drive:f4", source: "google_drive", item_ids: ["a"], total_count: 5 }),
      scope({ id: "gmail:r", source: "gmail", scope_type: "result_set", item_ids: ["m"], total_count: 9 }),
    ],
  });
  assert(v11.status === "pass", "ambiguous generic count across sources not judged");

  // --- 12. repairPreviewCounts clamps inflated drive totalItems to evidence ---
  const repaired = repairPreviewCounts(
    [
      {
        kind: "drive",
        query: "trip",
        status: "found",
        totalItems: 30,
        items: [
          {
            id: "a", name: "a", mimeType: "image/jpeg", webViewLink: null,
            thumbnailLink: null, iconLink: null, folderId: "F1", folderName: "Trip",
            folderLink: null, previewKind: "image", preview: null, childNames: null,
            truncated: false, readable: true,
          },
        ],
      },
    ],
    [scope({ id: "drive:folder:F1", scope_type: "folder", item_ids: ["a"], total_count: 5 })],
  );
  const drivePreview = repaired[0];
  assert(
    drivePreview.kind === "drive" && drivePreview.totalItems === 5,
    "inflated drive totalItems clamped to evidence total",
  );

  // --- 13. extractCountClaims parses Thai + Arabic digits with counters ---
  const claims = extractCountClaims("เจอ ๓ ไฟล์ และ 12 ฉบับ");
  assert(claims.length === 2, "extracts both count claims");
  assert(
    claims.some((c) => c.value === 3 && c.source === "google_drive"),
    "thai-digit drive claim parsed",
  );
  assert(
    claims.some((c) => c.value === 12 && c.source === "gmail"),
    "arabic-digit gmail claim parsed",
  );

  console.log("Consistency verifier smoke OK.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
