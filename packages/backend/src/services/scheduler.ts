import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import {
  SCHEDULER_ENABLED,
  SCHEDULER_INTERVAL_MS,
  SCHEDULER_EVENT_LEAD_MS,
  TTS_APPROVAL_NAG_DELAY_MS,
  TTS_APPROVAL_NAG_INTERVAL_MS,
  LINE_FOLLOWUP_SNIPPET_CAP,
  LINE_FOLLOWUP_SNIPPET_CHARS,
  LINE_FOLLOWUP_SEARCH_CAP,
  ACTIVE_TOPIC_TRIAGE_ENABLED,
} from "../config.js";
import { getConfigBool } from "../db/repositories/configRepo.js";
import { listReminders } from "../db/repositories/reminderRepo.js";
import { listEvents } from "../db/repositories/eventRepo.js";
import { listPendingApprovals } from "../db/repositories/approvalRepo.js";
import {
  insertNotificationIfNew,
  insertNotificationWithDedupKey,
} from "../db/repositories/notificationRepo.js";
import {
  listDueLineFollowups,
  markLineFollowupFired,
} from "../db/repositories/lineFollowupRepo.js";
import {
  listDueActiveTopicsForLineCheck,
  updateActiveTopicCheck,
} from "../db/repositories/activeTopicRepo.js";
import {
  buildLineEvidenceForTopic,
  EVIDENCE_MAX_LINES,
} from "./lineEvidence.js";
import { verifyLineEvidenceAnswerIntent } from "./evidenceVerifier.js";
import { searchLineMessages, isLineEnabled } from "./lineChat.js";
import {
  appendProgress,
  attachEvidenceMetadata,
  createJob,
  markDone,
  markFailed,
  transitionJob,
} from "./activeJob.js";
import { logActivity } from "../db/repositories/activityRepo.js";
import { bucketReminders } from "./agenda.js";
import type { DesktopNotifier } from "./desktopNotifier.js";
import type { TtsSynthesizer } from "./tts.js";
import type { AudioPlayer } from "./audioPlayer.js";
import { reminderDueLine, eventSoonLine, approvalNagLine } from "./voiceLines.js";

/**
 * Scheduler (Step 11 + 13.2). Ticks on a fixed interval, detects newly-due
 * reminders and soon-starting events, dedup-inserts notification rows, logs
 * activity, fires desktop toasts, and optionally speaks a voice line on the
 * backend speaker.
 *
 * Design choices:
 * - Pure date math only — NO Claude, NO approval queue, NO calendar writes.
 * - Dedup enforced by DB UNIQUE(kind, source_id) — each reminder/event fires
 *   at most one notification regardless of tick count.
 * - Voice: `runSchedulerTick` calls voice.synthesizer/player whenever `voice`
 *   is provided. Flag gating (TTS_ENABLED / TTS_SPEAKER_ENABLED) lives in
 *   index.ts (real wiring), not here — so tests can inject stubs without
 *   setting env flags.
 * - Bad ticks are caught and logged; the interval is never stopped on error.
 */

export interface SchedulerHandle {
  stop(): void;
}

/** Voice bundle injected for 13.2 backend speaker. */
export interface SchedulerVoice {
  synthesizer: TtsSynthesizer;
  player: AudioPlayer;
}

/**
 * In-memory nag state for Phase 13.3 approval nag.
 * Resets on process restart (accepted — first qualifying tick re-nags).
 *
 * Map keys:
 *   0 = global last-spoken timestamp (ms)
 *   approvalId = presence marker for cleanup (value = time last nagged)
 */
export interface NagState {
  lastNagAtMs: Map<number, number>;
}

export function createNagState(): NagState {
  return { lastNagAtMs: new Map() };
}

/**
 * Runtime gate for the scheduler: DB config override (Settings toggle) wins;
 * falls back to the env seed default. The interval always runs, but each tick
 * does work only when this is true — so toggling in Settings takes effect within
 * one interval, no restart. Mirrors isAutoExecuteEnabled (actionDispatcher).
 */
export function isSchedulerEnabled(): boolean {
  const dbValue = getConfigBool("scheduler_enabled");
  if (dbValue !== null) return dbValue;
  return SCHEDULER_ENABLED;
}

