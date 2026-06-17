import fs from "node:fs";
import { google } from "googleapis";
import {
  GOOGLE_CALENDAR_ENABLED,
  GOOGLE_CALENDAR_ID,
  GOOGLE_CLIENT_SECRET_PATH,
  GOOGLE_TOKEN_PATH,
  GOOGLE_CALENDAR_MAX_RESULTS,
} from "../config.js";
import { getConfigBool } from "../db/repositories/configRepo.js";
import {
  googleEventSchema,
  type CreateGoogleEventPayload,
  type UpdateGoogleEventPayload,
  type DeleteGoogleEventPayload,
  type GoogleEvent,
} from "../schemas/googleCalendar.js";

/**
 * Google Calendar connector (Step 10+).
 *
 * SAFETY BOUNDARIES:
 * - Reads are fail-closed and display-oriented.
 * - Writes (create/update/delete) are called only by the approval executor,
 *   after an approval has been actioned (Step 14 added update/delete; deletes
 *   are always confirm-gated). Update/delete snapshot the prior event first so
 *   the change is recoverable (undo_json).
 * - FAILS CLOSED. Disabled flag, missing/invalid credential files, or any API
 *   error throw `GoogleCalendarError`; callers turn that into an empty,
 *   `available: false` result so the dashboard/brief degrade gracefully.
 * - NEVER LOGS SECRETS. Client secret and refresh token are read from gitignored
 *   files and used only to construct the OAuth client. Error messages are
 *   generic and never include file contents, tokens, or raw API error bodies.
 */

export type GoogleFailureReason = "disabled" | "config" | "auth" | "api";

export class GoogleCalendarError extends Error {
  constructor(
    public readonly reason: GoogleFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "GoogleCalendarError";
  }
}

/**
 * Pulls the Google API's own error reason out of a thrown googleapis/gaxios
 * error so callers see the real cause (e.g. "Invalid value for: start") instead
 * of a generic message. Google error messages describe the request, never the
 * credential — safe to surface. Returns empty string when nothing usable.
 */
function googleErrorDetail(err: unknown): string {
  const anyErr = err as {
    response?: { data?: { error?: { message?: string } | string } };
    errors?: Array<{ message?: string }>;
    message?: string;
  };
  const data = anyErr?.response?.data?.error;
  const fromBody = typeof data === "string" ? data : data?.message;
  const detail = fromBody ?? anyErr?.errors?.[0]?.message ?? anyErr?.message;
  return typeof detail === "string" && detail.trim() ? ` (${detail.trim()})` : "";
}

/**
 * Fetches normalized Google events whose times fall within [timeMin, timeMax).
 * Injectable so tests can stub it without touching the network or real auth.
 */
export type GoogleEventsFetcher = (
  timeMinIso: string,
  timeMaxIso: string,
) => Promise<GoogleEvent[]>;

export interface CreatedGoogleEvent {
  id: string;
  htmlLink: string | null;
}

/**
 * Minimal snapshot of a Google event's prior state, captured before an update
 * or delete so the change can be undone. Stored verbatim as the approval's
 * undo_json (JSON string). Never contains tokens/secrets — only event fields.
 */
export interface GoogleEventSnapshot {
  summary: string | null;
  start: { dateTime?: string | null; date?: string | null } | null;
  end: { dateTime?: string | null; date?: string | null } | null;
  location: string | null;
  description: string | null;
}

export interface UpdatedGoogleEvent {
  id: string;
  htmlLink: string | null;
  undoSnapshot: GoogleEventSnapshot;
}

export interface DeletedGoogleEvent {
  id: string;
  undoSnapshot: GoogleEventSnapshot;
}

/**
 * Whether the connector is enabled. DB config overrides the env-var so the
 * dashboard can toggle at runtime without a restart.
 */
export function isGoogleCalendarEnabled(): boolean {
  const dbValue = getConfigBool("google_calendar_enabled");
  if (dbValue !== null) return dbValue;
  return GOOGLE_CALENDAR_ENABLED;
}

interface OAuthClientConfig {
  client_id: string;
  client_secret: string;
  redirect_uris?: string[];
}

/** Read + parse a JSON credential file, failing closed with a generic message. */
function readJsonFile(path: string, label: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(path, "utf8");
  } catch {
    throw new GoogleCalendarError(
      "config",
      `Missing ${label}. Run the google-auth setup first.`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new GoogleCalendarError("config", `Invalid ${label} (not valid JSON).`);
  }
}

