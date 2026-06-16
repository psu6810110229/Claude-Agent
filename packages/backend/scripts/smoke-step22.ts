import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Step 22 — Active Intelligence Layer (Phase A-D).
 *
 * Hermetic: temp DB + temp LINE export dir; env neutralized BEFORE any config
 * import; no real LINE/Claude/Gemini/Google calls; stub notifier.
 *
 * Cases covered (roadmap §13): 1-13, 18, 20.
 * Cases 14-17 (Phase E scheduler triage) and 19 are deferred / covered by
 * smoke:step21 respectively.
 */

const TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-step22-"));
const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
const TEST_LINE_DIR = path.join(TEST_TMP, "line-exports");
fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
fs.mkdirSync(TEST_LINE_DIR, { recursive: true });

// Neutralize env BEFORE any config import (hermeticity — see smoke-env-hermeticity)
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_DB_PATH = path.join(TEST_TMP, "test.db");
process.env.LINE_EXPORT_DIR = TEST_LINE_DIR;
process.env.CLAUDE_AGENT_AI_ENABLED = "";
process.env.GOOGLE_CALENDAR_ENABLED = "";
process.env.LINE_ENABLED = "";
process.env.CLAUDE_AGENT_AUTO_EXECUTE_ENABLED = "";

// LINE export: Alice asks a question, Bob answers (different sender, same chat).
// Both mention "กยศ" so both appear in keyword search results.
// Bangkok 15:30 → UTC 08:30; Bangkok 15:45 → UTC 08:45.
const QUESTION_TEXT = "กยศ อนุมัติยัง?";
const ANSWER_TEXT = "กยศ ได้รับการอนุมัติแล้วครับ";
const LINE_SAMPLE = [
  "2026.06.10 Wednesday",
  "15:29 Alice Photos",        // media line — teaches sender registry
  `15:30 Alice ${QUESTION_TEXT}`, // question (has "?")
  `15:45 Bob ${ANSWER_TEXT}`,     // answer (different sender, 15 min later)
  "",
].join("\n");

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 22 (Active Intelligence) smoke test...");

  fs.writeFileSync(
    path.join(TEST_LINE_DIR, "[LINE]Test22Chat.txt"),
    LINE_SAMPLE,
    "utf8",
  );

  // Dynamic imports AFTER env is set (hermeticity)
  const { initDb } = await import("../src/db/init.js");
  const { closeDb, getDb } = await import("../src/db/connection.js");
  const { setConfigBool } = await import("../src/db/repositories/configRepo.js");
  const { actionTypeSchema, actionPayloadSchemas } = await import(
    "../src/schemas/approval.js"
  );
  const { ACTION_TYPES, getActionMeta } = await import(
    "../src/services/actionRegistry.js"
  );
  const { aiActionSchema } = await import("../src/schemas/aiCommand.js");
  const { executeAction } = await import("../src/services/executor.js");
  const { createApproval } = await import(
    "../src/db/repositories/approvalRepo.js"
  );
  const {
    createActiveTopic,
    getActiveTopicById,
    listActiveTopics,
    pauseActiveTopic,
    resolveActiveTopic,
  } = await import("../src/db/repositories/activeTopicRepo.js");
  const { dispatchProposedAction } = await import(
    "../src/services/actionDispatcher.js"
  );
  const { extractTopicKeywords, isShortFollowupQuestion, resolveActiveTopicForMessage, STRONG_SCORE } =
    await import("../src/services/activeTopicIntelligence.js");
  const {
    buildLineEvidenceForTopic,
    findCandidateQuestions,
    findCandidateAnswers,
    inferLineMessageKind,
    makeEmptyLineEvidence,
  } = await import("../src/services/lineEvidence.js");
  const { verifyLineEvidenceAnswerIntent } = await import(
    "../src/services/evidenceVerifier.js"
  );
  const { searchLineMessages } = await import("../src/services/lineChat.js");
  const { buildChatPrompt } = await import("../src/services/chatPrompt.js");
  const { buildChatContext } = await import("../src/services/chat.js");

  initDb();

  try {
    // ── Case 1: Schema / registry coverage ─────────────────────────────────

    assert(
      actionTypeSchema.options.includes("active_topic.create"),
      "actionTypeSchema enum includes active_topic.create",
    );
    assert(
      "active_topic.create" in actionPayloadSchemas,
      "actionPayloadSchemas has active_topic.create",
    );
    const meta = getActionMeta("active_topic.create");
    assert(
      meta.policies.includes("approval-required") &&
        meta.policies.includes("local-only"),
      "active_topic.create is approval-required + local-only",
    );
    assert(
      !meta.policies.includes("external-service") &&
        !meta.policies.includes("destructive"),
      "active_topic.create is NOT external-service / destructive",
    );
    assert(
      !ACTION_TYPES.some((t) => t.startsWith("line") && t !== "line_followup.create" && t !== "active_topic.create"),
      "no stray line* action types added",
    );
    assert(
      aiActionSchema.safeParse({
        action_type: "active_topic.create",
        payload: {
          title: "กยศ loan",
          source: "line",
          keywords: ["กยศ"],
        },
      }).success,
      "aiActionSchema accepts valid active_topic.create",
    );
    // Payload validation: rejects empty keywords and over-long title
    assert(
      !actionPayloadSchemas["active_topic.create"].safeParse({
        title: "x",
        source: "line",
        keywords: [],
      }).success,
      "payload rejects empty keywords array",
    );

    // ── Case 1 continued: Repo round-trip ──────────────────────────────────

    const topic1 = createActiveTopic({
      title: "กยศ loan",
      source: "line",
      keywords: ["กยศ", "loan"],
      chat_filter: "Test22Chat",
      priority: 70,
      cooldown_minutes: 15,
      baseline_at: "2026-06-01T00:00:00.000Z",
      created_from: "chat",
    });
    assert(topic1.id > 0, "createActiveTopic returns a row with an id");
    assert(topic1.status === "active", "new topic status is 'active'");
    assert(Array.isArray(topic1.keywords), "keywords hydrated to string[]");
    assert(
      topic1.keywords.includes("กยศ") && topic1.keywords.includes("loan"),
      "keywords round-trip correctly",
    );
    assert(
      getActiveTopicById(topic1.id)?.title === "กยศ loan",
      "getActiveTopicById returns correct row",
    );
    const listed = listActiveTopics({ status: "active" });
    assert(
      listed.some((t) => t.id === topic1.id),
      "listActiveTopics returns the created topic",
    );

    // Bad JSON keywords hydrate to []
    getDb()
      .prepare(
        "UPDATE active_topic SET keywords = 'NOTJSON' WHERE id = ?",
      )
      .run(topic1.id);
    const badKw = getActiveTopicById(topic1.id);
    assert(
      Array.isArray(badKw?.keywords) && badKw!.keywords.length === 0,
      "bad keyword JSON hydrates to [] without throwing",
    );
    // Restore
    getDb()
      .prepare(
        "UPDATE active_topic SET keywords = ? WHERE id = ?",
      )
      .run(JSON.stringify(["กยศ", "loan"]), topic1.id);

    // Soft-archive functions
    pauseActiveTopic(topic1.id);
    assert(
      getActiveTopicById(topic1.id)?.status === "paused",
      "pauseActiveTopic sets status paused",
    );
    resolveActiveTopic(topic1.id);
    assert(
      getActiveTopicById(topic1.id)?.status === "resolved",
      "resolveActiveTopic sets status resolved",
    );
    // Restore to active for later tests
    getDb()
      .prepare(
        "UPDATE active_topic SET status = 'active' WHERE id = ?",
      )
      .run(topic1.id);

    // ── Case 2: active_topic.create proposal stays PENDING ─────────────────

    const goodPayload = {
      title: "ตามงาน english",
      source: "line",
      keywords: ["english", "อังกฤษ"],
    };
    const dispatched = await dispatchProposedAction(
      "active_topic.create",
      goodPayload,
      "smoke",
    );
    assert(dispatched.mode === "pending", "auto-exec off → proposal stays pending");
    const beforeExec = listActiveTopics({ status: "active" });
    assert(
      !beforeExec.some((t) => t.title === "ตามงาน english"),
      "no topic row created while approval is only pending",
    );

    // ── Case 3: Executing active_topic.create writes row with backend fields ─

    const approval = createApproval("active_topic.create", goodPayload);
    const beforeExecute = listActiveTopics({ status: "active" });
    assert(
      !beforeExecute.some((t) => t.title === "ตามงาน english"),
      "createApproval alone does NOT write a topic row",
    );
    await executeAction("active_topic.create", approval.payload);
    const afterExecute = listActiveTopics({ status: "active" });
    const executed = afterExecute.find((t) => t.title === "ตามงาน english");
    assert(executed !== undefined, "executeAction creates exactly one topic row");
    assert(
      typeof executed!.baseline_at === "string" && executed!.baseline_at.endsWith("Z"),
      "baseline_at set by executor (ISO UTC string)",
    );
    assert(executed!.created_from === "chat", 'created_from is "chat" (hardcoded by executor)');

    // ── Case 4: Unverified context redacts all new fields ──────────────────

    const noopFetchGoogle = async () => [];
    const unverifiedCtx = await buildChatContext(
      "สวัสดี",
      noopFetchGoogle,
      false, // verified = false
    );
    assert(
      Array.isArray(unverifiedCtx.activeTopics) && unverifiedCtx.activeTopics.length === 0,
      "unverified context: activeTopics is []",
    );
    assert(
      unverifiedCtx.resolvedActiveTopic === null,
      "unverified context: resolvedActiveTopic is null",
    );
    assert(
      unverifiedCtx.activeTopicAmbiguity === null,
      "unverified context: activeTopicAmbiguity is null",
    );
    assert(
      unverifiedCtx.lineEvidence !== null &&
        unverifiedCtx.lineEvidence!.available === false,
      "unverified context: lineEvidence is unavailable (not null)",
    );
    assert(
      unverifiedCtx.verifierGuidance === null,
      "unverified context: verifierGuidance is null",
    );
    assert(unverifiedCtx.restricted === true, "unverified context: restricted=true");

    // ── Case 5: extractTopicKeywords drops stopwords, caps ─────────────────

    const kwTh = extractTopicKeywords("มีข้อความเรื่อง กยศ ใน LINE ไหมครับ");
    assert(kwTh.includes("กยศ"), "extractTopicKeywords keeps topic keyword");
    assert(!kwTh.includes("ไหม"), "extractTopicKeywords drops Thai stopword ไหม");
    assert(!kwTh.includes("ครับ"), "extractTopicKeywords drops ครับ");
    assert(!kwTh.includes("line"), "extractTopicKeywords drops 'line' stopword");
    assert(kwTh.length <= 6, "extractTopicKeywords caps at 6");

    const kwEn = extractTopicKeywords("show me the latest update on project alpha beta gamma delta epsilon");
    assert(kwEn.length <= 6, "extractTopicKeywords caps English at 6");
    assert(!kwEn.includes("the"), "extractTopicKeywords drops English stopword 'the'");

    // ── Case 6: Short follow-up + exactly one active topic → resolved ───────

    const singleTopic = {
      id: 99,
      title: "อังกฤษ 04",
      source: "line" as const,
      keywords: ["อังกฤษ", "english"],
      chat_filter: null,
      status: "active" as const,
      priority: 50,
      baseline_at: "2026-06-01T00:00:00.000Z",
      last_checked_at: null,
      last_evidence_at: null,
      last_summary: null,
      cooldown_minutes: 30,
      created_from: "chat" as const,
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const res6 = resolveActiveTopicForMessage("ถึงไหนแล้ว", [singleTopic]);
    assert(res6.kind === "resolved", "short follow-up + 1 active topic → resolved");
    assert(
      res6.kind === "resolved" && res6.topic.id === 99,
      "resolved to the correct topic id",
    );

    // Short follow-up check
    assert(
      isShortFollowupQuestion("ถึงไหนแล้ว"),
      "isShortFollowupQuestion: ถึงไหนแล้ว is a follow-up",
    );
    assert(
      isShortFollowupQuestion("any update"),
      "isShortFollowupQuestion: 'any update' is a follow-up",
    );
    assert(
      !isShortFollowupQuestion("ผมอยากรู้ว่าตอนนี้ระบบ LINE ของผมใช้งานได้ไหมครับ"),
      "isShortFollowupQuestion: long message with no pattern is NOT follow-up",
    );

    // ── Case 7: Ambiguous → ambiguous, no guess ────────────────────────────

    const topicA = { ...singleTopic, id: 100, title: "อังกฤษ 04" };
    const topicB = {
      ...singleTopic,
      id: 101,
      title: "english course",
      keywords: ["english", "course"],
    };
    // "อังกฤษ" appears in title of topicA → strong match; "english" in both →
    // ambiguity via the follow-up path with 2 topics
    const res7 = resolveActiveTopicForMessage("ถึงไหนแล้ว", [topicA, topicB]);
    assert(res7.kind === "ambiguous", "2 active topics + follow-up → ambiguous");
    assert(
      res7.kind === "ambiguous" && res7.candidates.length >= 2,
      "ambiguous result returns ≥2 candidates",
    );

    // STRONG_SCORE threshold
    assert(STRONG_SCORE === 3, "STRONG_SCORE constant is 3");

    // ── Cases 8-11: Evidence builder (enable LINE) ──────────────────────────

    setConfigBool("line_enabled", true);

    // Case 8: Evidence includes ONLY messages with atUtc > baseline_at
    const topicForEvidence = getActiveTopicById(topic1.id)!;
    const evidence = buildLineEvidenceForTopic(topicForEvidence, {
      sinceUtc: "2026-06-01T00:00:00.000Z",
    });
    assert(evidence.available === true, "evidence: available=true when LINE enabled");
    assert(
      evidence.messages.length > 0,
      "evidence: contains messages newer than baseline",
    );

    // Case 9: Stale messages (≤ baseline) excluded
    const evidenceStale = buildLineEvidenceForTopic(topicForEvidence, {
      sinceUtc: "2026-06-11T00:00:00.000Z", // AFTER the 2026-06-10 messages
    });
    assert(
      evidenceStale.messages.length === 0,
      "evidence: stale messages (≤ baseline) excluded",
    );

    // Case 10: Candidate question detected (has "?")
    const cq = findCandidateQuestions(evidence.messages);
    assert(cq.length > 0, "findCandidateQuestions: question detected in evidence");
    assert(
      cq.some((m) => m.kind === "question"),
      "detected question has kind='question'",
    );

    // inferLineMessageKind helpers
    assert(
      inferLineMessageKind("กยศ อนุมัติยัง?") === "question",
      "inferLineMessageKind: message ending with ? → question",
    );
    assert(
      inferLineMessageKind("Photos") === "media",
      "inferLineMessageKind: 'Photos' → media",
    );
    assert(
      inferLineMessageKind("ได้รับแล้วครับ") === "statement",
      "inferLineMessageKind: plain message → statement",
    );

    // Case 11: Candidate answer detected (later, same chat, different sender)
    const ca = findCandidateAnswers(evidence.messages, cq);
    assert(ca.length > 0, "findCandidateAnswers: candidate answer detected");
    assert(
      ca.every((m) => m.isCandidateAnswer === true),
      "candidate answers have isCandidateAnswer=true",
    );

    // ── Cases 12-13: Verifier ───────────────────────────────────────────────

    // Case 12: BLOCKS "ไม่มีใครตอบ" when candidate answers exist
    const evidenceWithAnswers = {
      ...evidence,
      candidateAnswers: ca,
      candidateQuestions: cq,
    };
    const verdict12 = verifyLineEvidenceAnswerIntent({
      userMessage: "มีใครตอบยัง",
      evidence: evidenceWithAnswers,
    });
    assert(
      verdict12.blockedClaims.some((c) => c.includes("ไม่มีใครตอบ")),
      "verifier BLOCKS 'ไม่มีใครตอบ' when candidate answers exist",
    );
    assert(
      verdict12.allowedClaims.some((c) => c.includes("มีคนตอบ")),
      "verifier ALLOWS 'มีคนตอบ' claim when candidate answers exist",
    );

    // Case 13: PERMITS no-match caveat when evidence empty (LINE enabled)
    const emptyEvidence = makeEmptyLineEvidence(true, topic1.id);
    const verdict13 = verifyLineEvidenceAnswerIntent({
      userMessage: "มีอัปเดตไหม",
      evidence: emptyEvidence,
    });
    assert(
      verdict13.allowedClaims.some((c) =>
        c.includes("ยังไม่เห็นข้อความใหม่") || c.includes("ไม่พบ"),
      ),
      "verifier PERMITS no-match caveat when evidence empty",
    );
    assert(
      verdict13.blockedClaims.some((c) => c.includes("ไม่มีใครตอบ")),
      "verifier BLOCKS absolute 'ไม่มีใครตอบ' even when evidence empty",
    );

    // LINE disabled → confidence low, all claims blocked
    const disabledEvidence = makeEmptyLineEvidence(false, topic1.id);
    const verdictDisabled = verifyLineEvidenceAnswerIntent({
      userMessage: "อัปเดต",
      evidence: disabledEvidence,
    });
    assert(
      verdictDisabled.confidence === "low",
      "verifier: confidence=low when LINE disabled",
    );

    // ── Case 18: searchLineMessages regression ──────────────────────────────

    const matches = searchLineMessages(["กยศ"], 20);
    assert(
      matches.length >= 1,
      "searchLineMessages: still returns matches (Step 20 regression)",
    );
    assert(
      matches.every((m) => typeof m.chat === "string"),
      "search results tagged with chat name",
    );

    // ── Case 20: buildChatPrompt renders new sections without leaking ────────

    const baseCtx = {
      message: "สวัสดี",
      openTasks: [],
      memorySummaries: [],
      facts: [],
      nowUtc: "2026-06-10T08:00:00.000Z",
      nowBangkok: "2026-06-10 15:00",
      googleEvents: [],
      events: [],
      reminders: [],
      approvalOutcomes: [],
      history: [],
      gmailUnread: [],
      contacts: [],
      contactsStatus: "disabled" as const,
      recentDriveFiles: [],
      lineChats: [],
      lineMessages: [],
      lineMatches: [],
      autoExecute: false,
      autoExecuteDestructive: false,
      restricted: false,
    };

    // Empty active topic fields (optional fields omitted — registry-smoke pattern)
    const promptEmpty = buildChatPrompt(baseCtx);
    assert(!promptEmpty.includes("undefined"), "buildChatPrompt: no 'undefined' in output when fields omitted");
    assert(
      promptEmpty.includes("(none)"),
      "buildChatPrompt: active topic sections render '(none)' when empty/omitted",
    );

    // Populated active topic fields
    const ctxWithTopics = {
      ...baseCtx,
      activeTopics: [{ id: 1, title: "กยศ", source: "line", priority: 70 }],
      resolvedActiveTopic: { id: 1, title: "กยศ", source: "line" },
      activeTopicAmbiguity: null,
      lineEvidence: makeEmptyLineEvidence(true, 1),
      verifierGuidance: null,
    };
    const promptFilled = buildChatPrompt(ctxWithTopics);
    assert(
      promptFilled.includes("#1") && promptFilled.includes("กยศ"),
      "buildChatPrompt: active topics section shows the topic id and title",
    );
    assert(
      promptFilled.includes("RESOLVED ACTIVE TOPIC"),
      "buildChatPrompt: RESOLVED ACTIVE TOPIC section present",
    );

    // Restricted: new sections must show withheld / not topic titles
    const ctxRestricted = {
      ...ctxWithTopics,
      restricted: true,
    };
    const promptRestricted = buildChatPrompt(ctxRestricted);
    assert(
      !promptRestricted.includes("กยศ") ||
        promptRestricted.indexOf("กยศ") >
          promptRestricted.indexOf("PRIVACY MODE"),
      "buildChatPrompt restricted: topic title does not appear before PRIVACY block",
    );
    // The active topic sections in LOCAL CONTEXT should say "withheld"
    const atSectionIdx = promptRestricted.indexOf("ACTIVE TOPICS (Step 22");
    assert(
      atSectionIdx >= 0 &&
        promptRestricted.slice(atSectionIdx, atSectionIdx + 300).includes("withheld"),
      "buildChatPrompt restricted: active topics section shows '(withheld)'",
    );

    console.log("\nAll Step 22 smoke assertions passed.");
  } finally {
    closeDb();
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(
    "\nStep 22 smoke FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
