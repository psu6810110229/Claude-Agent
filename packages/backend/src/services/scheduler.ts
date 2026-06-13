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
} from "../config.js";
import { getConfigBool } from "../db/repositories/configRepo.js";
import { listReminders } from "../db/repositories/reminderRepo.js";
import { listEvents } from "../db/repositories/eventRepo.js";
import { listPendingApprovals } from "../db/repositories/approvalRepo.js";
import { insertNotificationIfNew } from "../db/repositories/notificationRepo.js";
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
