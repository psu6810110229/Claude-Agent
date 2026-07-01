/**
 * Phase 4.4 - web research worker smoke.
 *
 * Mocked search/fetch only. No live browsing and no action execution.
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent web research worker smoke test...");

  const { runBackendReadWorker } = await import("../src/services/readOnlyWorkers.js");
  const { runWebResearchWorker } = await import(
    "../src/services/webResearchWorker.js"
  );
  const { verifyWorkerEvidenceBundle } = await import(
    "../src/services/workerVerifier.js"
  );

  const now = () => new Date("2026-06-29T06:00:00.000Z");

  const result = await runWebResearchWorker(
    {
      job_id: 20,
      worker_id: "web.research",
      source: "web",
      task: "Research source-backed facts.",
      query: "Bangkok weather safety",
      limit: 3,
    },
    {
      now,
      search: async () => [
        {
          url: "https://example.com/weather",
          title: "Weather advisory",
          snippet: "Heavy rain is forecast in Bangkok this evening.",
          published_at: "2026-06-29T05:00:00.000Z",
        },
        {
          url: "https://news.example.org/update",
          title: "Transit update",
          snippet: "Some transit delays were reported after the rain.",
          published_at: "2026-06-29T05:30:00.000Z",
        },
      ],
    },
  );

  assert(result.bundle.source === "web", "web worker returns a web evidence bundle");
  assert(result.claims.length === 2, "web worker returns source-backed claims");
  assert(
    result.claims.every(
      (claim) => claim.url.startsWith("https://") && claim.source && claim.fetched_at,
    ),
    "every web claim has URL, source, and fetched_at",
  );
  assert(
    verifyWorkerEvidenceBundle(result.bundle, { nowIso: now().toISOString() }).accepted,
    "web evidence bundle verifies",
  );
  assert(result.summary.includes("2 source-backed"), "web worker summarizes verified evidence briefly");
  assert(!JSON.stringify(result).includes("action_type"), "web worker returns no action proposals");

  const partial = await runWebResearchWorker(
    {
      job_id: 21,
      worker_id: "web.research",
      source: "web",
      task: "Drop unverifiable sources.",
      query: "mixed",
      limit: 5,
    },
    {
      now,
      search: async () => [
        {
          url: "not-a-url",
          title: "Bad source",
          snippet: "This should be ignored.",
        },
        {
          url: "https://valid.example/result",
          title: "Valid source",
          snippet: "This claim has provenance.",
        },
      ],
    },
  );
  assert(partial.claims.length === 1, "web worker drops claims without valid URLs");
  assert(partial.bundle.partial, "web worker marks dropped invalid hits as partial");

  const failed = await runWebResearchWorker(
    {
      job_id: 22,
      worker_id: "web.research",
      source: "web",
      task: "Handle search failure.",
      query: "unavailable",
    },
    {
      now,
      search: async () => {
        throw new Error("mock failure");
      },
    },
  );
  assert(failed.claims.length === 0, "web worker failure returns no claims");
  assert(
    failed.bundle.partial && failed.bundle.confidence === "low",
    "web worker failure returns partial low-confidence evidence",
  );

  const genericBundle = await runBackendReadWorker(
    {
      job_id: 23,
      worker_id: "web.research",
      source: "web",
      task: "Return bundle through generic dispatcher.",
      query: "generic",
    },
    {
      now,
      webResearch: {
        search: async () => [
          {
            url: "https://generic.example/source",
            title: "Generic source",
            snippet: "Generic dispatcher works.",
          },
        ],
      },
    },
  );
  assert(genericBundle.source === "web", "generic read-worker dispatcher handles web bundles");

  console.log("\nAll web research worker smoke assertions passed.");
}

main().catch((err: unknown) => {
  console.error(
    "\nWeb research worker smoke FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
