import { listTasks } from "../db/repositories/taskRepo.js";
import { listApprovals } from "../db/repositories/approvalRepo.js";
import { listRecentActivity } from "../db/repositories/activityRepo.js";
import { listMemoryEntries } from "../db/repositories/memoryRepo.js";
import { listEvents } from "../db/repositories/eventRepo.js";
import { listReminders } from "../db/repositories/reminderRepo.js";
import { briefOutputSchema, type BriefType } from "../schemas/brief.js";
import type { AiAction } from "../schemas/aiCommand.js";
import { buildBriefPrompt, type BriefContext } from "./briefPrompt.js";
import {
  agendaBounds,
  bangkokWallClock,
  bucketEvents,
  bucketReminders,
} from "./agenda.js";
import { unwrapJsonOutput } from "./jsonOutput.js";
import { ClaudeError, type ClaudeInvoker } from "./claudeClient.js";
import {
  realGoogleEventsFetcher,
  type GoogleEventsFetcher,
} from "./googleCalendar.js";
import {
  CLAUDE_CONTEXT_TASK_CAP,
  CLAUDE_BRIEF_TIMEOUT_MS,
  BRIEF_ACTIVITY_LIMIT,
  BRIEF_APPROVALS_CAP,
  BRIEF_EVENT_CAP,
  BRIEF_REMINDER_CAP,
  nowIso,
} from "../config.js";

/**
 * Brief orchestration (Step 8). Pure proposal pipeline — it reads a compact,
 * local-only context, invokes Claude, and validates the output. It performs NO
 * database or file writes; the route routes any valid actions into the approval
 * queue. Every branch fails closed. Mirrors `runAiCommand`.
 */

/**
 * Activity event types that represent a genuine, user-meaningful CHANGE to the
 * system of record — the only events a brief should reflect on. This is an
 * allowlist on purpose: internal/runtime/diagnostic events (`brief.*`,
 * `ai.command.*`, `command.*`, `approval.create`, `memory.propose`) are noise
 * and, worse, feed stale failures back into the next brief as if they were
 * current truth. Pending work is conveyed separately via the approval COUNT.
 */
const BRIEF_RELEVANT_EVENTS = new Set<string>([
  "task.create",
  "task.update",
  "task.archive",
  "memory.write",
  "approval.approve",
  "approval.reject",
]);

/** True only for genuine state-change events worth surfacing in a brief. */
export function isBriefRelevantEvent(eventType: string): boolean {
  return BRIEF_RELEVANT_EVENTS.has(eventType);
}

/**
 * How many recent rows to scan before filtering. We over-fetch then filter to
 * the allowlist so a burst of internal events can't crowd out real changes from
 * the capped window.
 */
const BRIEF_ACTIVITY_SCAN = 100;

export type BriefResult =
  | { kind: "generated"; summary: string; actions: AiAction[]; notes?: string }
  | { kind: "rejected"; message: string }
  | { kind: "failed"; reason: string; message: string };