/**
 * Step 22 — runtime gate for proactive active-topic triage. DB config override
 * (`active_topic_triage_enabled`) wins; falls back to the env seed default
 * (OFF). Mirrors isSchedulerEnabled so Settings can toggle it within one tick.
 */
export function isActiveTopicTriageEnabled(): boolean {
  const dbValue = getConfigBool("active_topic_triage_enabled");
  if (dbValue !== null) return dbValue;
  return ACTIVE_TOPIC_TRIAGE_ENABLED;
}

/**
 * Fire-and-forget: synthesize `text` with `voice`, write to a temp wav,
 * hand it to the player, then clean up after 60 s.
 * Swallows all errors — voice is always best-effort.
 */
async function speakLine(text: string, voice: SchedulerVoice): Promise<void> {
  try {
    const wav = await voice.synthesizer.synthesize(text);
    if (!wav) return;
    const wavPath = path.join(os.tmpdir(), `jarvis-sched-${randomUUID()}.wav`);
    await writeFile(wavPath, wav);
    voice.player.play(wavPath);
    // Clean up the temp file after the player has had time to read it.
    setTimeout(() => { unlink(wavPath).catch(() => {}); }, 60_000);
  } catch {
    // fail soft — voice never breaks the scheduler
  }
}

/**
 * Step 21 — LINE follow-up checks. For each pending watch whose due_at has
 * arrived, search the EXPORTED LINE files (read-only, no live LINE, NO Claude)
 * for messages newer than the watch's baseline that match its keywords, then
 * fire ONE dedup'd `line.followup` notification and mark the watch fired.
 *
 * Safety:
 * - Read-only: only `searchLineMessages` (the existing keyword search) is used.
 * - Fail-soft: LINE disabled / unavailable → an explicit "couldn't check" /
 *   "no new matches" notification, never a throw.
 * - Activity log carries COUNTS ONLY — never message text, keywords, or topic.
 * - Snippets (capped, truncated) appear ONLY in the user-facing notification body.
 */
export function runLineFollowupChecks(
  nowUtc: string,
  notifier: DesktopNotifier,
): void {
  const due = listDueLineFollowups(nowUtc);
  if (due.length === 0) return;

  const lineOn = isLineEnabled();

  for (const watch of due) {
    let title: string;
    let body: string;
    let matchCount = 0;

    if (!lineOn) {
      title = `LINE: ${watch.topic}`;
      body = "ตรวจสอบไม่ได้ตอนนี้ (LINE export ปิดอยู่)";
    } else {
      // Newest-first across all exported chats; fail-soft → [].
      const hits = searchLineMessages(watch.keywords, LINE_FOLLOWUP_SEARCH_CAP)
        .filter((m) => m.atUtc > watch.baseline_at)
        .filter((m) =>
          watch.chat_filter
            ? m.chat.toLowerCase().includes(watch.chat_filter.toLowerCase())
            : true,
        );
      matchCount = hits.length;
      title = `LINE: ${watch.topic}`;
      if (matchCount === 0) {
        body = "ยังไม่พบข้อความใหม่ที่ตรงกับเรื่องนี้ (อิงจากไฟล์ export ล่าสุด)";
      } else {
        const snippets = hits
          .slice(0, LINE_FOLLOWUP_SNIPPET_CAP)
          .map((m) => {
            const who = m.sender ?? "(system)";
            const text = m.text.slice(0, LINE_FOLLOWUP_SNIPPET_CHARS);
            return `${who}: ${text}`;
          })
          .join("\n");
        body = `พบ ${matchCount} ข้อความใหม่ที่ตรงกับ "${watch.topic}"\n${snippets}`;
      }
    }

    insertNotificationIfNew("line.followup", watch.id, title, body, nowUtc);
    // Counts only — never message text, keywords, or topic.
    logActivity(
      "line_followup.checked",
      `id=${watch.id} matches=${matchCount} line_enabled=${lineOn ? 1 : 0}`,
    );
    notifier.notify(title, body);
    markLineFollowupFired(watch.id);
  }
}

