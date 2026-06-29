/**
 * Phase 4.2 - worker evidence verifier smoke.
 *
 * Pure deterministic checks. No network, no LINE exports, no Google APIs.
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent worker verifier smoke test...");

  const { verifyWorkerEvidenceBundle } = await import(
    "../src/services/workerVerifier.js"
  );

  const base = {
    job_id: 1,
    worker_id: "gmail.reader",
    source: "gmail",
    source_ref: "query:invoice",
    fetched_at: "2026-06-29T04:00:00.000Z",
    newest_at: "2026-06-29T03:30:00.000Z",
    stale: false,
    capped: false,
    partial: false,
    confidence: "medium",
    limitations: ["read-only metadata"],
  };

  const fresh = verifyWorkerEvidenceBundle(base, {
    nowIso: "2026-06-29T05:00:00.000Z",
  });
  assert(fresh.accepted, "fresh valid bundle is accepted");
  assert(fresh.factSafe, "fresh medium-confidence complete bundle is fact-safe");

  const stale = verifyWorkerEvidenceBundle(base, {
    nowIso: "2026-07-02T05:00:00.000Z",
  });
  assert(stale.accepted && stale.stale, "old fetched_at marks evidence stale");
  assert(!stale.factSafe, "stale evidence is not fact-safe");

  const capped = verifyWorkerEvidenceBundle({ ...base, capped: true }, {
    nowIso: "2026-06-29T05:00:00.000Z",
  });
  assert(
    capped.accepted && capped.capped && capped.limitations.includes("evidence was capped"),
    "capped evidence carries a capped caveat",
  );

  const partial = verifyWorkerEvidenceBundle({ ...base, partial: true }, {
    nowIso: "2026-06-29T05:00:00.000Z",
  });
  assert(partial.accepted && !partial.factSafe, "partial evidence is accepted but not fact-safe");

  const missingSource = verifyWorkerEvidenceBundle({
    ...base,
    source: undefined,
  });
  assert(
    !missingSource.accepted && missingSource.rejectReason === "missing_source",
    "missing source is rejected with provenance reason",
  );

  const missingFetchedAt = verifyWorkerEvidenceBundle({
    ...base,
    fetched_at: undefined,
  });
  assert(
    !missingFetchedAt.accepted &&
      missingFetchedAt.rejectReason === "missing_fetched_at",
    "missing fetched_at is rejected with freshness reason",
  );

  console.log("\nAll worker verifier smoke assertions passed.");
}

main().catch((err: unknown) => {
  console.error(
    "\nWorker verifier smoke FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
