import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Phase 2 — Active Job Foundation smoke.
 *
 * Uses a temp DB and temp LINE export fixture only. No real LINE exports,
 * credentials, Google APIs, model calls, or desktop notifications.
 */

const TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-active-job-"));
const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
const TEST_LINE_DIR = path.join(TEST_TMP, "line-exports");
fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
fs.mkdirSync(TEST_LINE_DIR, { recursive: true });

process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_DB_PATH = path.join(TEST_TMP, "test.db");
process.env.LINE_EXPORT_DIR = TEST_LINE_DIR;
process.env.CLAUDE_AGENT_AI_ENABLED = "";
process.env.GOOGLE_CALENDAR_ENABLED = "";
process.env.LINE_ENABLED = "";
process.env.CLAUDE_AGENT_AUTO_EXECUTE_ENABLED = "";

const RAW_LINE_TEXT = "loan-smoke approved body secret-not-for-job";
const SAMPLE = [
  "2026.06.10 Wednesday",
  "15:29 PSARA Photos",
  `15:30 PSARA ${RAW_LINE_TEXT}`,
  "",
].join("\n");

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Active Job Foundation smoke test...");

  fs.writeFileSync(path.join(TEST_LINE_DIR, "[LINE]LoanSmoke.txt"), SAMPLE, "utf8");

  const { initDb } = await import("../src/db/init.js");
  const { closeDb, getDb } = await import("../src/db/connection.js");
  const { setConfigBool } = await import("../src/db/repositories/configRepo.js");
  const {
    listActiveJobEvents,
    listRecentActiveJobs,
  } = await import("../src/db/repositories/activeJobRepo.js");
  const {
    ACTIVE_JOB_PROGRESS_MAX_CHARS,
    activeJobProgressSchema,
  } = await import("../src/schemas/activeJob.js");
  const {
    appendProgress,
    attachEvidenceMetadata,
    createJob,
    getRecentChatJobProgress,
    markDone,
    requestUserClarification,
    transitionJob,
    ActiveJobTransitionError,
  } = await import("../src/services/activeJob.js");
  const {
    createActiveTopic,
    resolveActiveTopic,
  } = await import("../src/db/repositories/activeTopicRepo.js");
  const { runActiveTopicChecks } = await import("../src/services/scheduler.js");
  const { listNotifications } = await import(
    "../src/db/repositories/notificationRepo.js"
  );

  initDb();

  try {
    const job = createJob({
      kind: "smoke.workflow",
      title: "Smoke workflow",
      source: "smoke",
      source_ref: "repo",
    });
    assert(job.status === "queued", "createJob creates a queued job");

    transitionJob(job.id, "understanding", "Understanding request");
    appendProgress(
      job.id,
      `token=supersecret ${"x".repeat(400)}`,
      {
        safe_count: 3,
        message: RAW_LINE_TEXT,
        token: "sk-" + "a".repeat(40),
      },
    );
    const progressEvent = listActiveJobEvents(job.id).at(-1)!;
    assert(
      progressEvent.progress.length <= ACTIVE_JOB_PROGRESS_MAX_CHARS,
      "progress is capped to the active-job max",
    );
    assert(
      !progressEvent.progress.includes("supersecret"),
      "progress redacts secret-like values",
    );
    const progressMetadata = JSON.parse(progressEvent.metadata_json ?? "{}") as Record<string, unknown>;
    assert(progressMetadata.message === "[redacted]", "metadata redacts raw message fields");
    assert(progressMetadata.token === "[redacted]", "metadata redacts token fields");

    const clarification = requestUserClarification(job.id, "Which export should I inspect?", [
      "latest",
      "older",
    ]);
    assert(clarification.status === "needs_user", "clarification moves job to needs_user");
    transitionJob(job.id, "searching", "Continuing after clarification");
    attachEvidenceMetadata(job.id, {
      source: "line_export",
      source_ref: "fixture",
      fetched_at: "2026-06-10T09:00:00.000Z",
      newest_at: "2026-06-10T08:30:00.000Z",
      stale: false,
      capped: false,
      partial: false,
      confidence: "medium",
      limitations: ["export-based", "read-only"],
      count: 1,
      body: RAW_LINE_TEXT,
    });
    const evidenceEvent = listActiveJobEvents(job.id).at(-1)!;
    const evidenceText = `${evidenceEvent.metadata_json ?? ""}`;
    assert(!evidenceText.includes(RAW_LINE_TEXT), "evidence metadata stores no raw LINE body");
    transitionJob(job.id, "verifying", "Verifying evidence metadata");
    transitionJob(job.id, "reporting", "Preparing final report");
    markDone(job.id, "Done");
    let illegalTransition = false;
    try {
      transitionJob(job.id, "searching", "Should fail");
    } catch (err) {
      illegalTransition = err instanceof ActiveJobTransitionError;
    }
    assert(illegalTransition, "terminal jobs reject later transitions");

    const chatProgress = getRecentChatJobProgress(1, 10);
    assert(chatProgress.length === 1, "chat progress contract returns recent job");
    assert(activeJobProgressSchema.safeParse(chatProgress[0]).success, "chat progress validates");

    // Active-topic integration: route scheduler triage through active jobs.
    setConfigBool("line_enabled", true);
    setConfigBool("active_topic_triage_enabled", true);
    for (const existing of listRecentActiveJobs(20)) {
      if (existing.kind === "line.active_topic.triage" && existing.source_ref) {
        // no-op: this loop only documents that smoke jobs are isolated by kind
      }
    }

    const topic = createActiveTopic({
      title: "loan smoke",
      source: "line",
      keywords: ["loan-smoke"],
      chat_filter: null,
      priority: 60,
      cooldown_minutes: 1,
      baseline_at: "2026-06-09T00:00:00.000Z",
      created_from: "chat",
    });

    const notifyCalls: { title: string; body?: string }[] = [];
    runActiveTopicChecks("2026-06-10T09:00:00.000Z", {
      notify(title: string, body?: string): void {
        notifyCalls.push({ title, body });
      },
    });
    assert(notifyCalls.length === 1, "active-topic triage still fires one notification");
    assert(
      listNotifications(20).some((n) => n.kind === "line.active_topic"),
      "active-topic notification row is preserved",
    );

    const triageJob = listRecentActiveJobs(10).find(
      (j) => j.kind === "line.active_topic.triage" && j.source_ref === String(topic.id),
    );
    assert(triageJob?.status === "done", "active-topic triage writes a done active job");
    const triageEvents = listActiveJobEvents(triageJob!.id, 20);
    const triageBlob = triageEvents
      .map((e) => `${e.progress}\n${e.metadata_json ?? ""}`)
      .join("\n");
    assert(
      triageEvents.some((e) => e.status === "searching") &&
        triageEvents.some((e) => e.status === "verifying") &&
        triageEvents.some((e) => e.status === "reporting"),
      "active-topic job emits searching/verifying/reporting milestones",
    );
    assert(!triageBlob.includes(RAW_LINE_TEXT), "active-topic job stores no raw LINE body");

    const logRows = getDb()
      .prepare("SELECT event_type, detail FROM activity_log")
      .all() as { event_type: string; detail: string | null }[];
    const logBlob = logRows.map((r) => `${r.event_type} ${r.detail ?? ""}`).join("\n");
    assert(!logBlob.includes(RAW_LINE_TEXT), "activity logs still contain no raw LINE body");

    resolveActiveTopic(topic.id);

    console.log("\nAll Active Job Foundation smoke assertions passed.");
  } finally {
    closeDb();
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(
    "\nActive Job Foundation smoke FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