/**
 * Step 22 — deterministic proactive active-topic triage. For each DUE active
 * topic (status=active, source line/mixed, cooldown elapsed) build a LINE
 * evidence bundle from the EXPORTED files only (read-only, NO Claude/Gemini,
 * no live LINE), then fire ONE dedup'd `line.active_topic` notification when NEW
 * evidence appears.
 *
 * Secretary behaviour (vs. raw Step 21):
 * - Silent on no relevant evidence — active topics do NOT notify every tick.
 * - Relevance is the evidence builder's keyword + chat_filter + recent-after-
 *   baseline filtering (weak one-word substring matches that fall outside the
 *   baseline/chat window are dropped). Verifier confidence must not be "low".
 * - Re-fire only on NEW evidence: dedup_key = `active_topic:<id>:<newestAtUtc>`
 *   so the SAME evidence instant never re-notifies; a later, newer instant can.
 * - Cooldown via listDueActiveTopicsForLineCheck (last_checked_at +
 *   cooldown_minutes) prevents spammy repeat checks.
 *
 * Safety:
 * - Gated OFF by default (isActiveTopicTriageEnabled). LINE disabled → silent.
 * - Activity log carries id + counts + fired flag ONLY — never title, keywords,
 *   snippets, or message text. Snippets live only in the notification body.
 */
/**
 * Deterministic FNV-1a hash of a dedup key → positive 31-bit integer, used as
 * the notification `source_id` for active-topic rows so the legacy
 * UNIQUE(kind, source_id) index does not false-block a re-fire (see callsite).
 */
function dedupKeyToSourceId(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2147483647) + 1; // 1 .. 2^31-1 (positive int)
}

