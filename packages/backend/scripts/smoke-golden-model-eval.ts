/**
 * Phase 06 golden model eval contract smoke.
 *
 * Pure deterministic checks. No provider calls, no Google APIs, no DB reads,
 * no LINE exports, no filesystem scans, and no .env reads.
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running Phase 06 golden model eval contract smoke...");

  const {
    GoldenEvalSuiteSchema,
    actualFromGoldenExpectation,
    evaluateGoldenEvalActual,
    validateGoldenEvalSuite,
  } = await import("../src/evals/goldenModelEval.js");
  const { goldenModelSeedSuite } = await import(
    "../src/evals/goldenModelEvalFixtures.js"
  );

  const suite = validateGoldenEvalSuite(goldenModelSeedSuite);
  assert(suite.cases.length === 24, "seed suite contains 24 golden cases");
  assert(suite.target_case_count === 96, "suite records 96-case target");
  assert(!suite.live_provider_allowed, "live provider eval is disabled");

  const ids = new Set(suite.cases.map((testCase) => testCase.id));
  assert(ids.size === suite.cases.length, "case ids are unique");
  assert(
    suite.cases.every((testCase) => testCase.context.synthetic === true),
    "all cases use synthetic mock contexts",
  );
  assert(
    suite.cases.some((testCase) => testCase.cluster === "phase05_class_planner"),
    "seed suite includes Phase 5 class planner cases",
  );
  assert(
    suite.cases.some(
      (testCase) => testCase.cluster === "phase05_approval_staging",
    ),
    "seed suite includes Phase 5 approval staging cases",
  );
  assert(
    suite.cases.some(
      (testCase) => testCase.cluster === "phase06_provider_grounding",
    ),
    "seed suite includes Phase 6 grounding cases",
  );
  assert(
    suite.cases.some(
      (testCase) => testCase.cluster === "adversarial_cross_cutting",
    ),
    "seed suite includes adversarial cross-cutting cases",
  );

  const deterministicResults = suite.cases.map((testCase) =>
    evaluateGoldenEvalActual(testCase, actualFromGoldenExpectation(testCase)),
  );
  assert(
    deterministicResults.every((result) => result.passed),
    "expected deterministic actuals pass all seed cases",
  );

  const ambiguousClass = suite.cases.find(
    (testCase) => testCase.id === "phase05-class-ambiguity-001",
  );
  assert(ambiguousClass, "fixture includes two-English-class ambiguity case");
  if (!ambiguousClass) throw new Error("unreachable");

  const unsafeClassResult = evaluateGoldenEvalActual(ambiguousClass, {
    _analysis: "fixture unsafe class audit",
    outcome: "propose",
    actionType: "calendar_update_proposal",
    createdProposal: true,
    clarificationTopics: [],
    assumptions: ["which Tuesday class to reschedule"],
    safetyViolations: [],
    catastrophicBehaviors: ["guesses one class slot arbitrarily"],
    thaiRegister: "pass",
  });
  assert(!unsafeClassResult.passed, "ambiguous class proposal is rejected");
  assert(
    unsafeClassResult.failures.some((failure) =>
      failure.includes("missing clarification topic"),
    ),
    "ambiguous class failure reports missing clarification",
  );

  const secretBait = suite.cases.find(
    (testCase) => testCase.id === "adversarial-safety-001",
  );
  assert(secretBait, "fixture includes credential exfiltration bait case");
  if (!secretBait) throw new Error("unreachable");

  const unsafeSecretResult = evaluateGoldenEvalActual(secretBait, {
    _analysis: "fixture unsafe secret audit",
    outcome: "reject",
    createdProposal: false,
    clarificationTopics: [],
    assumptions: [],
    safetyViolations: ["secret exfiltration attempted"],
    catastrophicBehaviors: ["leaks string tokens matching secret signatures"],
    thaiRegister: "pass",
  });
  assert(!unsafeSecretResult.passed, "secret leakage fails hard gate");

  const unsafeSuite = GoldenEvalSuiteSchema.safeParse({
    ...goldenModelSeedSuite,
    live_provider_allowed: true,
  });
  assert(!unsafeSuite.success, "fixtures cannot enable live providers");

  const unsafeContextSuite = GoldenEvalSuiteSchema.safeParse({
    ...goldenModelSeedSuite,
    cases: [
      {
        ...goldenModelSeedSuite.cases[0],
        context: {
          ...goldenModelSeedSuite.cases[0].context,
          token: "mock-token-value",
        },
      },
    ],
  });
  assert(!unsafeContextSuite.success, "mock contexts reject forbidden live-data keys");

  console.log("\nAll Phase 06 golden model eval contract assertions passed.");
}

main().catch((err: unknown) => {
  console.error(
    "\nPhase 06 golden model eval contract smoke FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
