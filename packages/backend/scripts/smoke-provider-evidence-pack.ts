/**
 * Provider evidence pack smoke (Phase 06 Sprint 1).
 *
 * Pure deterministic checks. No provider calls, no Google APIs, no DB reads,
 * no LINE exports, and no .env reads. Verifies the compact provider-facing
 * evidence contract: source/count/preview ids/limitations only.
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running provider evidence pack smoke...");

  const { buildEvidenceScope, toCompactScope } = await import(
    "../src/services/evidenceScope.js"
  );
  const {
    buildProviderEvidencePack,
    formatProviderEvidencePack,
    PROVIDER_EVIDENCE_PACK_LIMITS,
  } = await import("../src/services/providerEvidencePack.js");

  const scope = toCompactScope(
    buildEvidenceScope({
      id: "drive:folder:album",
      source: "google_drive",
      scope_type: "folder",
      label: "Album with a reasonably short name",
      query: "album photos",
      item_ids: Array.from({ length: 12 }, (_, i) => `img_${i + 1}`),
      parent_ids: ["folder_album"],
      preview_item_ids: Array.from({ length: 12 }, (_, i) => `img_${i + 1}`),
      total_count: 12,
      confidence: "high",
      fetched_at: "2026-06-30T13:00:00.000Z",
      limitations: [
        "preview is capped",
        "metadata-only fixture",
        "drive search has no recency horizon",
        "extra limitation is capped away",
      ],
    }),
  );

  const pack = buildProviderEvidencePack({
    recentScopes: [scope],
    referenceDecision: {
      kind: "reuse_scope",
      confidence: "high",
      reason_code: "single_dominant_scope",
      selected_scope_id: "drive:folder:album",
      selected_source: "google_drive",
      limitations: [],
    },
  });

  assert(pack.schema_version === 1, "pack carries schema version");
  assert(pack.scopes.length === 1, "pack includes one scope");
  assert(pack.scopes[0].source === "google_drive", "scope keeps source");
  assert(pack.scopes[0].total === 12, "scope keeps authoritative total");
  assert(pack.scopes[0].held_ids === 12, "scope keeps held id count");
  assert(
    pack.scopes[0].preview_ids.length ===
      PROVIDER_EVIDENCE_PACK_LIMITS.maxPreviewIdsPerScope,
    "preview ids are capped for provider prompt budget",
  );
  assert(
    pack.scopes[0].limitations.length ===
      PROVIDER_EVIDENCE_PACK_LIMITS.maxLimitationsPerScope,
    "limitations are capped",
  );
  assert(
    pack.reference?.selected_scope_id === "drive:folder:album",
    "reference binds selected scope id",
  );
  assert(
    pack.rules.some((rule) => rule.includes("do not run or imply a fresh search")),
    "reuse-scope rule forbids fresh-search drift",
  );

  const formatted = formatProviderEvidencePack(pack);
  assert(formatted.length < 1800, "formatted pack stays compact");
  assert(!formatted.includes("body"), "pack contains no body field");
  assert(!formatted.includes("snippet"), "pack contains no snippet field");

  const clarifyPack = buildProviderEvidencePack({
    recentScopes: [scope],
    referenceDecision: {
      kind: "clarify",
      confidence: "low",
      reason_code: "multiple_candidate_scopes",
      candidate_scope_ids: ["drive:folder:album", "drive:folder:old"],
      selected_source: "google_drive",
      limitations: ["Album", "Old album"],
    },
  });
  assert(
    clarifyPack.reference?.candidate_scope_ids.length === 2,
    "clarify pack carries candidate ids",
  );
  assert(
    clarifyPack.rules.some((rule) => rule.includes("ask one clarification")),
    "clarify pack forbids guessing",
  );

  console.log("\nAll provider evidence pack assertions passed.");
}

main().catch((err: unknown) => {
  console.error(
    "\nProvider evidence pack smoke FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