export function runActiveTopicChecks(
  nowUtc: string,
  notifier: DesktopNotifier,
): void {
  if (!isActiveTopicTriageEnabled()) return;
  if (!isLineEnabled()) return; // no spam / no false claims while LINE is off

  const due = listDueActiveTopicsForLineCheck(nowUtc);
  if (due.length === 0) return;

  for (const topic of due) {
    const job = createJob({
      kind: "line.active_topic.triage",
      title: "LINE active topic triage",
      source: "active_topic",
      source_ref: String(topic.id),
    });

    try {
      transitionJob(
        job.id,
        "understanding",
        "กำลังเตรียมหัวข้อที่ติดตาม",
        { topic_id: topic.id },
      );

    // Only evidence newer than both the baseline and the last check counts.
    const sinceUtc =
      topic.last_checked_at && topic.last_checked_at > topic.baseline_at
        ? topic.last_checked_at
        : topic.baseline_at;

    transitionJob(
      job.id,
      "searching",
      "กำลังดู LINE export ล่าสุด...",
      { topic_id: topic.id, since_utc: sinceUtc },
    );
    const evidence = buildLineEvidenceForTopic(topic, { sinceUtc });

    // Always record the check so cooldown advances even on a no-match tick.
    updateActiveTopicCheck(topic.id, { last_checked_at: nowUtc });

    const verdict = verifyLineEvidenceAnswerIntent({ userMessage: "", evidence });

    let fired = 0;
    let jobDone = false;
    const matchCount = evidence.messages.length;
    appendProgress(
      job.id,
      matchCount > 0
        ? `เจอหลักฐาน ${matchCount} รายการ กำลังตรวจความสดของข้อมูล`
        : "ยังไม่พบหลักฐานใหม่จาก LINE export",
      { topic_id: topic.id, count: matchCount },
    );
    transitionJob(
      job.id,
      "verifying",
      "กำลังตรวจ metadata ของหลักฐาน",
      { topic_id: topic.id, count: matchCount },
    );
    attachEvidenceMetadata(job.id, {
      source: "line_export",
      source_ref: `active_topic:${topic.id}`,
      fetched_at: nowUtc,
      newest_at: evidence.newestAtUtc,
      stale: evidence.staleCaveat,
      capped: evidence.messages.length >= EVIDENCE_MAX_LINES,
      partial: !evidence.available,
      confidence: verdict.confidence,
      limitations: evidence.available
        ? ["export-based", "read-only", "message bodies omitted from job events"]
        : ["line-disabled-or-unavailable", "export-based", "read-only"],
      count: matchCount,
    });

    if (
      evidence.available &&
      matchCount > 0 &&
      evidence.newestAtUtc &&
      verdict.confidence !== "low"
    ) {
      const newestAt = evidence.newestAtUtc;
      const dedupKey = `active_topic:${topic.id}:${newestAt}`;
      // The legacy UNIQUE(kind, source_id) index still applies to every row. If
      // source_id were the bare topic id, the SAME topic could only ever fire
      // once, defeating re-fire on new evidence. Derive source_id from dedupKey
      // so it varies per (topic, evidence instant); the dedup_key partial index
      // is the precise guard (same instant → same key → no duplicate). The topic
      // id stays recoverable from dedup_key.
      const sourceId = dedupKeyToSourceId(dedupKey);
      const title = `LINE: ${topic.title}`;

      const snippets = evidence.messages
        .slice(0, LINE_FOLLOWUP_SNIPPET_CAP)
        .map((m) => {
          const who = m.sender ?? "(system)";
          const text = m.text.slice(0, LINE_FOLLOWUP_SNIPPET_CHARS);
          return `${who}: ${text}`;
        })
        .join("\n");
      const body =
        `จากเรื่องที่ให้ตามไว้ ตอนนี้ใน LINE export ล่าสุดมี ${matchCount} ` +
        `ข้อความใหม่เกี่ยวกับ "${topic.title}"\n${snippets}`;

      transitionJob(
        job.id,
        "reporting",
        "พบข้อมูลใหม่และกำลังส่งการแจ้งเตือน",
        { topic_id: topic.id, count: matchCount, newest_at: newestAt },
      );
      const inserted = insertNotificationWithDedupKey(
        "line.active_topic",
        sourceId,
        title,
        body,
        nowUtc,
        dedupKey,
      );

      if (inserted) {
        fired = 1;
        notifier.notify(title, body);
        // last_summary stays count-based (no raw body): ≤200 chars, user-safe.
        updateActiveTopicCheck(topic.id, {
          last_evidence_at: newestAt,
          last_summary: `${matchCount} new (export ${newestAt})`,
        });
        markDone(job.id, `แจ้งเตือนข้อมูลใหม่ ${matchCount} รายการแล้ว`);
        jobDone = true;
      } else {
        markDone(job.id, "หลักฐานนี้เคยแจ้งเตือนแล้ว");
        jobDone = true;
      }
    }

    // id + counts + fired flag ONLY — never title/keywords/snippets/text.
    if (!jobDone) {
      transitionJob(
        job.id,
        "reporting",
        "ยังไม่มีข้อมูลใหม่ที่มั่นใจพอจะแจ้งเตือน",
        { topic_id: topic.id, count: matchCount, confidence: verdict.confidence },
      );
      markDone(job.id, "เช็กแล้ว ยังไม่มีข้อมูลใหม่ที่ต้องแจ้งเตือน");
    }

    logActivity(
      "active_topic.checked",
      `id=${topic.id} matches=${matchCount} fired=${fired}`,
    );
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      try {
        markFailed(job.id, detail);
      } catch {
        // keep original scheduler error path
      }
      throw err;
    }
  }
}

/**
 * One scheduler tick. Pure side-effects (DB reads + writes + log + toast + voice).
 * Safe to call at any time; wrapped in try/catch by `startScheduler`.
 *
 * `voice` is optional — when omitted the scheduler behaves exactly as Step 11.
 * `nag` drives Phase 13.3 approval nag; ignored when voice is absent.
 *
 * Flag gating (TTS_ENABLED / TTS_SPEAKER_ENABLED) lives in index.ts — not here.
 * This function calls voice.synthesizer/player whenever `voice` is provided so
 * tests can inject stubs without setting env flags.
 */