/** Extract the installed/web OAuth client config from a Google secret file. */
export function extractClientConfig(secret: unknown): OAuthClientConfig {
  const s = secret as { installed?: OAuthClientConfig; web?: OAuthClientConfig };
  const cfg = s.installed ?? s.web;
  if (!cfg || !cfg.client_id || !cfg.client_secret) {
    throw new GoogleCalendarError(
      "config",
      "Client secret file is missing client_id/client_secret.",
    );
  }
  return cfg;
}

/**
 * Build an OAuth2 client from the gitignored client-secret + token files and the
 * stored refresh token. googleapis transparently refreshes the access token.
 */
/** OAuth2 client type, derived from the googleapis namespace to avoid pulling in
 * a second (incompatible) copy of google-auth-library's type declarations. */
type GoogleOAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export function buildOAuthClient(): GoogleOAuth2Client {
  const cfg = extractClientConfig(
    readJsonFile(GOOGLE_CLIENT_SECRET_PATH, "Google client secret file"),
  );
  const token = readJsonFile(GOOGLE_TOKEN_PATH, "Google token file") as {
    refresh_token?: string;
  };
  if (!token.refresh_token) {
    throw new GoogleCalendarError(
      "auth",
      "Stored token has no refresh_token. Re-run the google-auth setup.",
    );
  }
  const redirectUri = cfg.redirect_uris?.[0];
  const client = new google.auth.OAuth2(
    cfg.client_id,
    cfg.client_secret,
    redirectUri,
  );
  client.setCredentials({ refresh_token: token.refresh_token });
  return client;
}

/** Normalize a raw Google event item into our display shape (or null to skip). */
function normalizeEvent(item: {
  id?: string | null;
  summary?: string | null;
  location?: string | null;
  description?: string | null;
  htmlLink?: string | null;
  start?: { date?: string | null; dateTime?: string | null } | null;
  end?: { date?: string | null; dateTime?: string | null } | null;
}): GoogleEvent | null {
  if (!item.id) return null;
  const allDay = Boolean(item.start?.date && !item.start?.dateTime);
  const start = item.start?.dateTime ?? item.start?.date ?? null;
  if (!start) return null;
  const end = item.end?.dateTime ?? item.end?.date ?? null;
  return googleEventSchema.parse({
    id: item.id,
    title: item.summary ?? "(no title)",
    start,
    end,
    allDay,
    location: item.location ?? null,
    description: item.description ?? null,
    htmlLink: item.htmlLink ?? null,
    source: "google",
  });
}

/**
 * The real fetcher. Single `events.list` call with server-side time filtering
 * and ordering. Fails closed on disabled/config/auth/API errors.
 */
export const realGoogleEventsFetcher: GoogleEventsFetcher = async (
  timeMinIso,
  timeMaxIso,
) => {
  if (!isGoogleCalendarEnabled()) {
    throw new GoogleCalendarError("disabled", "Google Calendar is disabled.");
  }
  const auth = buildOAuthClient();
  const calendar = google.calendar({ version: "v3", auth });

  let items: Parameters<typeof normalizeEvent>[0][] = [];
  try {
    const res = await calendar.events.list({
      calendarId: GOOGLE_CALENDAR_ID,
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: GOOGLE_CALENDAR_MAX_RESULTS,
    });
    items = res.data.items ?? [];
  } catch {
    // Never surface the raw error (may carry request/token detail).
    throw new GoogleCalendarError(
      "api",
      "Failed to fetch Google Calendar events.",
    );
  }

  return items
    .map((it) => normalizeEvent(it))
    .filter((e): e is GoogleEvent => e !== null);
};

/**
 * Create one timed Google Calendar event. This is intentionally not exposed as
 * an HTTP route; it is called only after a `google_event.create` approval has
 * been approved and re-validated by the executor.
 */