/** Build the compact context snapshot for a brief. */
async function buildBriefContext(
  fetchGoogle: GoogleEventsFetcher,
): Promise<BriefContext> {
  const openTasks = listTasks()
    .filter((t) => t.status === "open")
    .slice(0, CLAUDE_CONTEXT_TASK_CAP)
    .map((t) => ({ id: t.id, title: t.title.slice(0, 120) }));

  const pending = listApprovals().filter((a) => a.status === "pending");
  const pendingApprovals = pending
    .slice(0, BRIEF_APPROVALS_CAP)
    .map((a) => ({ id: a.id, action_type: a.action_type }));

  // Over-fetch, drop internal/diagnostic/runtime events, then cap. This keeps
  // stale failures and brief/AI runtime chatter out of the brief context.
  const recentActivity = listRecentActivity(BRIEF_ACTIVITY_SCAN)
    .filter((a) => isBriefRelevantEvent(a.event_type))
    .slice(0, BRIEF_ACTIVITY_LIMIT)
    .map((a) => ({
      event_type: a.event_type,
      detail: a.detail ? a.detail.slice(0, 120) : null,
    }));

  // memory_index SUMMARIES only — never file contents (summaries are capped at
  // 200 chars by the memory schema).
  const memorySummaries = listMemoryEntries().map((m) => ({
    slug: m.slug,
    summary: m.summary,
  }));

  // Today + upcoming (7-day) events and overdue/today/upcoming reminders, bucketed
  // in Asia/Bangkok. Read-only — computing "overdue" never fires anything.
  const now = new Date();
  const eb = bucketEvents(listEvents(), now);
  const events = [...eb.today, ...eb.upcoming]
    .slice(0, BRIEF_EVENT_CAP)
    .map((e) => ({ id: e.id, starts_at: e.starts_at, title: e.title.slice(0, 120) }));

  const rb = bucketReminders(listReminders(), now);
  const reminders = [
    ...rb.overdue.map((r) => ({ r, bucket: "overdue" as const })),
    ...rb.today.map((r) => ({ r, bucket: "today" as const })),
    ...rb.upcoming.map((r) => ({ r, bucket: "upcoming" as const })),
  ]
    .slice(0, BRIEF_REMINDER_CAP)
    .map(({ r, bucket }) => ({
      id: r.id,
      due_at: r.due_at,
      title: r.title.slice(0, 120),
      bucket,
    }));

  // Google Calendar (Step 10) - PRIMARY schedule. Today + upcoming windows
  // fetched server-side in Bangkok bounds. Fails closed: any
  // disabled/config/auth/API error yields no Google rows; the brief still works.
  const { todayStartUtc, todayEndUtc, upcomingEndUtc } = agendaBounds(now);
  let googleEvents: BriefContext["googleEvents"] = [];
  try {
    const [gToday, gUpcoming] = await Promise.all([
      fetchGoogle(todayStartUtc, todayEndUtc),
      fetchGoogle(todayEndUtc, upcomingEndUtc),
    ]);
    googleEvents = [
      ...gToday.map((e) => ({ e, bucket: "today" as const })),
      ...gUpcoming.map((e) => ({ e, bucket: "upcoming" as const })),
    ]
      .slice(0, BRIEF_EVENT_CAP)
      .map(({ e, bucket }) => ({
        start: e.start,
        title: e.title.slice(0, 120),
        allDay: e.allDay,
        bucket,
        calendarName: e.calendarName ? e.calendarName.slice(0, 80) : null,
      }));
  } catch {
    googleEvents = [];
  }

  return {
    openTasks,
    pendingApprovalCount: pending.length,
    pendingApprovals,
    recentActivity,
    memorySummaries,
    nowUtc: nowIso(),
    nowBangkok: bangkokWallClock(now),
    googleEvents,
    events,
    reminders,
  };
}

export async function runBrief(
  type: BriefType,
  invoke: ClaudeInvoker,
  fetchGoogle: GoogleEventsFetcher = realGoogleEventsFetcher,
): Promise<BriefResult> {
  const prompt = buildBriefPrompt(type, await buildBriefContext(fetchGoogle));

  // 1. Invoke Claude with the longer brief timeout. Any spawn/timeout/disabled
  //    error fails closed.
  let raw: string;
  try {
    raw = await invoke(prompt, { timeoutMs: CLAUDE_BRIEF_TIMEOUT_MS });
  } catch (err) {
    if (err instanceof ClaudeError) {
      return { kind: "failed", reason: err.reason, message: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "failed", reason: "spawn", message };
  }

  // 2. Normalize (trim + unwrap a single outer code fence only) then strict
  //    JSON parse. No first-{-to-last-} extraction, no repair; prose still fails.
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJsonOutput(raw));
  } catch {
    return { kind: "rejected", message: "Claude output was not valid JSON." };
  }

  // 3. Validate against the strict brief schema (unknown action types / bad
  //    payloads / extra keys / too many actions / missing summary are rejected).
  const check = briefOutputSchema.safeParse(parsed);
  if (!check.success) {
    const detail = check.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return {
      kind: "rejected",
      message: `Claude output failed validation: ${detail}`,
    };
  }

  return {
    kind: "generated",
    summary: check.data.summary,
    actions: check.data.actions,
    notes: check.data.notes,
  };
}
