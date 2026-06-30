/**
 * Reference Resolver smoke (Phase 03).
 *
 * Pure deterministic checks. No provider calls, no Google APIs, no DB reads,
 * no LINE exports, and no .env reads. Verifies the rule-first resolution and the
 * Source Router gating it drives.
 */

import type { CompactEvidenceScope } from "../src/services/evidenceScope.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

function scope(
  partial: Partial<CompactEvidenceScope> & Pick<CompactEvidenceScope, "id" | "source" | "scope_type">,
): CompactEvidenceScope {
  return {
    confidence: "high",
    item_count: 5,
    fetched_at: "2026-06-30T13:00:00.000Z",
    limitations: [],
    ...partial,
  };
}

async function main(): Promise<void> {
  console.log("Running reference resolver smoke...");

  const { resolveReference } = await import("../src/services/referenceResolver.js");

  const driveFolder = scope({
    id: "drive:folder:F1",
    source: "google_drive",
    scope_type: "folder",
    label: "Trip photos",
    total_count: 5,
    confidence: "high",
  });
  const gmailResult = scope({
    id: "gmail:result:invoices",
    source: "gmail",
    scope_type: "result_set",
    query: "invoices",
    confidence: "medium",
  });
  const lineChat = scope({
    id: "line:chat:mom",
    source: "line_export",
    scope_type: "chat",
    label: "Mom",
    confidence: "high",
  });

  // --- 1. Drive single folder + "มีกี่รูป" → reuse that folder ---
  const d1 = resolveReference("มีกี่รูป", { recentScopes: [driveFolder] });
  assert(d1.kind === "reuse_scope", "drive followup reuses scope");
  assert(d1.selected_scope_id === "drive:folder:F1", "drive followup binds the folder id");
  assert(d1.selected_source === "google_drive", "drive followup source is drive");

  // --- 2. Gmail "กี่ฉบับ" after a gmail read → reuse the gmail set ---
  const d2 = resolveReference("กี่ฉบับ", { recentScopes: [gmailResult] });
  assert(d2.kind === "reuse_scope" && d2.selected_source === "gmail", "gmail followup reuses gmail scope");

  // --- 3. LINE "ล่าสุดว่าไง" after a focused chat → reuse the chat ---
  const d3 = resolveReference("ล่าสุดว่าไง", { recentScopes: [lineChat] });
  assert(d3.kind === "reuse_scope" && d3.selected_source === "line_export", "line followup reuses line chat");

  // --- 4. Explicit new search beats follow-up markers ---
  const d4 = resolveReference("ลองหาในโฟลเดอร์อื่น มีกี่รูป", { recentScopes: [driveFolder] });
  assert(d4.kind === "fresh_search", "explicit new search not suppressed");
  assert(d4.reason_code === "explicit_new_search", "explicit new search reason code");

  // --- 5. Non-reference message → fresh_search (unchanged behavior) ---
  const d5 = resolveReference("ช่วยหารูปงานปีใหม่ในไดรฟ์", { recentScopes: [driveFolder] });
  assert(d5.kind === "fresh_search" && d5.reason_code === "not_a_reference", "normal search untouched");

  // --- 6. Follow-up but no recent scope → fresh_search ---
  const d6 = resolveReference("มีกี่รูป", { recentScopes: [] });
  assert(d6.kind === "fresh_search" && d6.reason_code === "no_recent_scope", "followup with no scope falls through");

  // --- 7. Mixed sources, bare "กี่อัน" → reuse NEWEST (drive shown last) ---
  const d7 = resolveReference("กี่อัน", { recentScopes: [driveFolder, gmailResult] });
  assert(d7.kind === "reuse_scope" && d7.selected_scope_id === "drive:folder:F1", "bare followup binds newest scope");

  // --- 8. Named source with 2 matching scopes → clarify ---
  const d8 = resolveReference("รูปกี่อัน", {
    recentScopes: [driveFolder, scope({ id: "drive:folder:F2", source: "google_drive", scope_type: "folder", label: "Old album" })],
  });
  assert(d8.kind === "clarify", "two same-source scopes → clarify");
  assert((d8.candidate_scope_ids?.length ?? 0) === 2, "clarify carries both candidate ids");
  assert(d8.confidence === "low", "clarify is low confidence");
  assert(
    d8.limitations.includes("Trip photos") && d8.limitations.includes("Old album"),
    "clarify exposes evidence-based option labels",
  );

  // --- 9. Named source never retrieved → fresh_search (source_mismatch) ---
  const d9 = resolveReference("เมลกี่ฉบับ", { recentScopes: [driveFolder] });
  assert(d9.kind === "fresh_search" && d9.reason_code === "source_mismatch", "named-but-missing source searches fresh");

  console.log("Reference resolver smoke OK.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
