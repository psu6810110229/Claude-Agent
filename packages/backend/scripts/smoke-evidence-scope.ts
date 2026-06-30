/**
 * Evidence Scope Store smoke (Phase 02).
 *
 * Pure deterministic checks. No provider calls, no Google APIs, no DB reads,
 * no LINE exports, and no .env reads. Verifies scope build/cap/serialize/parse
 * and the metadata-only privacy guarantees.
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running evidence scope store smoke...");

  const {
    buildEvidenceScope,
    serializeEvidenceScopes,
    parseEvidenceScopes,
    EvidenceScopeSchema,
    SCOPE_CAPS,
  } = await import("../src/services/evidenceScope.js");

  // --- 1. Build a well-formed Drive scope ---
  const drive = buildEvidenceScope({
    id: "drive:folder_a",
    source: "google_drive",
    scope_type: "folder",
    label: "Folder A images",
    query: "Folder A images",
    item_ids: ["img_1", "img_2", "img_3", "img_4", "img_5"],
    parent_ids: ["folder_a"],
    preview_item_ids: ["img_1", "img_2", "img_3", "img_4"],
    total_count: 5,
    confidence: "high",
    limitations: ["drive search has no recency horizon"],
    fetched_at: "2026-06-30T13:00:00.000Z",
  });
  assert(drive.item_ids.length === 5, "drive scope keeps all 5 item ids");
  assert(drive.total_count === 5, "drive scope keeps total_count");
  assert(
    EvidenceScopeSchema.safeParse(drive).success,
    "built scope re-validates against schema",
  );

  // --- 2. Dedupe + cap enforcement ---
  const manyIds = Array.from({ length: 200 }, (_, i) => `id_${i}`);
  const capped = buildEvidenceScope({
    id: "drive:huge",
    source: "google_drive",
    scope_type: "result_set",
    item_ids: [...manyIds, "id_0", "id_1"], // duplicates at the tail
    confidence: "medium",
  });
  assert(
    capped.item_ids.length === SCOPE_CAPS.itemIds,
    `item_ids capped at ${SCOPE_CAPS.itemIds}`,
  );
  assert(
    new Set(capped.item_ids).size === capped.item_ids.length,
    "item_ids deduped",
  );

  // --- 3. Query / label truncation ---
  const longText = "x ".repeat(400);
  const truncated = buildEvidenceScope({
    id: "gmail:q",
    source: "gmail",
    scope_type: "thread",
    label: longText,
    query: longText,
    confidence: "low",
  });
  assert(
    (truncated.query?.length ?? 0) <= SCOPE_CAPS.query,
    "query truncated to cap",
  );
  assert(
    (truncated.label?.length ?? 0) <= SCOPE_CAPS.label,
    "label truncated to cap",
  );

  // --- 4. Privacy: schema is strict — unknown fields (e.g. a body) are rejected ---
  const withBody = EvidenceScopeSchema.safeParse({
    id: "line:chat_x",
    source: "line_export",
    scope_type: "chat",
    item_ids: [],
    parent_ids: [],
    preview_item_ids: [],
    fetched_at: "2026-06-30T13:00:00.000Z",
    confidence: "medium",
    limitations: [],
    body: "secret message text", // must be rejected
  });
  assert(
    !withBody.success,
    "strict schema rejects a stray body/content field (no message bodies in scope)",
  );

  // --- 5. Serialize / parse round-trip ---
  const json = serializeEvidenceScopes([drive, capped, truncated]);
  assert(typeof json === "string" && json !== null, "scopes serialize to JSON");
  const parsed = parseEvidenceScopes(json);
  assert(parsed.length === 3, "round-trip preserves all valid scopes");
  assert(parsed[0].id === "drive:folder_a", "round-trip preserves scope id");

  // --- 6. Per-turn cap on serialization ---
  const overflow = Array.from({ length: SCOPE_CAPS.perTurn + 4 }, (_, i) =>
    buildEvidenceScope({
      id: `scope_${i}`,
      source: "google_drive",
      scope_type: "result_set",
      confidence: "low",
    }),
  );
  const overflowParsed = parseEvidenceScopes(serializeEvidenceScopes(overflow));
  assert(
    overflowParsed.length === SCOPE_CAPS.perTurn,
    `serialization caps at ${SCOPE_CAPS.perTurn} scopes per turn`,
  );

  // --- 7. Fail-soft parsing ---
  assert(parseEvidenceScopes(null).length === 0, "null json parses to []");
  assert(parseEvidenceScopes("not json").length === 0, "bad json parses to []");
  assert(
    parseEvidenceScopes(JSON.stringify([{ id: "x" }])).length === 0,
    "invalid entries are dropped, not thrown",
  );

  // --- 8. Capture a Drive scope from a displayed preview (Sprint 2) ---
  const { buildTurnEvidenceScopes } = await import(
    "../src/services/evidenceScopeBuilders.js"
  );
  const drivePreview = {
    kind: "drive" as const,
    query: "Folder A images",
    status: "found" as const,
    totalItems: 5,
    items: [1, 2, 3, 4].map((n) => ({
      id: `img_${n}`,
      name: `photo_${n}.jpg`,
      mimeType: "image/jpeg",
      webViewLink: null,
      thumbnailLink: null,
      iconLink: null,
      folderId: "folder_a",
      folderName: "Folder A",
      folderLink: null,
      previewKind: "image" as const,
      preview: null,
      childNames: null,
      truncated: false,
      readable: true,
    })),
  };
  const driveScopes = buildTurnEvidenceScopes([drivePreview]);
  assert(driveScopes.length === 1, "drive preview yields one scope");
  const ds = driveScopes[0];
  assert(ds.source === "google_drive", "captured scope source is google_drive");
  assert(
    ds.scope_type === "folder" && ds.parent_ids[0] === "folder_a",
    "single shared folder → folder scope anchored to that folder",
  );
  assert(ds.id === "drive:folder:folder_a", "folder scope id is deterministic");
  assert(
    ds.item_ids.length === 4 &&
      ds.preview_item_ids.length === 4 &&
      ds.preview_item_ids.every((id) => ds.item_ids.includes(id)),
    "answer/preview share the same evidence ids",
  );
  assert(ds.total_count === 5, "scope keeps true total (5) above shown (4)");
  assert(
    ds.limitations.some((l) => l.includes("4 of 5")),
    "windowed preview is flagged as a limitation",
  );
  assert(ds.confidence === "high", "single-folder anchor → high confidence");

  // Result set without a shared folder → weaker, result_set scope.
  const looseScopes = buildTurnEvidenceScopes([
    {
      ...drivePreview,
      totalItems: 30,
      items: drivePreview.items.map((it, idx) => ({
        ...it,
        folderId: `folder_${idx}`,
        folderName: `Folder ${idx}`,
      })),
    },
  ]);
  assert(
    looseScopes[0].scope_type === "result_set" &&
      looseScopes[0].confidence === "medium",
    "multi-folder result set → result_set scope, medium confidence",
  );
  assert(
    looseScopes[0].limitations.some((l) => l.includes("recency horizon")),
    "result set flags the no-recency-horizon Drive search limitation",
  );
  assert(
    buildTurnEvidenceScopes([
      { kind: "drive", query: "x", status: "empty", totalItems: 0, items: [] },
    ]).length === 0,
    "empty preview yields no scope",
  );

  console.log("\nAll evidence scope store assertions passed.");
}

main().catch((err: unknown) => {
  console.error(
    "\nEvidence scope store smoke FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
