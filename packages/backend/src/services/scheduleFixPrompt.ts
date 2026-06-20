import { bangkokWallClock } from "./agenda.js";
import type {
  ScheduleHealthOptions,
  ScheduleFinding,
} from "./scheduleHealth.js";
import { SCHEDULE_FIX_MAX_PROPOSALS } from "../schemas/scheduleFix.js";

/**
 * Tier 2 prompt builder — AI-proposed schedule fixes.
 *
 * Builds the single prompt string passed to the provider. It is proposal-only:
 * the model returns `google_event.update` payloads with a reason, and the
 * backend queues each as a PENDING approval. The prompt feeds the Tier 1
 * findings, the user's schedule preferences, the events involved (with BOTH
 * Bangkok wall-clock and UTC instants to make timezone math unambiguous), and a
 * few recalled free-text notes about the user.
 */

const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One event the model may reschedule (timed events only; ids are real). */
export interface ScheduleFixEvent {
  id: string;
  title: string;
  /** RFC 3339 instant as returned by Google (offset form), or all-day date. */
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
}

export interface ScheduleFixContext {
  nowUtc: string;
  nowBangkok: string;
  prefs: ScheduleHealthOptions;
  events: ScheduleFixEvent[];
  findings: ScheduleFinding[];
  /** Recalled free-text facts about the user (preferences etc.). May be empty. */
  facts: string[];
}

/** Format an absolute instant as "<UTC ISO Z> (Bangkok <wall clock>)". */
function fmtInstant(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const utc = new Date(ms).toISOString();
  return `${utc} (Bangkok ${bangkokWallClock(new Date(ms))})`;
}

function eventLines(events: ScheduleFixEvent[]): string {
  const timed = events.filter((e) => !e.allDay && !Number.isNaN(Date.parse(e.start)));
  if (timed.length === 0) return "  (none)";
  return timed
    .map((e) => {
      const loc = e.location ? ` @ ${e.location}` : "";
      const end = e.end ? fmtInstant(e.end) : "(no end)";
      return `  - id=${e.id} | "${e.title}"${loc}\n      start: ${fmtInstant(
        e.start,
      )}\n      end:   ${end}`;
    })
    .join("\n");
}

function findingLines(findings: ScheduleFinding[]): string {
  if (findings.length === 0) return "  (none)";
  return findings
    .map((f, i) => {
      const ids = f.eventIds.length ? ` events=[${f.eventIds.join(", ")}]` : "";
      return `  [${i}] ${f.kind} (${f.severity}) — ${f.detail};${ids} window ${f.startUtc}→${f.endUtc}`;
    })
    .join("\n");
}

function protectedDaysText(days: number[]): string {
  if (days.length === 0) return "none";
  return days.map((d) => WEEKDAY_EN[d] ?? String(d)).join(", ");
}

export function buildScheduleFixPrompt(ctx: ScheduleFixContext): string {
  const { prefs } = ctx;
  const facts =
    ctx.facts.length > 0
      ? ctx.facts.map((f) => `  - ${f}`).join("\n")
      : "  (none)";

  return `You are the scheduling assistant for a local-first personal agent. You
PROPOSE schedule fixes only. You never execute anything; a human approves every
change through a separate approval queue. There is NO auto-reschedule.

Your job: look at the schedule FINDINGS below and, where a clean fix exists,
propose moving one or more events to resolve the issue. Each proposal is a
"google_event.update" that targets an EXISTING event by its exact id.

A proposal payload has this shape (id required; at least one other field):
  { "id": "<event id from EVENTS>", "starts_at": "<UTC ISO Z>", "ends_at": "<UTC ISO Z>", "location"?: "...", "title"?: "...", "notes"?: "..." }

DATE & TIME RULES (CRITICAL — get the timezone math right):
- The user's local timezone is Asia/Bangkok = UTC+7 (exactly 7 hours AHEAD of UTC).
- Every datetime you OUTPUT (starts_at/ends_at) must be ISO 8601 UTC ending in "Z".
- The EVENTS list gives every time in BOTH forms: the UTC instant and the Bangkok
  wall-clock. Reason about the move in Bangkok local time, then OUTPUT the UTC "Z"
  instant. Take the Bangkok wall-clock you intend and SUBTRACT 7 hours to get UTC.
  NEVER copy the Bangkok digits and append "Z" — that is wrong by 7 hours.
  Worked examples (Bangkok → UTC):
  * 15:00 (3pm) → 08:00Z          (15 − 7)
  * 06:00       → 23:00Z PREVIOUS day  (subtraction crossed midnight; date rolls back)
- SANITY CHECK before output: the UTC hour MUST equal the Bangkok hour minus 7
  (if negative, add 24 and move the UTC date back one day).

RESCHEDULE RULES:
- Only propose updates for events present in EVENTS, using their EXACT id. Never
  invent an id or move an event that is not listed.
- Preserve each event's original DURATION unless the finding itself is the
  duration (e.g. long_streak). When you shift start, shift end by the same amount.
- Keep moved events inside Bangkok work hours ${prefs.workStartHour}:00–${prefs.workEndHour}:00.
- Keep at least ${prefs.minBufferMin} minutes of buffer between consecutive events
  (${prefs.travelBufferMin} minutes when locations differ).
- Avoid these protected weekdays the user keeps clear: ${protectedDaysText(
    prefs.protectedDays,
  )}.
- Do NOT create a NEW overlap or conflict with any other event in EVENTS.
- If a finding cannot be fixed SAFELY by moving an event (e.g. a fixed external
  meeting, or no free slot), SKIP it — do not propose a bad move. Proposing
  nothing is correct when no clean fix exists.
- Set "finding_ref" to the [index] of the finding each proposal addresses.
- "reason": ONE concise sentence a human can read, e.g.
  "Move the dentist 30 min later to clear the overlap with standup."

CURRENT TIME: ${ctx.nowUtc} (Asia/Bangkok: ${ctx.nowBangkok}).

SCHEDULE PREFERENCES:
- Work hours (Bangkok): ${prefs.workStartHour}:00–${prefs.workEndHour}:00
- Min buffer: ${prefs.minBufferMin} min; travel buffer (different location): ${prefs.travelBufferMin} min
- Overload threshold: ${prefs.overloadDayMin} busy min/day; long streak: ${prefs.streakHours}h
- Protected weekdays: ${protectedDaysText(prefs.protectedDays)}

RELEVANT NOTES ABOUT THE USER (honor any stated time preferences):
${facts}

FINDINGS (issues to consider fixing; reference by [index]):
${findingLines(ctx.findings)}

EVENTS (the only events you may move; use the exact id):
${eventLines(ctx.events)}

OUTPUT CONTRACT (must follow exactly):
- Output a SINGLE JSON object and nothing else. No prose, no markdown, no fences.
- Shape: { "proposals": Proposal[], "notes"?: string }
- Each Proposal: { "payload": <google_event.update>, "reason": string, "finding_ref"?: number }
- "proposals" may contain at most ${SCHEDULE_FIX_MAX_PROPOSALS} items. If nothing can be
  safely fixed, return { "proposals": [] }.`;
}
