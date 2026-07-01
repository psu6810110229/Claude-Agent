import type { FastifyInstance } from "fastify";
import { agendaBounds, bangkokWallClock } from "../services/agenda.js";
import {
  googleEventListResponseSchema,
  scheduleHealthResponseSchema,
} from "../schemas/googleCalendar.js";
import {
  realGoogleEventsFetcher,
  searchGoogleCalendarEvents,
  type GoogleEventsFetcher,
} from "../services/googleCalendar.js";
import {
  SEARCH_WINDOW_FUTURE_DAYS,
  SEARCH_WINDOW_PAST_DAYS,
} from "../config.js";
import { z } from "zod";
import { analyzeSchedule } from "../services/scheduleHealth.js";
import { getSchedulePrefs } from "../services/schedulePrefs.js";
import { recallFacts } from "../services/factRecall.js";
import { proposeScheduleFixes } from "../services/scheduleFixProposer.js";
import type { ScheduleFixEvent } from "../services/scheduleFixPrompt.js";
import { scheduleFixResponseSchema } from "../schemas/scheduleFix.js";
import { createApproval } from "../db/repositories/approvalRepo.js";
import { logActivity } from "../db/repositories/activityRepo.js";
import { getProvider } from "../services/aiProvider.js";
import type { ClaudeInvoker } from "../services/claudeClient.js";

/**
 * Plugin options. `calendarFetcher` and `aiInvoker` are injectable so tests can
 * stub Google and the AI provider respectively.
 */
export interface CalendarRouteOptions {
  calendarFetcher?: GoogleEventsFetcher;
  /** Injectable keyword searcher (tests stub Google). Defaults to the real one. */
  calendarSearcher?: (
    q: string,
    timeMinIso: string,
    timeMaxIso: string,
  ) => Promise<import("../schemas/googleCalendar.js").GoogleEvent[]>;
  aiInvoker?: ClaudeInvoker;
}

/** Search query: required text + optional forward horizon (days), capped. */
const calendarSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  days: z.coerce.number().int().min(1).max(730).optional(),
});

/** Upcoming view range — the dashboard's 7/14/30-day window selector. */
const upcomingDaysQuerySchema = z.object({
  days: z.coerce.number().int().refine((n) => [7, 14, 30].includes(n)),
});

/**
 * Google Calendar read routes (Step 10).
 *
 * `today` and `upcoming` (next 7 days) windows are computed in Asia/Bangkok via
 * the shared `agendaBounds`, then passed to Google as server-side time filters.
 * Both endpoints FAIL CLOSED: any disabled/config/auth/API error returns an
 * empty list with `available: false` instead of erroring, so the dashboard and
 * brief degrade gracefully. There are deliberately no write endpoints; Google
 * writes happen only through approval-gated executor actions.
 */
