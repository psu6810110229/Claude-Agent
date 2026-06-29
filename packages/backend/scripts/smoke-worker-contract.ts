/**
 * Phase 4.1 - Read-only worker contract smoke.
 *
 * Pure schema checks only. No real Google API, no LINE exports, no filesystem
 * reads, no provider calls, and no action execution.
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent read-only worker contract smoke test...");

  const {
    parseReadOnlyWorkerOutput,
    readOnlyWorkerEvidenceBundleSchema,
    readOnlyWorkerInputSchema,
    safeParseReadOnlyWorkerOutput,
  } = await import("../src/schemas/worker.js");

  const input = readOnlyWorkerInputSchema.parse({
    job_id: 42,
    worker_id: "line.triage",
    source: "line_export",
    source_ref: "active_topic:7",
    task: "Find fresh evidence metadata for an active topic.",
    query: "invoice follow-up",
    limit: 10,
  });
  assert(input.read_only === true, "worker input defaults to read_only=true");

  const validBundle = {
    job_id: 42,
    worker_id: "line.triage",
    source: "line_export",
    source_ref: "active_topic:7",
    fetched_at: "2026-06-29T05:30:00.000Z",
    newest_at: "2026-06-29T05:20:00.000Z",
    stale: false,
    capped: false,
    partial: false,
    confidence: "medium",
    limitations: ["export-based", "read-only"],
  };

  assert(
    readOnlyWorkerEvidenceBundleSchema.safeParse(validBundle).success,
    "valid evidence bundle passes schema validation",
  );
  assert(
    parseReadOnlyWorkerOutput(validBundle).source === "line_export",
    "parseReadOnlyWorkerOutput returns the parsed bundle",
  );

  assert(
    !safeParseReadOnlyWorkerOutput({
      ...validBundle,
      actions: [{ action_type: "task.create", payload: { title: "blocked" } }],
    }).success,
    "worker output with action proposals is rejected",
  );

  assert(
    !safeParseReadOnlyWorkerOutput({
      ...validBundle,
      source: undefined,
    }).success,
    "worker output missing source is rejected",
  );

  assert(
    !safeParseReadOnlyWorkerOutput({
      ...validBundle,
      fetched_at: undefined,
    }).success,
    "worker output missing fetched_at is rejected",
  );

  assert(
    !safeParseReadOnlyWorkerOutput({
      ...validBundle,
      newest_at: "2026-06-29T05:31:00.000Z",
    }).success,
    "worker output with newest_at after fetched_at is rejected",
  );

  assert(
    !readOnlyWorkerInputSchema.safeParse({
      ...input,
      read_only: false,
    }).success,
    "worker input cannot opt out of read-only mode",
  );

  console.log("\nAll read-only worker contract smoke assertions passed.");
}

main().catch((err: unknown) => {
  console.error(
    "\nRead-only worker contract smoke FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
