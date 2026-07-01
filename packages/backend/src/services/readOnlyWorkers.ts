import type { GoogleEvent } from "../schemas/googleCalendar.js";
import type { GmailMessage } from "../schemas/gmail.js";
import type { DriveFile } from "../schemas/googleDrive.js";
import type { LineMessage } from "../schemas/lineChat.js";
import {
  readOnlyWorkerInputSchema,
  type ReadOnlyWorkerEvidenceBundle,
  type ReadOnlyWorkerInput,
} from "../schemas/worker.js";
import {
  realGoogleEventsFetcher,
  searchGoogleCalendarEvents,
} from "./googleCalendar.js";
import { fetchUnreadGmailMessages } from "./gmail.js";
import { searchDriveFiles } from "./googleDrive.js";
import { getRecentLineMessages, searchLineMessages } from "./lineChat.js";
import {
  runWebResearchWorker,
  type WebResearchWorkerDeps,
} from "./webResearchWorker.js";
import {
  SEARCH_WINDOW_FUTURE_DAYS,
  SEARCH_WINDOW_PAST_DAYS,
} from "../config.js";

const DEFAULT_LIMIT = 10;

export interface ReadOnlyWorkerDeps {
  now?: () => Date;
  calendarEvents?: (
    timeMinIso: string,
    timeMaxIso: string,
    query?: string,
  ) => Promise<GoogleEvent[]>;
  gmailMessages?: (query: string | undefined, limit: number) => Promise<GmailMessage[]>;
  driveFiles?: (query: string | undefined, limit: number) => Promise<DriveFile[]>;
  lineMessages?: (
    query: string | undefined,
    limit: number,
  ) => Promise<Array<LineMessage & { chat: string }>>;
  webResearch?: WebResearchWorkerDeps;
}

function isoNow(deps?: ReadOnlyWorkerDeps): string {
  return (deps?.now?.() ?? new Date()).toISOString();
}

function limitFor(input: ReadOnlyWorkerInput): number {
  return input.limit ?? DEFAULT_LIMIT;
}

function describeRef(input: ReadOnlyWorkerInput): string {
  const parts = [
    input.source_ref ?? null,
    input.query ? `query:${input.query}` : null,
    input.since ? `since:${input.since}` : null,
    input.until ? `until:${input.until}` : null,
  ].filter((p): p is string => Boolean(p));
  return parts.join(" | ") || input.source;
}

function maxIso(values: Array<string | null | undefined>): string | null {
  let maxMs = Number.NEGATIVE_INFINITY;
  let maxValue: string | null = null;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) continue;
    if (ms > maxMs) {
      maxMs = ms;
      maxValue = new Date(ms).toISOString();
    }
  }
  return maxValue;
}

function bundle(input: ReadOnlyWorkerInput, patch: {
  fetched_at: string;
  newest_at: string | null;
  capped: boolean;
  partial?: boolean;
  confidence?: "high" | "medium" | "low";
  limitations: string[];
}): ReadOnlyWorkerEvidenceBundle {
  return {
    job_id: input.job_id,
    worker_id: input.worker_id,
    source: input.source,
    source_ref: describeRef(input),
    fetched_at: patch.fetched_at,
    newest_at: patch.newest_at,
    stale: false,
    capped: patch.capped,
    partial: patch.partial ?? false,
    confidence: patch.confidence ?? (patch.newest_at ? "medium" : "low"),
    limitations: patch.limitations,
  };
}

function unavailableBundle(
  input: ReadOnlyWorkerInput,
  fetchedAt: string,
): ReadOnlyWorkerEvidenceBundle {
  return bundle(input, {
    fetched_at: fetchedAt,
    newest_at: null,
    capped: false,
    partial: true,
    confidence: "low",
    limitations: ["source unavailable or read failed", "read-only adapter"],
  });
}

async function defaultCalendarEvents(
  timeMinIso: string,
  timeMaxIso: string,
  query?: string,
): Promise<GoogleEvent[]> {
  if (query) return searchGoogleCalendarEvents(query, timeMinIso, timeMaxIso);
  return realGoogleEventsFetcher(timeMinIso, timeMaxIso);
}

