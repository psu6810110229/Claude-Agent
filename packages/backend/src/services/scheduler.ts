import { SCHEDULER_INTERVAL_MS, SCHEDULER_EVENT_LEAD_MS } from "../config.js";
import { listReminders } from "../db/repositories/reminderRepo.js";
import { listEvents } from "../db/repositories/eventRepo.js";
import { insertNotificationIfNew } from "../db/repositories/notificationRepo.js";
import { logActivity } from "../db/repositories/activityRepo.js";
import { bucketReminders } from "./agenda.js";
import type { DesktopNotifier } from "./desktopNotifier.js";

/**
 * Scheduler (Step 11). Ticks on a fixed interval, detects newly-due reminders
 * and soon-starting events, dedup-inserts notification rows, logs activity, and
 * fires desktop toasts for net-new notifications.
 *
 * Design choices:
 * - Pure date math only — NO Claude, NO approval queue, NO calendar writes.
 * - Dedup is enforced by the DB UNIQUE(kind, source_id) index — every reminder
 *   or event fires at most one notification regardless of how many ticks pass.
 * - Bad ticks are caught and logged; the interval is never stopped on error.
 * - `runSchedulerTick` is exported separately so smoke tests can drive it
 *   directly with a stubbed notifier without starting the real interval.
 */

export interface SchedulerHandle {
  stop(): void;
}

/**
 * One scheduler tick. Pure side-effects (DB reads + writes + log + toast).
 * Safe to call at any time; wrapped in try/catch by `startScheduler`.
 */
export function runSchedulerTick(
  now: Date,
  notifier: DesktopNotifier,
): void {
  const nowUtc = now.toISOString();

  // --- Reminders: fire any that are now overdue (due_at <= now) ---
  const reminders = listReminders();
  const { overdue, today: dueToday } = bucketReminders(reminders, now);
  // Fire both overdue AND those due right now (today bucket, due_at <= nowUtc).
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
    }
  }
}

/**
 * Start the background scheduler. Runs one tick immediately, then every
 * `SCHEDULER_INTERVAL_MS`. Returns a handle whose `stop()` clears the timer.
 */
export function startScheduler(notifier: DesktopNotifier): SchedulerHandle {
  function tick(): void {
    try {
      runSchedulerTick(new Date(), notifier);
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
