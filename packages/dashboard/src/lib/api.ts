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
  CreateMemoryProposalBody,
  GoogleEventListResponse,
  MemoryContent,
  MemoryEntry,
  MemoryTarget,
  Notification,
  Reminder,
  Setting,
  SettingsResponse,
  Task,
  UpdateTaskBody,
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
): Promise<ChatResult> {
  const body =
    choice === "auto"
      ? { message, mode: "auto" }
      : choice
        ? { message, provider: choice }
        : { message };
  return request<ChatResult>("/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Archive the current chat thread. Next message starts a fresh session with zero history tokens. */
export function resetChat(): Promise<{ kind: "reset"; archived: number }> {
  return request("/api/chat/reset", { method: "POST" });
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
export async function requestChatFollowup(): Promise<FollowupResult> {
  try {
    return await request<FollowupResult>("/api/chat/followup", {
      method: "POST",
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
 * Speak text via the backend TTS endpoint. Fire-and-forget — never throws.
 * Lines are QUEUED: each one waits for the previous to finish playing, so an
 * acknowledgement, a result report, and a follow-up are heard in order.
 * No-op when the server returns 204 (TTS disabled / offline).
 */
export function speak(text: string, preset?: string): Promise<void> {
  _ttsChain = _ttsChain.then(() => speakNow(text, preset));
  return _ttsChain;
}

/** Synthesize one line and resolve only when its playback ends (or it fails). */
async function speakNow(text: string, preset?: string): Promise<void> {
  try {
    const body: Record<string, string> = { text };
    if (preset) body.preset = preset;

    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 204 || !res.ok) return;

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    // Stop + revoke any previous playback.
    if (_audio) {
      _audio.pause();
      _audio.src = "";
    }
    if (_currentUrl) {
      URL.revokeObjectURL(_currentUrl);
    }

    _currentUrl = url;
    const audio = new Audio();
    _audio = audio;
    audio.preload = "auto";

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (_currentUrl === url) {
          URL.revokeObjectURL(url);
          _currentUrl = null;
        }
        resolve();
      };
      audio.onended = finish;
      audio.onerror = finish;

      // Start only once enough is buffered to play through, so the browser never
      // begins mid-decode and clips the first word. Fall back to a plain play()
      // if the event hasn't fired shortly after load.
      let started = false;
      const start = () => {
        if (started || _audio !== audio) return;
        started = true;
        void audio.play().catch(finish);
      };
      audio.oncanplaythrough = start;
      audio.src = url;
      audio.load();
      setTimeout(start, 600);
      // Safety net: never let a stuck line block the queue forever.
      setTimeout(finish, 20000);
    });
  } catch {
    // Fail silently — text is already shown.
  }
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