async function runCalendarWorker(
  input: ReadOnlyWorkerInput,
  deps?: ReadOnlyWorkerDeps,
): Promise<ReadOnlyWorkerEvidenceBundle> {
  const fetchedAt = isoNow(deps);
  const fetchedMs = Date.parse(fetchedAt);
  const since =
    input.since ??
    new Date(fetchedMs - SEARCH_WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const until =
    input.until ??
    new Date(fetchedMs + SEARCH_WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const fetcher = deps?.calendarEvents ?? defaultCalendarEvents;
  try {
    const events = await fetcher(since, until, input.query);
    const limit = limitFor(input);
    return bundle(input, {
      fetched_at: fetchedAt,
      newest_at: maxIso(events.map((event) => event.start)),
      capped: events.length >= limit,
      limitations: ["calendar read-only", "event bodies not included in worker output"],
    });
  } catch {
    return unavailableBundle(input, fetchedAt);
  }
}

async function runGmailWorker(
  input: ReadOnlyWorkerInput,
  deps?: ReadOnlyWorkerDeps,
): Promise<ReadOnlyWorkerEvidenceBundle> {
  const fetchedAt = isoNow(deps);
  const limit = limitFor(input);
  const fetcher =
    deps?.gmailMessages ??
    (async (_query: string | undefined, n: number) => fetchUnreadGmailMessages(n));
  try {
    const messages = await fetcher(input.query, limit);
    return bundle(input, {
      fetched_at: fetchedAt,
      newest_at: maxIso(messages.map((message) => message.receivedAt)),
      capped: messages.length >= limit,
      limitations: ["gmail read-only", "subjects/snippets/bodies not included in worker output"],
    });
  } catch {
    return unavailableBundle(input, fetchedAt);
  }
}

async function runDriveWorker(
  input: ReadOnlyWorkerInput,
  deps?: ReadOnlyWorkerDeps,
): Promise<ReadOnlyWorkerEvidenceBundle> {
  const fetchedAt = isoNow(deps);
  const limit = limitFor(input);
  const fetcher =
    deps?.driveFiles ??
    (async (query: string | undefined, n: number) => searchDriveFiles(query ?? "", undefined, n));
  try {
    const files = await fetcher(input.query, limit);
    return bundle(input, {
      fetched_at: fetchedAt,
      newest_at: maxIso(files.map((file) => file.modifiedTime)),
      capped: files.length >= limit,
      limitations: ["drive read-only", "file content not included in worker output"],
    });
  } catch {
    return unavailableBundle(input, fetchedAt);
  }
}

async function runLineWorker(
  input: ReadOnlyWorkerInput,
  deps?: ReadOnlyWorkerDeps,
): Promise<ReadOnlyWorkerEvidenceBundle> {
  const fetchedAt = isoNow(deps);
  const limit = limitFor(input);
  const fetcher =
    deps?.lineMessages ??
    (async (query: string | undefined, n: number) => {
      if (!query) return getRecentLineMessages(n);
      return searchLineMessages([query], n);
    });
  try {
    const messages = await fetcher(input.query, limit);
    return bundle(input, {
      fetched_at: fetchedAt,
      newest_at: maxIso(messages.map((message) => message.atUtc)),
      capped: messages.length >= limit,
      limitations: ["line export read-only", "message bodies not included in worker output"],
    });
  } catch {
    return unavailableBundle(input, fetchedAt);
  }
}

export async function runBackendReadWorker(
  rawInput: unknown,
  deps?: ReadOnlyWorkerDeps,
): Promise<ReadOnlyWorkerEvidenceBundle> {
  const input = readOnlyWorkerInputSchema.parse(rawInput);
  switch (input.source) {
    case "google_calendar":
      return runCalendarWorker(input, deps);
    case "gmail":
      return runGmailWorker(input, deps);
    case "google_drive":
      return runDriveWorker(input, deps);
    case "line_export":
      return runLineWorker(input, deps);
    case "web": {
      const web = await runWebResearchWorker(input, {
        now: deps?.webResearch?.now ?? deps?.now,
        search: deps?.webResearch?.search,
        fetchUrl: deps?.webResearch?.fetchUrl,
      });
      return web.bundle;
    }
    case "local_file":
      throw new Error(`backend read worker does not handle ${input.source}`);
  }
}