export async function createGoogleCalendarEvent(
  payload: CreateGoogleEventPayload,
): Promise<CreatedGoogleEvent> {
  if (!isGoogleCalendarEnabled()) {
    throw new GoogleCalendarError("disabled", "Google Calendar is disabled.");
  }

  const auth = buildOAuthClient();
  const calendar = google.calendar({ version: "v3", auth });

  try {
    const res = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      sendUpdates: "none",
      requestBody: {
        summary: payload.title,
        start: { dateTime: payload.starts_at },
        end: { dateTime: payload.ends_at },
        location: payload.location,
        description: payload.notes,
      },
    });

    const id = res.data.id;
    if (!id) {
      throw new GoogleCalendarError(
        "api",
        "Google Calendar returned an event without an id.",
      );
    }
    return { id, htmlLink: res.data.htmlLink ?? null };
  } catch (err) {
    if (err instanceof GoogleCalendarError) throw err;
    throw new GoogleCalendarError(
      "api",
      `Failed to create Google Calendar event.${googleErrorDetail(err)}`,
    );
  }
}

/**
 * Read one Google event's prior state for an undo snapshot. Generic error
 * message only (never the raw API body). Throws GoogleCalendarError on failure.
 */
async function fetchEventSnapshot(
  calendar: ReturnType<typeof google.calendar>,
  eventId: string,
): Promise<GoogleEventSnapshot> {
  try {
    const res = await calendar.events.get({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId,
    });
    const e = res.data;
    return {
      summary: e.summary ?? null,
      start: e.start
        ? { dateTime: e.start.dateTime ?? null, date: e.start.date ?? null }
        : null,
      end: e.end
        ? { dateTime: e.end.dateTime ?? null, date: e.end.date ?? null }
        : null,
      location: e.location ?? null,
      description: e.description ?? null,
    };
  } catch (err) {
    if (err instanceof GoogleCalendarError) throw err;
    throw new GoogleCalendarError(
      "api",
      `Failed to read the Google Calendar event (it may not exist).${googleErrorDetail(err)}`,
    );
  }
}

/**
 * Update an existing Google event (Step 14). Only the supplied fields are
 * patched. Snapshots the prior state first so the edit can be reverted. Called
 * only by the approval executor after the approval is actioned.
 */
export async function updateGoogleCalendarEvent(
  payload: UpdateGoogleEventPayload,
): Promise<UpdatedGoogleEvent> {
  if (!isGoogleCalendarEnabled()) {
    throw new GoogleCalendarError("disabled", "Google Calendar is disabled.");
  }

  const auth = buildOAuthClient();
  const calendar = google.calendar({ version: "v3", auth });

  const undoSnapshot = await fetchEventSnapshot(calendar, payload.id);

  const requestBody: Record<string, unknown> = {};
  if (payload.title !== undefined) requestBody.summary = payload.title;
  // When giving a timed start/end, also clear the all-day `date` field. Google
  // rejects a dateTime patch on an event that currently has start.date set
  // unless the old all-day field is explicitly nulled.
  if (payload.starts_at !== undefined)
    requestBody.start = { dateTime: payload.starts_at, date: null };
  if (payload.ends_at !== undefined)
    requestBody.end = { dateTime: payload.ends_at, date: null };
  if (payload.location !== undefined) requestBody.location = payload.location;
  if (payload.notes !== undefined) requestBody.description = payload.notes;

  try {
    const res = await calendar.events.patch({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId: payload.id,
      sendUpdates: "none",
      requestBody,
    });
    return {
      id: res.data.id ?? payload.id,
      htmlLink: res.data.htmlLink ?? null,
      undoSnapshot,
    };
  } catch (err) {
    if (err instanceof GoogleCalendarError) throw err;
    throw new GoogleCalendarError(
      "api",
      `Failed to update the Google Calendar event.${googleErrorDetail(err)}`,
    );
  }
}

/**
 * Delete a Google event (Step 14). Irreversible on Google's side, so the prior
 * event is snapshotted first (returned as undo_json) to allow recreation.
 * Called only by the approval executor after an explicit confirm.
 */
export async function deleteGoogleCalendarEvent(
  payload: DeleteGoogleEventPayload,
): Promise<DeletedGoogleEvent> {
  if (!isGoogleCalendarEnabled()) {
    throw new GoogleCalendarError("disabled", "Google Calendar is disabled.");
  }

  const auth = buildOAuthClient();
  const calendar = google.calendar({ version: "v3", auth });

  const undoSnapshot = await fetchEventSnapshot(calendar, payload.id);

  try {
    await calendar.events.delete({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId: payload.id,
      sendUpdates: "none",
    });
    return { id: payload.id, undoSnapshot };
  } catch (err) {
    if (err instanceof GoogleCalendarError) throw err;
    throw new GoogleCalendarError(
      "api",
      `Failed to delete the Google Calendar event.${googleErrorDetail(err)}`,
    );
  }
}
