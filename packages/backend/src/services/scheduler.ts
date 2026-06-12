import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { SCHEDULER_INTERVAL_MS, SCHEDULER_EVENT_LEAD_MS } from "../config.js";
import { listReminders } from "../db/repositories/reminderRepo.js";
import { listEvents } from "../db/repositories/eventRepo.js";
import { insertNotificationIfNew } from "../db/repositories/notificationRepo.js";
import { logActivity } from "../db/repositories/activityRepo.js";
import { bucketReminders } from "./agenda.js";
import type { DesktopNotifier } from "./desktopNotifier.js";
import type { TtsSynthesizer } from "./tts.js";
import type { AudioPlayer } from "./audioPlayer.js";
import { reminderDueLine, eventSoonLine } from "./voiceLines.js";

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
 * `nag` is reserved for Phase 13.3 (approval nag); ignored here.
 */
export function runSchedulerTick(
  now: Date,
  notifier: DesktopNotifier,
  voice?: SchedulerVoice,
  nag?: unknown,
): void {
  void nag; // used in 13.3
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
}

/**
 * Start the background scheduler. Runs one tick immediately, then every
 * `SCHEDULER_INTERVAL_MS`. Returns a handle whose `stop()` clears the timer.
 */
export function startScheduler(
  notifier: DesktopNotifier,
  voice?: SchedulerVoice,
): SchedulerHandle {
  function tick(): void {
    try {
      runSchedulerTick(new Date(), notifier, voice);
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