export function runSchedulerTick(
  now: Date,
  notifier: DesktopNotifier,
  voice?: SchedulerVoice,
  nag?: NagState,
): void {
  const nowUtc = now.toISOString();

  // --- Reminders: fire any that are now overdue (due_at <= now) ---
  const reminders = listReminders();
  const { overdue, today: dueToday } = bucketReminders(reminders, now);
  const dueNow = [
    ...overdue,
    ...dueToday.filter((r) => r.due_at <= nowUtc),
  ];
  for (const r of dueNow) {
    const inserted = insertNotificationIfNew(
      "reminder.due",
      r.id,
      r.title,
      r.notes ?? null,
      nowUtc,
    );
    if (inserted) {
      logActivity(
        "notification.fired",
        `reminder.due id=${r.id} title=${JSON.stringify(r.title)}`,
      );
      notifier.notify(r.title, r.notes ?? undefined);
      if (voice) {
        void speakLine(reminderDueLine(r.title), voice);
      }
    }
  }

  // --- Events: fire those starting within the lead window ---
  const leadEnd = new Date(now.getTime() + SCHEDULER_EVENT_LEAD_MS).toISOString();
  const events = listEvents();
  const soonEvents = events.filter(
    (e) => e.starts_at >= nowUtc && e.starts_at < leadEnd,
  );
  for (const e of soonEvents) {
    const body = e.location
      ? `Starting soon · ${e.location}`
      : "Starting soon";
    const inserted = insertNotificationIfNew(
      "event.soon",
      e.id,
      e.title,
      body,
      nowUtc,
    );
    if (inserted) {
      logActivity(
        "notification.fired",
        `event.soon id=${e.id} title=${JSON.stringify(e.title)}`,
      );
      notifier.notify(e.title, body);
      if (voice) {
        void speakLine(eventSoonLine(e.title, e.location ?? undefined), voice);
      }
    }
  }

  // --- LINE follow-up checks (Step 21) ---
  // Read-only export search; isolated try/catch so a LINE issue never blocks
  // reminder/event firing or the approval nag.
  try {
    runLineFollowupChecks(nowUtc, notifier);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    logActivity("line_followup.error", detail);
  }

  // --- Active-topic proactive triage (Step 22, Phase E) ---
  // Deterministic, read-only export search, NO model call. Isolated try/catch so
  // a triage error never blocks reminder/event firing, the Step 21 path, or nag.
  try {
    runActiveTopicChecks(nowUtc, notifier);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    logActivity("active_topic.error", detail);
  }

  // --- Approval nag (Phase 13.3) ---
  // Only runs when both voice and nag state are injected. No env-flag check here;
  // index.ts withholds `voice` when TTS_SPEAKER_ENABLED is off.
  if (voice && nag) {
    const pending = listPendingApprovals();
    const nowMs = now.getTime();
    const due = pending.filter(
      (a) => nowMs - Date.parse(a.created_at) >= TTS_APPROVAL_NAG_DELAY_MS,
    );

    if (due.length > 0) {
      const lastNagAt = nag.lastNagAtMs.get(0);
      if (lastNagAt === undefined || nowMs - lastNagAt >= TTS_APPROVAL_NAG_INTERVAL_MS) {
        void speakLine(approvalNagLine(due.length), voice);
        nag.lastNagAtMs.set(0, nowMs);
        for (const a of due) {
          nag.lastNagAtMs.set(a.id, nowMs);
        }
        logActivity("tts.approval_nag", `count=${due.length}`);
      }
    }

    // Cleanup: remove per-id entries for resolved approvals;
    // clear global timer when no due items remain so the next qualifying approval
    // nags immediately rather than waiting out the previous interval.
    const pendingIds = new Set(pending.map((a) => a.id));
    for (const [key] of [...nag.lastNagAtMs]) {
      if (key !== 0 && !pendingIds.has(key)) {
        nag.lastNagAtMs.delete(key);
      }
    }
    if (due.length === 0) {
      nag.lastNagAtMs.delete(0);
    }
  }
}

/**
 * Start the background scheduler. Runs one tick immediately, then every
 * `SCHEDULER_INTERVAL_MS`. Returns a handle whose `stop()` clears the timer.
 */
export function startScheduler(
  notifier: DesktopNotifier,
  voice?: SchedulerVoice,
): SchedulerHandle {
  // Nag state lives here; resets on restart (accepted per design).
  const nag = createNagState();

  function tick(): void {
    // Runtime gate: skip all work while disabled (interval keeps ticking cheaply).
    if (!isSchedulerEnabled()) return;
    try {
      runSchedulerTick(new Date(), notifier, voice, nag);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      try {
        logActivity("scheduler.tick_error", detail);
      } catch {
        // best-effort log
      }
    }
  }

  // Run immediately on start, then on interval.
  tick();
  const handle = setInterval(tick, SCHEDULER_INTERVAL_MS);
  // Allow the Node process to exit even with the interval running.
  handle.unref();

  return {
    stop(): void {
      clearInterval(handle);
    },
  };
}
