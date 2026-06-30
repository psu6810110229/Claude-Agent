/**
 * Conversation reference eval contract smoke.
 *
 * Pure deterministic checks. No provider calls, no Google APIs, no DB reads,
 * no LINE exports, and no .env reads.
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running conversation reference eval contract smoke...");

  const {
    ConversationReferenceSuiteSchema,
    evaluateConversationReferenceActual,
    validateConversationReferenceSuite,
  } = await import("../src/evals/conversationReferenceEval.js");
  const { conversationReferenceBaselineSuite } = await import(
    "../src/evals/conversationReferenceFixtures.js"
  );

  const suite = validateConversationReferenceSuite({
    schema_version: 1,
    generated_at: "2026-06-30T13:00:00.000Z",
    description: "Minimal provider-independent contract sample.",
    live_provider_allowed: false,
    cases: [
      {
        id: "contract.drive.reuse-count",
        title: "A short image-count follow-up reuses the previous Drive scope.",
        category: "drive_followup",
        tags: ["contract", "scope"],
        turns: [
          {
            role: "user",
            content: "Find images in folder A",
          },
          {
            role: "assistant",
            content: "Found 5 images.",
            scope_ids: ["drive.folder-a.images"],
          },
          {
            role: "user",
            content: "How many images?",
          },
        ],
        scopes: [
          {
            id: "drive.folder-a.images",
            source: "google_drive",
            scope_type: "folder",
            label: "Folder A images",
            query: "Folder A",
            item_ids: ["img_1", "img_2", "img_3", "img_4", "img_5"],
            parent_ids: ["folder_a"],
            preview_item_ids: ["img_1", "img_2", "img_3", "img_4"],
            total_count: 5,
            fetched_at: "2026-06-30T13:00:00.000Z",
            confidence: "high",
            limitations: ["metadata-only fixture"],
          },
        ],
        expectation: {
          behavior: "reuse_scope",
          source: "google_drive",
          scope_id: "drive.folder-a.images",
          expected_count: 5,
          expected_preview_item_ids: ["img_1", "img_2", "img_3", "img_4"],
          must_not_call_live_provider: true,
          must_not_read_real_data: true,
        },
      },
    ],
  });

  assert(suite.cases.length === 1, "valid fixture suite parses");

  const result = evaluateConversationReferenceActual(suite.cases[0], {
    behavior: "reuse_scope",
    source: "google_drive",
    scope_id: "drive.folder-a.images",
    count: 5,
    preview_item_ids: ["img_1", "img_2", "img_3", "img_4"],
  });
  assert(result.passed, "matching actual output passes");

  const mismatch = evaluateConversationReferenceActual(suite.cases[0], {
    behavior: "fresh_search",
    source: "google_drive",
    scope_id: "drive.global.images",
    count: 30,
    preview_item_ids: ["other_1"],
  });
  assert(!mismatch.passed, "mismatched output fails");
  assert(
    mismatch.failures.some((failure: string) => failure.includes("behavior")),
    "mismatch reports behavior failure",
  );

  const unsafe = ConversationReferenceSuiteSchema.safeParse({
    schema_version: 1,
    generated_at: "2026-06-30T13:00:00.000Z",
    description: "Unsafe live-provider fixture.",
    live_provider_allowed: true,
    cases: [],
  });
  assert(!unsafe.success, "fixtures cannot enable live providers");

  const baseline = validateConversationReferenceSuite(
    conversationReferenceBaselineSuite,
  );
  assert(baseline.cases.length >= 6, "read-only golden cases parse");
  assert(
    baseline.cases.some((testCase) => testCase.category === "drive_followup"),
    "baseline includes Drive follow-up cases",
  );
  assert(
    baseline.cases.some((testCase) => testCase.category === "gmail_followup"),
    "baseline includes Gmail follow-up cases",
  );
  assert(
    baseline.cases.some((testCase) => testCase.category === "line_followup"),
    "baseline includes LINE follow-up cases",
  );
  assert(
    baseline.cases.some((testCase) => testCase.category === "mixed_source"),
    "baseline includes mixed-source cases",
  );

  const driveRegression = baseline.cases.find(
    (testCase) => testCase.id === "drive.images.count-followup",
  );
  assert(driveRegression, "baseline includes the Drive image-count regression");
  if (!driveRegression) throw new Error("unreachable");

  const knownBadDriveResult = evaluateConversationReferenceActual(
    driveRegression,
    {
      behavior: "fresh_search",
      source: "google_drive",
      scope_id: "drive.global.images",
      count: 30,
      preview_item_ids: ["drive_other_1", "drive_other_2", "drive_other_3"],
    },
  );
  assert(
    !knownBadDriveResult.passed,
    "baseline catches the known Drive 5-vs-30 mismatch shape",
  );

  console.log("\nAll conversation reference eval contract assertions passed.");
}

main().catch((err: unknown) => {
  console.error(
    "\nConversation reference eval contract smoke FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
