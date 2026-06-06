import type { FastifyInstance } from "fastify";
import { agendaBounds } from "../services/agenda.js";
import { googleEventListResponseSchema } from "../schemas/googleCalendar.js";
import {
  realGoogleEventsFetcher,
  type GoogleEventsFetcher,
} from "../services/googleCalendar.js";

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
