/**
 * Typed client for the local backend. All calls go to same-origin `/api/*`,
 * which Next proxies to the backend (see next.config.js). No CORS, no auth.
 */
import type {
  Activity,
  ProviderChoice,
  Approval,
  BriefResult,
  CalendarEvent,
  ChatMessage,
  ChatResult,
  FollowupResult,
  CommandMode,
  CommandResult,
  CreateFactProposalBody,
  CreateMemoryProposalBody,
  GoogleEventListResponse,
  MemoryContent,
  MemoryEntry,
  MemoryFact,
  MemoryTarget,
  Notification,
  Reminder,
  Setting,
  SettingsResponse,
  Task,
  UpdateTaskBody,
  VerifyResult,
} from "./types";

/** Thrown for any non-2xx response; `message` carries the backend's error text. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Parsed error body, when present — e.g. Auto-mode `fallbackProvider`. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  // Only declare a JSON content-type when we actually send a body. Bodyless
  // POSTs (approve/reject/archive) would otherwise reach Fastify with
  // `Content-Type: application/json` and an empty body, which its default JSON
  // parser rejects with a 400 (FST_ERR_CTP_EMPTY_JSON_BODY) before the route
  // handler runs.
  const headers: HeadersInit = init?.body
    ? { "Content-Type": "application/json", ...init?.headers }
    : { ...init?.headers };
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    // Network/connection failure — usually the backend isn't running.
    throw new ApiError("Cannot reach the backend (is it running on :8787?)", 0);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let details: Record<string, unknown> | undefined;
    try {
      const body = (await res.json()) as { error?: string } & Record<
        string,
        unknown
      >;
      if (body?.error) message = body.error;
      details = body;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ApiError(message, res.status, details);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- Tasks ---------------------------------------------------------------

export async function listTasks(): Promise<Task[]> {
  const data = await request<{ tasks: Task[] }>("/api/tasks");
  return data.tasks;
}

export function createTask(
  title: string,
  status?: "open" | "done",
): Promise<Task> {
  return request<Task>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(status ? { title, status } : { title }),
  });
}

export function updateTask(id: number, body: UpdateTaskBody): Promise<Task> {
  return request<Task>(`/api/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function archiveTask(id: number): Promise<Task> {
  return request<Task>(`/api/tasks/${id}/archive`, { method: "POST" });
}

// --- Approvals -----------------------------------------------------------

export async function listApprovals(): Promise<Approval[]> {
  const data = await request<{ approvals: Approval[] }>("/api/approvals");
  return data.approvals;
}

export function approveApproval(id: number): Promise<Approval> {
  return request<Approval>(`/api/approvals/${id}/approve`, { method: "POST" });
}

export function rejectApproval(id: number): Promise<Approval> {
  return request<Approval>(`/api/approvals/${id}/reject`, { method: "POST" });
}

// --- Activity ------------------------------------------------------------

export async function listActivity(limit = 50): Promise<Activity[]> {
  const data = await request<{ activity: Activity[] }>(
    `/api/activity?limit=${limit}`,
  );
  return data.activity;
}

// --- Memory --------------------------------------------------------------

export async function listMemory(): Promise<MemoryEntry[]> {
  const data = await request<{ entries: MemoryEntry[] }>("/api/memory");
  return data.entries;
}

export function getMemoryContent(target: MemoryTarget): Promise<MemoryContent> {
  return request<MemoryContent>(`/api/memory/${target}/content`);
}

/** Create a memory write/edit proposal; returns the pending approval. */
export function createMemoryProposal(
  body: CreateMemoryProposalBody,
): Promise<Approval> {
  return request<Approval>("/api/memory/proposals", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// --- Memory facts (Step 16, real memory) ---------------------------------

export async function listFacts(): Promise<MemoryFact[]> {
  const data = await request<{ facts: MemoryFact[] }>("/api/facts");
  return data.facts;
}

/** Teach a new fact; returns the resulting approval (may already be executed). */
export function createFactProposal(
  payload: CreateFactProposalBody,
): Promise<Approval> {
  return request<Approval>("/api/facts/proposals", {
    method: "POST",
    body: JSON.stringify({ action_type: "fact.remember", payload }),
  });
}

/** Propose forgetting a fact (always confirm-gated); returns the pending approval. */
export function forgetFact(id: number): Promise<Approval> {
  return request<Approval>("/api/facts/proposals", {
    method: "POST",
    body: JSON.stringify({ action_type: "fact.forget", payload: { id } }),
  });
}

// --- Events & reminders (Step 9, read-only) ------------------------------

export async function listEvents(): Promise<CalendarEvent[]> {
  const data = await request<{ events: CalendarEvent[] }>("/api/events");
  return data.events;
}

export async function listReminders(): Promise<Reminder[]> {
  const data = await request<{ reminders: Reminder[] }>("/api/reminders");
  return data.reminders;
}

// --- Google Calendar (Step 10, primary schedule) -------------------------

/** Today's Google Calendar events. `available:false` if disabled/unconfigured. */
export function getCalendarToday(): Promise<GoogleEventListResponse> {
  return request<GoogleEventListResponse>("/api/calendar/today");
}

/** Upcoming (next 7 days) Google Calendar events. */
export function getCalendarUpcoming(): Promise<GoogleEventListResponse> {
  return request<GoogleEventListResponse>("/api/calendar/upcoming");
}

// --- Command bar ---------------------------------------------------------

/**
 * Run a command. `mode` selects the deterministic parser (default) or the
 * proposal-only AI path. Returns `help`/`proposal`/`clarification`/`none` on
 * success; failures come back as 4xx/5xx and throw ApiError (carrying the
 * backend's message and status), so handle those in a catch — the status
 * distinguishes AI states: 503 disabled, 504 timeout, 502 spawn/empty failure,
 * 400 invalid output.
 */
export function runCommand(
  input: string,
  mode: CommandMode = "deterministic",
): Promise<CommandResult> {
  return request<CommandResult>("/api/command", {
    method: "POST",
    body: JSON.stringify({ input, mode }),
  });
}

// --- Notifications (Step 11) ---------------------------------------------

export async function listNotifications(): Promise<Notification[]> {
  const data = await request<{ notifications: Notification[] }>(
    "/api/notifications",
  );
  return data.notifications;
}

export async function listUnreadNotifications(): Promise<Notification[]> {
  const data = await request<{ notifications: Notification[] }>(
    "/api/notifications/unread",
  );
  return data.notifications;
}

export function markNotificationRead(id: number): Promise<Notification> {
  return request<Notification>(`/api/notifications/${id}/read`, {
    method: "POST",
  });
}

// --- Chat (Step 12) -------------------------------------------------------

/**
 * Send a chat message. `choice` is the user's provider pick:
 * - `"auto"` -> backend routes transparently (`mode: "auto"`).
 * - `"claude" | "gemini"` -> manual provider (`provider: <id>`).
 * Omitted uses the backend default (Claude, manual). Returns the assistant
 * reply + any queued approvals. AI failures throw ApiError (503 disabled/
 * provider-unconfigured, 504 timeout, 502 failure, 400 invalid output);
 * Auto-mode failures carry `details.fallbackProvider` for an explicit retry.
 */
export function sendChat(
  message: string,
  choice?: ProviderChoice,
  sessionId?: string,
  geminiModel?: string,
): Promise<ChatResult> {
  const base =
    choice === "auto"
      ? { message, mode: "auto" }
      : choice
        ? { message, provider: choice }
        : { message };
  // Only attach the model override when Gemini is the explicit choice; the
  // backend ignores it for other providers anyway.
  const withModel =
    choice === "gemini" && geminiModel ? { ...base, geminiModel } : base;
  return request<ChatResult>("/api/chat", {
    method: "POST",
    body: JSON.stringify(sessionId ? { ...withModel, sessionId } : withModel),
  });
}

/** Archive the current chat thread. Passes sessionId so the backend clears verified state too. */
export function resetChat(sessionId?: string): Promise<{ kind: "reset"; archived: number }> {
  return request("/api/chat/reset", {
    method: "POST",
    ...(sessionId ? { body: JSON.stringify({ sessionId }) } : {}),
  });
}

// --- Identity verification (Step 15) -------------------------------------

/** Verify owner identity. Returns `verified`, `denied` (with error), or `disabled`. */
export function verifyIdentity(
  sessionId: string,
  input: string,
): Promise<VerifyResult> {
  return request<VerifyResult>("/api/chat/verify", {
    method: "POST",
    body: JSON.stringify({ sessionId, input }),
  });
}

/** Fetch guard state and challenge question (for pre-verify lock button). */
export function getChallenge(): Promise<{
  guardEnabled: boolean;
  question: string | null;
}> {
  return request<{ guardEnabled: boolean; question: string | null }>(
    "/api/chat/challenge",
  );
}

/** Fetch recent chat history (oldest first). */
export async function getChatHistory(limit = 50): Promise<ChatMessage[]> {
  const data = await request<{ messages: ChatMessage[] }>(
    `/api/chat/history?limit=${limit}`,
  );
  return data.messages;
}

/**
 * Request an idle proactive follow-up. Always resolves (the backend returns 200
 * even when it stays silent); on any client error it degrades to `silent` so the
 * caller never has to handle an error for a nudge the user did not request.
 */
export async function requestChatFollowup(
  sessionId?: string,
): Promise<FollowupResult> {
  try {
    return await request<FollowupResult>("/api/chat/followup", {
      method: "POST",
      ...(sessionId ? { body: JSON.stringify({ sessionId }) } : {}),
    });
  } catch {
    return { kind: "silent" };
  }
}

// --- Settings ------------------------------------------------------------

export async function getSettings(): Promise<Setting[]> {
  const data = await request<SettingsResponse>("/api/settings");
  return data.settings;
}

export function updateSetting(
  key: string,
  enabled: boolean,
): Promise<{ key: string; enabled: boolean }> {
  return request(`/api/settings/${key}`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}

// --- TTS (Step 13.1) -----------------------------------------------------

/** Single module-level audio element for sequential, non-overlapping playback. */
let _audio: HTMLAudioElement | null = null;
let _currentUrl: string | null = null;

/**
 * Sequential TTS queue. Within a turn we may speak several lines in order — an
 * ack, then the real result, then an idle follow-up. They must NOT overlap or
 * cancel each other, so each `speak` is chained after the previous one settles.
 */
let _ttsChain: Promise<void> = Promise.resolve();

/**
 * How long the caller may hold the text reveal waiting for audio to buffer.
 * Past this cap we reveal text anyway (fail-soft) and let voice catch up.
 */
const READY_CAP_MS = 2000;

/** Two-phase speech: buffer audio first (`ready`), then start it (`play`). */
export interface SpeechHandle {
  /** Resolves once buffered enough to play, the cap elapses, or it failed/was disabled. */
  ready: Promise<void>;
  /** Begin playback now — no-op if disabled/failed. */
  play: () => void;
}

interface PreparedLine extends SpeechHandle {
  /** Resolves when playback ends (or the line failed). Used to chain the queue. */
  done: Promise<void>;
}

/**
 * Start fetching + buffering one spoken line immediately and return handles to
 * gate its readiness and trigger playback. Never throws; fails soft to silence.
 * Playback is still `canplaythrough`-gated so the browser never begins
 * mid-decode and clips the first word.
 */
function prepareLine(text: string, preset?: string): PreparedLine {
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => {
    resolveDone = r;
  });

  let theAudio: HTMLAudioElement | null = null;
  let myUrl: string | null = null;
  let playWanted = false;
  let started = false;
  let canPlay = false;
  let doneSettled = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const finishDone = () => {
    if (doneSettled) return;
    doneSettled = true;
    if (fallbackTimer) clearTimeout(fallbackTimer);
    if (myUrl) {
      if (_currentUrl === myUrl) _currentUrl = null;
      URL.revokeObjectURL(myUrl);
    }
    resolveDone();
  };

  const reallyStart = () => {
    if (started || !theAudio || _audio !== theAudio) return;
    started = true;
    void theAudio.play().catch(() => finishDone());
  };
  const maybeStart = () => {
    if (started || !playWanted || !theAudio) return;
    if (canPlay) reallyStart();
    else if (!fallbackTimer)
      fallbackTimer = setTimeout(() => {
        if (playWanted) reallyStart();
      }, 600);
  };

  const ready = (async (): Promise<void> => {
    try {
      const body: Record<string, string> = { text };
      if (preset) body.preset = preset;

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // TTS disabled / offline → resolve immediately so text isn't held.
      if (res.status === 204 || !res.ok) {
        finishDone();
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      // Stop + revoke any previous playback.
      if (_audio) {
        _audio.pause();
        _audio.src = "";
      }
      if (_currentUrl) URL.revokeObjectURL(_currentUrl);

      _currentUrl = url;
      myUrl = url;
      const audio = new Audio();
      _audio = audio;
      theAudio = audio;
      audio.preload = "auto";
      audio.onended = finishDone;
      audio.onerror = finishDone;
      audio.oncanplaythrough = () => {
        canPlay = true;
        maybeStart();
      };
      audio.src = url;
      audio.load();
      // Safety net: never let a stuck line block the queue forever.
      setTimeout(finishDone, 20000);

      // Readiness resolves when buffered enough OR the cap elapses.
      await new Promise<void>((resolve) => {
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        if (canPlay) settle();
        audio.addEventListener("canplaythrough", settle, { once: true });
        setTimeout(settle, READY_CAP_MS);
      });
    } catch {
      // Fail silently — text is already shown.
      finishDone();
    }
  })();

  return {
    ready,
    play: () => {
      playWanted = true;
      maybeStart();
    },
    done,
  };
}

/**
 * Buffer a spoken line WITHOUT playing it yet, so the caller can reveal the
 * matching text and call `play()` in the same tick — text and voice together.
 * A later `speak()` (result report, follow-up) is queued AFTER this line's
 * playback so they never overlap.
 */
export function prepareSpeech(text: string, preset?: string): SpeechHandle {
  const line = prepareLine(text, preset);
  _ttsChain = _ttsChain.then(() => line.done);
  return { ready: line.ready, play: line.play };
}

/**
 * Speak text via the backend TTS endpoint. Fire-and-forget — never throws.
 * Lines are QUEUED: each one waits for the previous to finish playing, so an
 * acknowledgement, a result report, and a follow-up are heard in order.
 * No-op when the server returns 204 (TTS disabled / offline).
 */
export function speak(text: string, preset?: string): Promise<void> {
  _ttsChain = _ttsChain.then(async () => {
    const line = prepareLine(text, preset);
    await line.ready;
    line.play();
    await line.done;
  });
  return _ttsChain;
}

// --- Briefs --------------------------------------------------------------

/**
 * Generate a Daily Brief or Evening Review. Bodyless POST (request() omits the
 * JSON content-type when there is no body). Proposal-only and AI-gated: returns
 * a `brief` with the summary plus any queued approvals on success; AI failures
 * throw ApiError (503 disabled, 504 timeout, 502 failure, 400 invalid output).
 */
export function generateDailyBrief(): Promise<BriefResult> {
  return request<BriefResult>("/api/briefs/daily", { method: "POST" });
}

export function generateEveningBrief(): Promise<BriefResult> {
  return request<BriefResult>("/api/briefs/evening", { method: "POST" });
}