export async function calendarRoutes(
  app: FastifyInstance,
  opts: CalendarRouteOptions,
): Promise<void> {
  const fetchEvents = opts.calendarFetcher ?? realGoogleEventsFetcher;
  const searchEvents = opts.calendarSearcher ?? searchGoogleCalendarEvents;

  // Keyword search across the calendar window (recent past + forward horizon),
  // so the user can find an event by name/place even far out. Read-only, fail
  // closed: any disabled/config/auth/API error returns available:false + [].
  app.get("/api/calendar/search", async (req, reply) => {
    const parsed = calendarSearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const forwardDays = parsed.data.days ?? SEARCH_WINDOW_FUTURE_DAYS;
    const { pastStartUtc, upcomingEndUtc } = agendaBounds(
      new Date(),
      forwardDays,
      SEARCH_WINDOW_PAST_DAYS,
    );
    try {
      const events = await searchEvents(
        parsed.data.q,
        pastStartUtc,
        upcomingEndUtc,
      );
      return googleEventListResponseSchema.parse({ events, available: true });
    } catch {
      return googleEventListResponseSchema.parse({
        events: [],
        available: false,
      });
    }
  });

  app.get("/api/calendar/today", async () => {
    const { todayStartUtc, todayEndUtc } = agendaBounds();
    return fetchWindow(fetchEvents, todayStartUtc, todayEndUtc);
  });

  app.get("/api/calendar/upcoming", async (req) => {
    // Optional view range: the dashboard offers 7/14/30-day windows. Anything
    // out of the allowlist falls back to the default 7-day agenda window.
    const parsed = upcomingDaysQuerySchema.safeParse(req.query);
    const days = parsed.success ? parsed.data.days : undefined;
    const { todayEndUtc, upcomingEndUtc } = agendaBounds(new Date(), days);
    return fetchWindow(fetchEvents, todayEndUtc, upcomingEndUtc);
  });

  // Tier 1 schedule health: analyze the full today+upcoming window for
  // overlaps/gaps/overload. Read-only and fail-closed; proposes nothing.
  app.get("/api/calendar/health", async () => {
    const { todayStartUtc, upcomingEndUtc } = agendaBounds();
    try {
      const events = await fetchEvents(todayStartUtc, upcomingEndUtc);
      const { findings } = analyzeSchedule(events, getSchedulePrefs());
      return scheduleHealthResponseSchema.parse({ findings, available: true });
    } catch {
      return scheduleHealthResponseSchema.parse({
        findings: [],
        available: false,
      });
    }
  });

  // Tier 2 schedule fixes: the AI PROPOSES reschedules for the Tier 1 findings.
  // Proposal-only and approval-gated — each accepted proposal is queued as a
  // PENDING approval (NEVER auto-executed, regardless of the auto-execute
  // toggle). Fails closed: any calendar/AI/parse error returns 200 with an empty
  // proposal list rather than erroring.
  app.post("/api/calendar/fix-proposals", async () => {
    const { todayStartUtc, upcomingEndUtc, nowUtc } = agendaBounds();

    let events;
    try {
      events = await fetchEvents(todayStartUtc, upcomingEndUtc);
    } catch {
      // Calendar unavailable → fail closed, nothing to propose.
      return scheduleFixResponseSchema.parse({ available: false, proposals: [] });
    }

    const prefs = getSchedulePrefs();
    const { findings } = analyzeSchedule(events, prefs);

    // Nothing flagged → no AI call (save tokens), no proposals.
    if (findings.length === 0) {
      return scheduleFixResponseSchema.parse({ available: true, proposals: [] });
    }

    // Recall free-text facts relevant to the issues (titles + kinds drive the
    // overlap score), so stated time preferences can inform good moves.
    const recallQuery = findings
      .map((f) => `${f.titles.join(" ")} ${f.kind} ${f.detail}`)
      .join(" ");
    const facts = recallFacts(recallQuery)
      .map((f) => f.content)
      .slice(0, 8);

    const fixEvents: ScheduleFixEvent[] = events.map((e) => ({
      id: e.id,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      location: e.location,
    }));

    // Provider: injected (tests) → else Gemini if configured → else Claude.
    const invoke =
      opts.aiInvoker ??
      (getProvider("gemini")?.isAvailable()
        ? getProvider("gemini")?.invoke
        : getProvider("claude")?.invoke);
    if (!invoke) {
      return scheduleFixResponseSchema.parse({
        available: true,
        proposals: [],
        notes: "AI provider is not available right now.",
      });
    }

    const result = await proposeScheduleFixes(
      {
        nowUtc,
        nowBangkok: bangkokWallClock(new Date()),
        prefs,
        events: fixEvents,
        findings,
        facts,
      },
      invoke,
    );

    if (result.kind !== "proposed") {
      // AI failed/rejected → fail closed, no approvals, never error the route.
      logActivity(
        "calendar.fix.unavailable",
        `schedule-fix ${result.kind}: ${
          result.kind === "failed" ? result.reason : "validation"
        }`,
      );
      return scheduleFixResponseSchema.parse({
        available: true,
        proposals: [],
        notes: "Could not generate schedule fixes right now.",
      });
    }

    // Queue every validated proposal as a PENDING approval (force-pending: this
    // route never goes through the auto-execute dispatcher). Execution still
    // happens only when the user approves the row through the normal queue.
    const titleById = new Map(events.map((e) => [e.id, e.title]));
    const proposals = result.proposals.map((p) => {
      const approval = createApproval("google_event.update", p.payload);
      logActivity(
        "calendar.fix.proposed",
        `approval #${approval.id} (google_event.update) from schedule-fix`,
      );
      return {
        approvalId: approval.id,
        actionType: "google_event.update" as const,
        payload: p.payload,
        reason: p.reason,
        findingKind: p.findingKind,
        eventTitle: titleById.get(p.payload.id) ?? null,
      };
    });

    return scheduleFixResponseSchema.parse({
      available: true,
      proposals,
      notes: result.notes,
    });
  });
}

async function fetchWindow(
  fetchEvents: GoogleEventsFetcher,
  minIso: string,
  maxIso: string,
): Promise<unknown> {
  try {
    const events = await fetchEvents(minIso, maxIso);
    return googleEventListResponseSchema.parse({ events, available: true });
  } catch {
    // Fail closed — never leak the error; just report unavailable.
    return googleEventListResponseSchema.parse({ events: [], available: false });
  }
}
