import type { FastifyInstance } from "fastify";
import { agendaBounds } from "../services/agenda.js";
import {
  googleEventListResponseSchema,
  scheduleHealthResponseSchema,
} from "../schemas/googleCalendar.js";
import {
  realGoogleEventsFetcher,
  type GoogleEventsFetcher,
} from "../services/googleCalendar.js";
import { analyzeSchedule } from "../services/scheduleHealth.js";

/** Plugin options. `calendarFetcher` is injectable so tests can stub Google. */
export interface CalendarRouteOptions {
  calendarFetcher?: GoogleEventsFetcher;
}

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

  app.get("/api/calendar/today", async () => {
    const { todayStartUtc, todayEndUtc } = agendaBounds();
    return fetchWindow(fetchEvents, todayStartUtc, todayEndUtc);
  });

  app.get("/api/calendar/upcoming", async () => {
    const { todayEndUtc, upcomingEndUtc } = agendaBounds();
    return fetchWindow(fetchEvents, todayEndUtc, upcomingEndUtc);
  });

  // Tier 1 schedule health: analyze the full today+upcoming window for
  // overlaps/gaps/overload. Read-only and fail-closed; proposes nothing.
  app.get("/api/calendar/health", async () => {
    const { todayStartUtc, upcomingEndUtc } = agendaBounds();
    try {
      const events = await fetchEvents(todayStartUtc, upcomingEndUtc);
      const { findings } = analyzeSchedule(events);
      return scheduleHealthResponseSchema.parse({ findings, available: true });
    } catch {
      return scheduleHealthResponseSchema.parse({
        findings: [],
        available: false,
      });
    }
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
