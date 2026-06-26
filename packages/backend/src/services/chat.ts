import { listTasks } from "../db/repositories/taskRepo.js";
import { listMemoryEntries } from "../db/repositories/memoryRepo.js";
import { recallFacts } from "./factRecall.js";
import {
  isSchedulingIntent,
  resolveScheduleConstraints,
} from "./scheduleConstraints.js";
import { resolveAvailability } from "./availabilityResolver.js";
import { findFreeSlotsForDay } from "./freeSlotFinder.js";
import { getSchedulePrefs } from "./schedulePrefs.js";
import type { GoogleEvent } from "../schemas/googleCalendar.js";
import { listEvents } from "../db/repositories/eventRepo.js";
import { listReminders } from "../db/repositories/reminderRepo.js";
import {
  appendMessage,
  listRecentMessages,
} from "../db/repositories/chatRepo.js";
import { listRecentApprovalOutcomes } from "../db/repositories/approvalRepo.js";
import {
  dispatchProposedAction,
  isAutoExecuteEnabled,
  isAutoExecuteDestructiveEnabled,
  type DispatchResult,
} from "./actionDispatcher.js";
import { chatOutputSchema } from "../schemas/chat.js";
import type { AiAction } from "../schemas/aiCommand.js";
import type {
  CalendarBulkCreateAction,
  CalendarPlan,
  CalendarPlanItem,
} from "../schemas/calendarPlan.js";
import { buildCalendarPlan } from "./calendarPlanService.js";
import { buildChatPrompt, type ChatContext } from "./chatPrompt.js";
import {
  agendaBounds,
  bangkokWallClock,
  bucketEvents,
  bucketReminders,
} from "./agenda.js";
import { unwrapJsonOutput } from "./jsonOutput.js";
import { ClaudeError, type ClaudeInvoker } from "./claudeClient.js";
import { GeminiError } from "./geminiClient.js";
import { type GoogleEventsFetcher } from "./googleCalendar.js";
import {
  cachedGoogleEventsFetcher,
  primeFresh,
} from "./googleCalendarCache.js";
import {
  fetchUnreadGmailMessages,
  isGmailEnabled,
} from "./gmail.js";
import {
  fetchGoogleContacts,
  isContactsEnabled,
} from "./googleContacts.js";
import { getRecentDriveFiles } from "./googleDrive.js";
import {
  getLineChatSummariesSafe,
  getRecentLineByChatSafe,
  getFocusedChatMessages,
  getChatCoverageByName,
  getChatHeadTail,
  searchLineMessages,
} from "./lineChat.js";
import {
  resolveActiveTopicForMessage,
  isShortFollowupQuestion,
  extractTopicKeywords,
} from "./activeTopicIntelligence.js";
import { listActiveTopics } from "../db/repositories/activeTopicRepo.js";
import {
  buildLineEvidenceForTopic,
  makeEmptyLineEvidence,
} from "./lineEvidence.js";
import {
  verifyLineEvidenceAnswerIntent,
  verifyLineCoverageClaim,
} from "./evidenceVerifier.js";
import { verifyScheduleAnswerIntent } from "./scheduleVerifier.js";
import type { Approval } from "../schemas/approval.js";
import {
  CLAUDE_BRIEF_TIMEOUT_MS,
  CLAUDE_CONTEXT_TASK_CAP,
  FACT_RECALL_CAP,
  BRIEF_EVENT_CAP,
  BRIEF_REMINDER_CAP,
  CHAT_GOOGLE_WINDOW_DAYS,
  CHAT_GOOGLE_EVENT_CAP,
  CHAT_HISTORY_LIMIT,
  LINE_CONTEXT_PER_CHAT,
  LINE_CONTEXT_MAX_CHATS,
  LINE_FOCUSED_MSG_CAP,
  LINE_BOUNDARY_HEAD,
  LINE_BOUNDARY_TAIL,
  LINE_SEARCH_CAP,
  nowIso,
} from "../config.js";
import { classifySensitivity } from "./privacyClassifier.js";
import { isGuardEnabled } from "./identityVerifier.js";

/**
 * Chat orchestration (Step 12). Proposal-only pipeline with conversation
 * history. Reads real local state (tasks/events/reminders/Google/memory
 * summaries) for recall; persists successful exchanges; routes any write
 * through the approval queue. Fails closed on every error path.
 *
 * Only successful exchanges are persisted: user message + assistant reply are
 * written together after a valid Claude response. A failed/disabled invocation
 * produces no DB writes, so failed attempts don't pollute history.
 */

export type ChatResult =
  | {
      kind: "replied";
      reply: string;
      spoken?: string;
      /** Deterministic, truthful outcome line posted AFTER the ack reply. */
      resultReport?: string;
      /** Short spoken form of resultReport for sequential TTS. */
      resultSpoken?: string;
      approvals: Approval[];
      /**
       * Bulk calendar-create plan staged this turn (the AI emitted ONE
       * `calendar.bulk_create` action carrying many events). The dashboard renders
       * a review card from this; nothing is on the calendar until the user
       * approves the selected items. Absent for ordinary turns.
       */
      calendarPlan?: { plan: CalendarPlan; items: CalendarPlanItem[] };
      clarification?: string;
      clarificationChoices?: string[];
      notes?: string;
      /** Step 15: true when guard on, requester unverified, and asked for private data. */
      verificationRequired?: boolean;
      /** Step 15: the challenge question to show in the verify panel. */

      /** Step 15: "private" if the user probed the owner's private specifics. */
      sensitivity?: "private" | "normal";
    }
  | { kind: "rejected"; message: string; detail?: string }
  | { kind: "failed"; reason: string; message: string; userMessage: string };

/**
 * Build a TRUTHFUL, deterministic outcome message from the real dispatch
 * results. The chat `reply` is only an acknowledgement (it is generated before
 * execution), so this is what actually tells the user whether the work
 * succeeded, failed (with the real error), or is awaiting their confirmation.
 * Returns null when there were no actions (pure Q&A — nothing to report).
 */
export function buildActionReport(
  dispatched: DispatchResult[],
): { text: string; spoken: string } | null {
  if (dispatched.length === 0) return null;

  const executed = dispatched.filter((d) => d.mode === "executed");
  const failed = dispatched.filter((d) => d.mode === "failed");
  const pending = dispatched.filter((d) => d.mode === "pending");

  const lines: string[] = [];

  // Create-time clash warnings come FIRST — they are the reason a create was
  // held for confirm instead of auto-added. One line per clashing new event.
  const CLASH_LABEL: Record<string, string> = {
    overlap: "ทับเวลากับ",
    no_buffer: "ชิดกันเกินไปกับ",
    tight_travel: "เวลาเดินทางไม่พอจาก",
  };
  for (const d of dispatched) {
    if (!d.conflicts || d.conflicts.length === 0) continue;
    const newTitle =
      (d.approval.payload as { title?: string })?.title ?? "รายการใหม่";
    const clashes = d.conflicts
      .map((c) => `${CLASH_LABEL[c.kind] ?? "ชนกับ"} “${c.withTitle}”`)
      .join(", ");
    lines.push(
      `⚠️ “${newTitle}” ${clashes} — เตรียมไว้รอคุณยืนยัน ยังไม่ได้ใส่ในปฏิทินค่ะ`,
    );
  }
  // Step 27 / Sprint 4 — protected-window / class-block holds. A reminder/event
  // landing inside a tank window or class block is held for confirm, NOT done.
  for (const d of dispatched) {
    if (!d.constraintViolations || d.constraintViolations.length === 0) continue;
    const newTitle =
      (d.approval.payload as { title?: string })?.title ?? "รายการนี้";
    const windows = d.constraintViolations
      .map((v) => `“${v.windowLabel}”`)
      .join(", ");
    lines.push(
      `⚠️ “${newTitle}” ตกอยู่ในช่วงต้องห้าม ${windows} — เตรียมไว้รอคุณยืนยัน ยังไม่ได้บันทึกค่ะ`,
    );
  }
  if (executed.length > 0) {
    lines.push(
      executed.length === 1
        ? "✅ เรียบร้อยค่ะ จัดการให้แล้ว"
        : `✅ เรียบร้อยค่ะ จัดการให้แล้ว ${executed.length} รายการ`,
    );
  }
  for (const f of failed) {
    const reason = f.approval.execution_error?.trim();
    lines.push(
      reason
        ? `⚠️ มีรายการที่ทำไม่สำเร็จค่ะ: ${reason}`
        : "⚠️ มีรายการที่ทำไม่สำเร็จค่ะ ลองอีกครั้งได้",
    );
  }
  if (pending.length > 0) {
    lines.push(
      `📝 อีก ${pending.length} รายการเตรียมไว้ให้แล้ว รอคุณกดยืนยันค่ะ`,
    );
  }
  if (lines.length === 0) return null;

  // Spoken: drop emoji + raw error detail; keep the gist for voice.
  // Memory updates are intentionally NOT spoken (user asked not to hear
  // "เรียบร้อยแล้วค่ะ" for a memory write / silently remembering a fact) — the
  // ✅ text line above still shows.
  const SILENT_TYPES = new Set(["memory.write", "fact.remember"]);
  const executedSpeakable = executed.filter(
    (d) => !SILENT_TYPES.has(d.approval.action_type),
  );
  const hasClash = dispatched.some(
    (d) =>
      (d.conflicts?.length ?? 0) > 0 ||
      (d.constraintViolations?.length ?? 0) > 0,
  );
  const spokenParts: string[] = [];
  if (hasClash) spokenParts.push("เวลานี้ทับกับนัดเดิมหรือช่วงต้องห้ามอยู่ ฝากเช็กก่อนยืนยันค่ะ");
  if (executedSpeakable.length > 0) spokenParts.push("เรียบร้อยแล้วค่ะ");
  if (failed.length > 0) spokenParts.push("มีบางรายการทำไม่สำเร็จค่ะ");
  if (pending.length > 0) spokenParts.push("อีกบางรายการรอคุณยืนยันค่ะ");

  return { text: lines.join("\n"), spoken: spokenParts.join(" ") };
}

/**
 * S1 anti-nag interceptor set — action types that represent a DATA MUTATION /
 * correction. When one is in flight, the code (not the prompt) suppresses any
 * clarifying question on the same turn: a system that is ALREADY acting on a
 * correction must not also interrogate the (often frustrated) user. Gated on
 * action-PRESENCE, not sentiment — deterministic, can't be talked out of it by
 * the model. Execution of these stays confirm-gated in the dispatcher unchanged.
 */
const MUTATION_ACTION_TYPES: ReadonlySet<string> = new Set<string>([
  "fact.update",
  "fact.forget",
  "task.archive",
  "event.archive",
  "reminder.archive",
  "google_event.delete",
  "google_event.update",
]);

/**
 * 5c backstop — denial patterns that wrongly claim no schedule exists. Matched
 * against the model's reply; deliberately narrow (Thai + English) to avoid firing
 * on legitimate replies that DO list the schedule.
 */
const SCHEDULE_DENIAL_RE =
  /ไม่มี(ตาราง|เรียน|คลาส|กิจกรรม|นัด|รายการ|อะไร)|ไม่พบ(ตาราง|เรียน|คลาส|กิจกรรม)|ว่างทั้งวัน|no (schedule|class|classes|event)|nothing (scheduled|on)/i;

/** Thai weekday names (0 = Sunday … 6 = Saturday) for the backstop summary. */
const THAI_WEEKDAYS = [
  "อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์",
];
function formatThaiWeekdays(weekdays: number[]): string {
  if (weekdays.length === 0) return "ทุกวัน";
  return weekdays.map((d) => THAI_WEEKDAYS[d] ?? "?").join("/");
}

function chatFailureMessage(reason: string): string {
  if (reason === "disabled") {
    return "ยังช่วยคิดด้วย AI ไม่ได้ค่ะ โหมด AI ยังไม่พร้อมใช้งาน เปิดใช้งานแล้วลองใหม่ได้";
  }
  if (reason === "timeout") {
    return "ยังตอบรายการนี้ไม่สำเร็จค่ะ ระบบใช้เวลานานเกินไป ลองส่งใหม่แบบสั้นลงได้";
  }
  if (reason === "rate-limit") {
    return "Gemini ใช้โควต้าครบชั่วคราวค่ะ ลองใหม่ภายหลังหรือสลับไปใช้ Claude ได้";
  }
  return "ยังตอบข้อความนี้ไม่สำเร็จค่ะ ลองส่งใหม่อีกครั้งได้";
}

const invalidOutputMessage =
  "ยังตอบข้อความนี้ให้ครบไม่ได้ค่ะ รูปแบบคำตอบไม่พร้อมใช้งาน ลองส่งใหม่อีกครั้งได้";

/**
 * Broad words that carry no topic signal — dropped before LINE keyword search so
 * a question like "ใน LINE ใครถามเรื่อง กยศ ล่าสุด" searches for "กยศ", not "ใคร".
 * Lowercase. Thai + English. Substring matching means we keep this list short and
 * only strip truly generic terms.
 */
const LINE_STOPWORDS = new Set<string>([
  // Thai
  "ใคร", "อะไร", "ที่ไหน", "เมื่อไหร่", "เมื่อไร", "ทำไม", "ยังไง", "อย่างไร",
  "ล่าสุด", "บ้าง", "ไหม", "มั้ย", "หรอ", "หรือ", "ที่", "ของ", "ใน", "กับ",
  "และ", "แล้ว", "เรื่อง", "ข้อความ", "line", "ไลน์", "คน", "มี", "ถาม", "พูด",
  "คุย", "ส่ง", "ช่วย", "ขอ", "ดู", "หา", "ให้", "ได้", "ครับ", "ค่ะ", "นะ",
  // English
  "the", "a", "an", "is", "are", "was", "were", "in", "on", "of", "to", "for",
  "and", "or", "who", "what", "when", "where", "why", "how", "latest", "recent",
  "any", "did", "does", "do", "ask", "asked", "about", "message", "chat", "me",
  "my", "i", "you", "show", "find", "tell",
]);

/**
 * Deterministic keyword extraction from the user's message for LINE retrieval.
 * Splits on whitespace + punctuation, lowercases, drops short/stopword tokens,
 * dedupes, caps to ~6. No AI call. Returns [] when nothing topical remains
 * (search then becomes a no-op and the recent-window context still applies).
 */
export function extractLineKeywords(message: string): string[] {
  const tokens = message
    .toLowerCase()
    .split(/[\s,.!?;:"'()[\]{}<>/\\|@#$%^&*+=~`‘’“”]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !LINE_STOPWORDS.has(t));
  const out: string[] = [];
  for (const t of tokens) {
    if (!out.includes(t)) out.push(t);
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Local aliases mapping a spoken group reference to an EXACT exported chat name,
 * for FOCUSED retrieval only (so "กลุ่มครอบครัว" loads the เอ๋วน้องต้าว chat's
 * recent messages into context). This ONLY decides which chat's messages to LOAD;
 * the prompt still owns any user-facing ambiguity/clarification wording. An alias
 * is honored only when its target chat actually exists in the exports.
 */
const FOCUSED_CHAT_ALIASES: { alias: string; chat: string }[] = [
  { alias: "กลุ่มครอบครัว", chat: "เอ๋วน้องต้าว" },
  { alias: "family group", chat: "เอ๋วน้องต้าว" },
];

/** Markers for "what did we talk about / summarize the latest" questions. */
const CHAT_CONTENT_MARKERS = [
  "คุยอะไร", "คุยเรื่อง", "สรุป", "ล่าสุดคุย", "วันนี้คุย", "เมื่อวานคุย",
  "พิมพ์อะไร", "ว่าอะไรบ้าง", "talk about", "what did", "summar",
];

function isChatContentQuestion(message: string): boolean {
  const m = message.toLowerCase();
  return CHAT_CONTENT_MARKERS.some((k) => m.includes(k));
}

/** Find an exact chat name (longest match) or alias referenced in a text. */
function matchChatInText(text: string, knownNames: string[]): string | null {
  const lower = text.toLowerCase();
  let best = "";
  for (const name of knownNames) {
    const n = name.toLowerCase();
    if (n.length >= 2 && n.length > best.length && lower.includes(n)) best = name;
  }
  if (best) return best;
  for (const { alias, chat } of FOCUSED_CHAT_ALIASES) {
    if (lower.includes(alias.toLowerCase()) && knownNames.includes(chat)) {
      return chat;
    }
  }
  return null;
}

/**
 * Deterministic FOCUSED-chat detection (no AI). Returns the EXACT chat name the
 * user is asking about so its recent messages can be loaded into context. Checks
 * the current message first; for content/short follow-up questions that name no
 * chat, it carries focus from the most recent prior user turn that named one.
 * Pure — exported for tests.
 */
export function detectFocusedChat(
  message: string,
  priorUserMessages: string[],
  knownNames: string[],
): string | null {
  if (knownNames.length === 0) return null;
  const direct = matchChatInText(message, knownNames);
  if (direct) return direct;
  if (isChatContentQuestion(message) || isShortFollowupQuestion(message)) {
    for (let i = priorUserMessages.length - 1; i >= 0; i--) {
      const carried = matchChatInText(priorUserMessages[i], knownNames);
      if (carried) return carried;
    }
  }
  return null;
}

/**
 * S3 — deterministic BOUNDARY-intent detector (no AI). True when the user asks
 * how far a chat's history goes (earliest / first / since when / how far back),
 * as opposed to its content. Substring match — Thai has no word spaces, so the
 * same rationale as searchLineMessages applies. Pure — exported for tests.
 */
const LINE_BOUNDARY_CUES = [
  // Thai
  "เก่าสุด",
  "เก่าที่สุด",
  "แรกสุด",
  "ครั้งแรก",
  "ข้อความแรก",
  "วันแรก",
  "เริ่มเมื่อไหร่",
  "เริ่มตั้งแต่",
  "ตั้งแต่เมื่อไหร่",
  "ย้อนไปถึง",
  "ย้อนหลังถึง",
  "ย้อนไปได้ถึง",
  // English
  "earliest",
  "oldest",
  "since when",
  "how far back",
  "first message",
  "start of",
];
export function isLineBoundaryIntent(message: string): boolean {
  const m = message.toLowerCase();
  return LINE_BOUNDARY_CUES.some((c) => m.includes(c.toLowerCase()));
}

/**
 * Deterministic FREE-TIME intent detector (no AI). True when the user is asking
 * to FIND open time ("หาเวลาว่าง / ว่างตอนไหน / find time"), as opposed to merely
 * checking a clash. Compound markers only — bare "ว่าง" is too broad (it already
 * triggers scheduling intent). Pure — exported for tests.
 */
const FREE_TIME_MARKERS = [
  "หาเวลาว่าง",
  "เวลาว่าง",
  "ช่วงว่าง",
  "ตอนไหนว่าง",
  "ว่างตอนไหน",
  "ว่างช่วงไหน",
  "มีเวลาว่าง",
  "หาเวลา",
  "เวลาไปปั่น",
  "free time",
  "free slot",
  "when am i free",
  "find time",
  "find me time",
];
export function isFreeTimeIntent(message: string): boolean {
  const m = message.toLowerCase();
  return FREE_TIME_MARKERS.some((c) => m.includes(c.toLowerCase()));
}

/**
 * Resolve which Bangkok day a free-time question is about. Minimal + robust:
 * "พรุ่งนี้ / tomorrow" → +1 day; otherwise today. Returns the instant `now`
 * shifted by whole days (the finder re-derives the Bangkok calendar day from it).
 */
export function resolveFreeTimeDay(message: string, now: Date): Date {
  const m = message.toLowerCase();
  const DAY_MS = 24 * 60 * 60 * 1000;
  if (m.includes("พรุ่งนี้") || m.includes("tomorrow")) {
    return new Date(now.getTime() + DAY_MS);
  }
  return now;
}

/** Build compact recall context for a chat turn. Exported for the idle follow-up. */
export async function buildChatContext(
  message: string,
  fetchGoogle: GoogleEventsFetcher,
  verified: boolean = true,
  attachments: ChatContext["attachments"] = [],
): Promise<ChatContext> {
  const openTasks = listTasks()
    .filter((t) => t.status === "open")
    .slice(0, CLAUDE_CONTEXT_TASK_CAP)
    .map((t) => ({ id: t.id, title: t.title.slice(0, 120) }));

  const memorySummaries = listMemoryEntries().map((m) => ({
    slug: m.slug,
    summary: m.summary,
  }));

  // Step 16 — real memory: pick the facts most relevant to this message. On a
  // scheduling-intent turn, also force-recall recurring class blocks (§4 boost) so
  // a class-schedule fact never drops out of a "มีเรียนไหม" read.
  const facts = recallFacts(
    message,
    FACT_RECALL_CAP,
    isSchedulingIntent(message),
  ).map((f) => ({
    id: f.id,
    content: f.content,
    category: f.category,
    pinned: f.pinned,
  }));

  const now = new Date();
  const eb = bucketEvents(listEvents(), now);
  const events = [...eb.today, ...eb.upcoming]
    .slice(0, BRIEF_EVENT_CAP)
    .map((e) => ({
      id: e.id,
      starts_at: e.starts_at,
      title: e.title.slice(0, 120),
    }));

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

  const approvalOutcomes = listRecentApprovalOutcomes(10).map((a) => ({
    id: a.id,
    action_type: a.action_type,
    status: a.status,
    execution_status: a.execution_status,
    summary: a.result_summary,
    error: a.execution_error,
    updated_at: a.updated_at,
  }));

  // Google recall uses a WIDE window so the model can target far-future events
  // (e.g. semester dates months out) by their REAL id instead of fabricating one.
  const { todayStartUtc, todayEndUtc } = agendaBounds(now);
  const { upcomingEndUtc: wideEndUtc } = agendaBounds(
    now,
    CHAT_GOOGLE_WINDOW_DAYS,
  );
  let googleEvents: ChatContext["googleEvents"] = [];
  // Raw events retain `end` (dropped by the ctx mapping below) so the Sprint-3
  // availability resolver can measure real durations/overlaps.
  let rawGoogleEvents: GoogleEvent[] = [];
  // [L2] On a scheduling-intent turn, force the cache fresh BEFORE reading so the
  // answer reflects a phone/web edit made seconds ago. Only when running through
  // the real cache (an injected stub fetcher in tests skips this). MIN_FRESH
  // gating + fail-soft live inside `primeFresh`.
  if (fetchGoogle === cachedGoogleEventsFetcher && isSchedulingIntent(message)) {
    await Promise.all([
      primeFresh(todayStartUtc, todayEndUtc),
      primeFresh(todayEndUtc, wideEndUtc),
    ]).catch(() => {});
  }
  try {
    const [gToday, gUpcoming] = await Promise.all([
      fetchGoogle(todayStartUtc, todayEndUtc),
      fetchGoogle(todayEndUtc, wideEndUtc),
    ]);
    rawGoogleEvents = [...gToday, ...gUpcoming];
    googleEvents = [
      ...gToday.map((e) => ({ e, bucket: "today" as const })),
      ...gUpcoming.map((e) => ({ e, bucket: "upcoming" as const })),
    ]
      .slice(0, CHAT_GOOGLE_EVENT_CAP)
      .map(({ e, bucket }) => ({
        id: e.id,
        start: e.start,
        title: e.title.slice(0, 120),
        allDay: e.allDay,
        bucket,
        // Where + what: surface so Friday can answer "where is this event" /
        // detail questions. Notes capped to keep the prompt small.
        location: e.location ? e.location.slice(0, 200) : null,
        notes: e.description ? e.description.slice(0, 300) : null,
      }));
  } catch {
    googleEvents = [];
  }

  // Fetch history AFTER the user message is persisted (caller handles that),
  // so `listRecentMessages` already includes this turn in the history for the
  // next invocation — but for THIS turn we read history BEFORE appending.
  const history = listRecentMessages(CHAT_HISTORY_LIMIT).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Step 17 — Gmail unread (capped at 5; fail gracefully when disabled/error).
  let gmailUnread: ChatContext["gmailUnread"] = [];
  if (isGmailEnabled()) {
    try {
      const msgs = await fetchUnreadGmailMessages(5);
      gmailUnread = msgs.map((m) => ({
        id: m.id,
        from: m.from,
        subject: m.subject,
        snippet: m.snippet,
      }));
    } catch {
      gmailUnread = [];
    }
  }

  // Step 18 — Google Contacts (capped at 50 for prompt; fail gracefully).
  // Track the REAL state so the prompt never conflates disabled / empty / error
  // (all three previously collapsed to an empty array → wrong "disabled" claim).
  let contacts: ChatContext["contacts"] = [];
  let contactsStatus: ChatContext["contactsStatus"] = "disabled";
  if (isContactsEnabled()) {
    try {
      const all = await fetchGoogleContacts(50);
      contacts = all.map((c) => ({ name: c.name, email: c.email }));
      contactsStatus = contacts.length > 0 ? "available" : "empty";
    } catch {
      contacts = [];
      contactsStatus = "disabled"; // enabled but unavailable → treat as not connected
    }
  }

  // Step 19 — Recent Drive files for AI awareness (capped at 10; fail silently).
  const recentDriveFiles = await getRecentDriveFiles(10);

  // Step 20 / Part 1 — LINE: the full chat LIST (so Friday knows every chat) +
  // recent messages grouped per chat for the most-active chats. Fail-soft → [].
  // Times shown are Asia/Bangkok wall-clock (the export's native time) — NOT UTC.
  const lineChats = getLineChatSummariesSafe().map((c) => ({
    name: c.name,
    messageCount: c.messageCount,
    lastMessageAt: c.lastMessageAt,
  }));
  const lineMessages = getRecentLineByChatSafe(
    LINE_CONTEXT_PER_CHAT,
    LINE_CONTEXT_MAX_CHATS,
  ).flatMap((g) =>
    g.messages.map((m) => ({
      chat: g.chat,
      sender: m.sender,
      text: m.text.slice(0, 200),
      date: m.date,
      time: m.time,
    })),
  );

  // FOCUSED chat retrieval: when the user names (or aliases) a specific chat — or
  // follows up about one named earlier — load THAT chat's recent messages so
  // Friday can summarise its CONTENT (not just repeat metadata), even when the
  // chat is not among the most-active ones above. Bangkok-native times. Fail-soft.
  // Redacted to null for unverified (see the hard redaction gate below).
  const knownChatNames = lineChats.map((c) => c.name);
  const priorUserMessages = history
    .filter((h) => h.role === "user")
    .map((h) => h.content);
  const focusedChatName = detectFocusedChat(
    message,
    priorUserMessages,
    knownChatNames,
  );
  let lineFocusedChat: ChatContext["lineFocusedChat"] = null;
  if (focusedChatName) {
    // S3 — boundary questions ("เก่าสุด/since when") need the OLDEST messages, not
    // just the recent tail: route them to head+tail. Content questions keep tail.
    const boundary = isLineBoundaryIntent(message);
    const msgs = boundary
      ? getChatHeadTail(focusedChatName, LINE_BOUNDARY_HEAD, LINE_BOUNDARY_TAIL)
      : getFocusedChatMessages(focusedChatName, LINE_FOCUSED_MSG_CAP);
    if (msgs.length > 0) {
      // S1 — coverage envelope: the TRUE extent of this chat's history, so Friday
      // never describes the windowed tail's oldest message as the export's start.
      lineFocusedChat = {
        chat: focusedChatName,
        messages: msgs.map((m) => ({
          sender: m.sender,
          text: m.text.slice(0, 200),
          date: m.date,
          time: m.time,
        })),
        coverage: getChatCoverageByName(focusedChatName),
        shown: msgs.length,
        boundary,
      };
    }
  }

  // Read-only keyword retrieval: surface LINE messages relevant to THIS question
  // even when they fall outside the recent-window above. Fail-soft → []. No-op
  // when no topical keywords remain. Redacted to [] for unverified (see below).
  const lineMatches = searchLineMessages(
    extractLineKeywords(message),
    LINE_SEARCH_CAP,
  ).map((m) => ({
    chat: m.chat,
    sender: m.sender,
    text: m.text.slice(0, 200),
    date: m.date,
    time: m.time,
  }));

  // Step 22 — conservative context router (deterministic; no model call)
  // Runs before the verified gate so unverified return can set empty values.
  // Evidence is only built for verified paths below.
  const allActiveTopics = listActiveTopics({ status: "active", limit: 20 });
  const activeTopicsCompact = allActiveTopics.map((t) => ({
    id: t.id,
    title: t.title,
    source: t.source,
    priority: t.priority,
  }));

  const resolution = resolveActiveTopicForMessage(message, allActiveTopics);

  let resolvedActiveTopic: ChatContext["resolvedActiveTopic"] = null;
  let activeTopicAmbiguity: ChatContext["activeTopicAmbiguity"] = null;

  if (resolution.kind === "resolved") {
    resolvedActiveTopic = {
      id: resolution.topic.id,
      title: resolution.topic.title,
      source: resolution.topic.source,
    };
  } else if (resolution.kind === "ambiguous") {
    activeTopicAmbiguity = resolution.candidates.map((t) => ({
      id: t.id,
      title: t.title,
    }));
  }

  // Decide whether to build LINE evidence (4 conditions from roadmap §7)
  const msgLower = message.toLowerCase();
  const LINE_EVIDENCE_MARKERS = ["line", "ไลน์", "แชท", "chat", "กลุ่ม", "group"];
  const hasLineMarker =
    LINE_EVIDENCE_MARKERS.some((m) => msgLower.includes(m)) ||
    allActiveTopics.some(
      (t) => t.chat_filter && msgLower.includes(t.chat_filter.toLowerCase()),
    );
  const msgKeywords = extractTopicKeywords(message);
  const keywordOverlap =
    resolution.kind === "resolved" &&
    msgKeywords.some((kw) =>
      resolution.topic.keywords.some(
        (tk) => tk.toLowerCase().includes(kw) || kw.includes(tk.toLowerCase()),
      ),
    );
  const shouldBuildEvidence =
    hasLineMarker ||
    resolution.kind === "resolved" ||
    isShortFollowupQuestion(message) ||
    keywordOverlap;

  // Evidence built only for verified users (set below; default empty)
  let lineEvidenceValue: ChatContext["lineEvidence"] = null;
  let verifierGuidanceValue: ChatContext["verifierGuidance"] = null;
  if (shouldBuildEvidence) {
    // Pick the topic to build evidence for
    const evidenceTopic =
      resolution.kind === "resolved"
        ? allActiveTopics.find((t) => t.id === resolution.topic.id) ?? null
        : isShortFollowupQuestion(message)
          ? allActiveTopics.find(
              (t) => t.source === "line" || t.source === "mixed",
            ) ?? null
          : null;

    if (evidenceTopic) {
      lineEvidenceValue = buildLineEvidenceForTopic(evidenceTopic);
      verifierGuidanceValue = verifyLineEvidenceAnswerIntent({
        userMessage: message,
        evidence: lineEvidenceValue,
      });
    }
  }

  // S4 — coverage-claim guard for a focused-chat BOUNDARY question. Forces Friday
  // to answer "earliest/since when" from the coverage fact (or hedge when none),
  // never from the windowed tail (docs/line-coverage-plan.md L1). Only when no
  // evidence verdict already governs the turn, so answer-intent keeps priority.
  // Verified-path only — the redaction gate discards it for unverified.
  if (!verifierGuidanceValue && lineFocusedChat && isLineBoundaryIntent(message)) {
    verifierGuidanceValue = verifyLineCoverageClaim({
      chat: lineFocusedChat.chat,
      coverage: lineFocusedChat.coverage ?? null,
    });
  }

  // Step 27 / Sprint 2 — STICKY schedule constraints (RC3/RC4). Resolved from
  // facts and injected on every scheduling-intent turn, independent of keyword
  // recall, so tank windows + class blocks never drop out mid-topic. Redacted to
  // [] for an unverified requester in the gate below (durable personal data).
  const schedulingIntent = isSchedulingIntent(message);
  const constraints = schedulingIntent ? resolveScheduleConstraints() : [];

  // Step 27 / Sprint 3 — ONE deterministic availability pass (RC1/RC5): clashes
  // across Google + local events + reminders + the constraints above. FAILS SOFT
  // → null (no false "free/clash"), never throws inside context building.
  let availability: ChatContext["availability"] = null;
  if (schedulingIntent) {
    try {
      availability = resolveAvailability(
        {
          googleEvents: rawGoogleEvents,
          localEvents: [...eb.today, ...eb.upcoming].map((e) => ({
            id: e.id,
            title: e.title,
            starts_at: e.starts_at,
            ends_at: e.ends_at,
          })),
          reminders: [...rb.overdue, ...rb.today, ...rb.upcoming].map((r) => ({
            id: r.id,
            title: r.title,
            due_at: r.due_at,
          })),
          constraints,
        },
        now,
        getSchedulePrefs(),
      );
    } catch {
      availability = null;
    }
  }

  // Step 27 / Sprint 4 (RC6) — deterministic schedule verdict: ALLOWED/BLOCKED
  // claim guidance derived from the availability pass + sticky constraints, so the
  // model narrates the computed clash set instead of eyeballing "free/clash".
  // Null when not a scheduling turn or availability failed soft.
  let scheduleVerifier: ChatContext["scheduleVerifier"] = null;
  if (schedulingIntent && availability) {
    try {
      scheduleVerifier = verifyScheduleAnswerIntent({ availability, constraints });
    } catch {
      scheduleVerifier = null;
    }
  }

  // Free-time finder: open gaps for the asked-about day across Google + local
  // events + class blocks/protected windows. Only on an explicit "find free time"
  // turn (a strict subset of scheduling intent). FAILS SOFT → null (never a fake
  // free window). Redacted to null for unverified in the gate below.
  let freeSlots: ChatContext["freeSlots"] = null;
  if (schedulingIntent && isFreeTimeIntent(message)) {
    try {
      const targetDay = resolveFreeTimeDay(message, now);
      const slots = findFreeSlotsForDay(targetDay, {
        googleEvents: rawGoogleEvents,
        localEvents: [...eb.today, ...eb.upcoming].map((e) => ({
          id: e.id,
          title: e.title,
          starts_at: e.starts_at,
          ends_at: e.ends_at,
        })),
        constraints,
      });
      const bkk = new Date(targetDay.getTime() + 7 * 60 * 60 * 1000);
      const date = `${bkk.getUTCFullYear()}-${String(bkk.getUTCMonth() + 1).padStart(2, "0")}-${String(bkk.getUTCDate()).padStart(2, "0")}`;
      freeSlots = { date, slots };
    } catch {
      freeSlots = null;
    }
  }

  const GENERIC_BUSY = "ไม่ว่าง (รายละเอียดส่วนตัว)";
  const GENERIC_TASK = "งานส่วนตัว";
  const GENERIC_REMINDER = "เตือนความจำส่วนตัว";

  // §7 HARD redaction gate: when unverified, private strings never reach the prompt.
  // This is the real security boundary — not the model's behaviour.
  if (!verified) {
    return {
      message,
      nowUtc: nowIso(),
      nowBangkok: bangkokWallClock(now),
      openTasks: openTasks.map((t) => ({ id: t.id, title: GENERIC_TASK })),
      memorySummaries: [],
      facts: [],
      googleEvents: googleEvents.map((e) => ({
        ...e,
        title: GENERIC_BUSY,
        // Privacy gate: a guest never sees the real place / notes either.
        location: null,
        notes: null,
      })),
      events: events.map((e) => ({ ...e, title: GENERIC_BUSY })),
      reminders: reminders.map((r) => ({ ...r, title: GENERIC_REMINDER })),
      approvalOutcomes: [],
      history: [],
      gmailUnread: [],
      contacts: [],
      contactsStatus: "redacted",
      recentDriveFiles: [],
      lineChats: [],
      lineMessages: [],
      lineFocusedChat: null,
      lineMatches: [],
      // Step 22 — redact all active topic / evidence fields for unverified
      activeTopics: [],
      resolvedActiveTopic: null,
      activeTopicAmbiguity: null,
      lineEvidence: makeEmptyLineEvidence(false, null),
      verifierGuidance: null,
      // Step 27 — constraints derive from durable facts: withhold for unverified.
      constraints: [],
      availability: null,
      scheduleVerifier: null,
      freeSlots: null,
      autoExecute: isAutoExecuteEnabled(),
      autoExecuteDestructive: isAutoExecuteDestructiveEnabled(),
      restricted: true,
    };
  }

  return {
    message,
    openTasks,
    memorySummaries,
    facts,
    nowUtc: nowIso(),
    nowBangkok: bangkokWallClock(now),
    googleEvents,
    events,
    reminders,
    approvalOutcomes,
    history,
    gmailUnread,
    contacts,
    contactsStatus,
    recentDriveFiles,
    lineChats,
    lineMessages,
    lineFocusedChat,
    lineMatches,
    // Step 22 — active topics and evidence (verified path only)
    activeTopics: activeTopicsCompact,
    resolvedActiveTopic,
    activeTopicAmbiguity,
    lineEvidence: lineEvidenceValue,
    verifierGuidance: verifierGuidanceValue,
    // Step 27 / Sprint 2 — sticky schedule constraints (verified path only).
    constraints,
    // Step 27 / Sprint 3 — unified availability findings (verified path only).
    availability,
    // Step 27 / Sprint 4 — schedule verdict / claim guardrails (verified path only).
    scheduleVerifier,
    // Schedule Import — free-time windows (verified path only; null otherwise).
    freeSlots,
    // Chat doc attachments for this turn (verified path only — restricted branch
    // above never reaches here, so attachment content never leaks to a guest).
    attachments,
    autoExecute: isAutoExecuteEnabled(),
    autoExecuteDestructive: isAutoExecuteDestructiveEnabled(),
    restricted: false,
  };
}

export async function runChat(
  message: string,
  invoke: ClaudeInvoker,
  fetchGoogle: GoogleEventsFetcher = cachedGoogleEventsFetcher,
  opts: {
    verified?: boolean;
    sessionId?: string;
    originalMessage?: string;
    attachments?: ChatContext["attachments"];
  } = {},
): Promise<ChatResult> {
  const verified = opts.verified ?? true;
  const kw = classifySensitivity(message);

  // 1. Build context (reads history BEFORE this turn, so history is prior turns).
  const ctx = await buildChatContext(message, fetchGoogle, verified, opts.attachments ?? []);

  // 2. Invoke Claude. Any spawn/timeout/disabled error fails closed.
  let raw: string;
  try {
    raw = await invoke(ctx.message.length > 0 ? buildChatPrompt(ctx) : "", {
      timeoutMs: CLAUDE_BRIEF_TIMEOUT_MS,
    });
  } catch (err) {
    if (err instanceof ClaudeError || err instanceof GeminiError) {
      return {
        kind: "failed",
        reason: err.reason,
        message: err.message,
        userMessage: chatFailureMessage(err.reason),
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      kind: "failed",
      reason: "spawn",
      message: msg,
      userMessage: chatFailureMessage("spawn"),
    };
  }

  // 3. Normalize + strict JSON parse. No repair; prose still fails.
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJsonOutput(raw));
  } catch {
    const snippet = raw.slice(0, 300).replace(/\n/g, "\\n");
    return {
      kind: "rejected",
      message: invalidOutputMessage,
      detail: `Claude output was not valid JSON. Raw(300): ${snippet}`,
    };
  }

  // 4. Validate against strict schema.
  const check = chatOutputSchema.safeParse(parsed);
  if (!check.success) {
    const detail = check.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return {
      kind: "rejected",
      message: invalidOutputMessage,
      detail: `Claude output failed validation: ${detail}`,
    };
  }

  // 5. H4 — structural fact-id remap. The prompt showed facts as opaque refs
  //    [F1], [F2], … so the model never sees a real DB id. Map the F-number the
  //    model put in a fact.update / fact.forget "id" back to the real id here,
  //    BEFORE dispatch. An unmapped ref (out of range / hallucinated) cannot be
  //    targeted safely → drop that action rather than risk hitting the wrong row.
  // Peel off the chat-only bulk-create action first: it is staged into a
  // reviewable plan (below), never dispatched through the executor. Only the
  // FIRST is honored — one bulk add per turn. Everything else flows as normal.
  const bulkCreateAction = check.data.actions.find(
    (a): a is CalendarBulkCreateAction =>
      a.action_type === "calendar.bulk_create",
  );
  const executorActions = check.data.actions.filter(
    (a): a is AiAction => a.action_type !== "calendar.bulk_create",
  );

  const factIdMap = new Map<number, number>();
  ctx.facts.forEach((f, i) => factIdMap.set(i + 1, f.id));
  const actionsToDispatch: AiAction[] = [];
  for (const action of executorActions) {
    if (
      action.action_type === "fact.update" ||
      action.action_type === "fact.forget"
    ) {
      const localId = (action.payload as { id?: number }).id;
      const realId =
        typeof localId === "number" ? factIdMap.get(localId) : undefined;
      if (realId === undefined) continue; // unmapped fact ref — drop, do not guess
      actionsToDispatch.push({
        ...action,
        payload: { ...action.payload, id: realId },
      } as AiAction);
    } else {
      actionsToDispatch.push(action);
    }
  }

  // Each action is dispatched — auto-executed when eligible, else a pending
  // approval. Unverified requesters: skip dispatch entirely (defense in depth —
  // prompt also instructs the model not to propose writes for guests).
  const dispatched: DispatchResult[] = verified
    ? await Promise.all(
        actionsToDispatch.map((action: AiAction) =>
          dispatchProposedAction(action.action_type, action.payload, "chat"),
        ),
      )
    : [];
  const approvals: Approval[] = dispatched.map((d) => d.approval);

  // 5a. Bulk calendar add → stage a reviewable plan (verified path only). The
  // model put the FULL event list in one action, so nothing is lost to the
  // per-turn action cap; the per-item conflict scan runs here. Writes NOTHING to
  // Google. Fails soft: a build error just omits the plan (the reply still posts).
  let calendarPlan:
    | { plan: CalendarPlan; items: CalendarPlanItem[] }
    | undefined;
  if (verified && bulkCreateAction) {
    try {
      calendarPlan = await buildCalendarPlan(bulkCreateAction.payload, fetchGoogle);
    } catch {
      calendarPlan = undefined;
    }
  }

  // 5b. S1 anti-nag interceptor — if a data mutation/correction is in flight, the
  // backend FORCES the follow-up question off this turn. This is the code-level
  // guarantee that survives the model ignoring the "don't re-ask" prompt rule: a
  // turn that is already acting on a correction never also interrogates the user.
  const hasMutation =
    dispatched.some((d) => MUTATION_ACTION_TYPES.has(d.approval.action_type)) ||
    calendarPlan !== undefined;
  if (hasMutation) {
    check.data.clarification = undefined;
    check.data.clarification_choices = undefined;
  }

  // 5c. Deterministic NO-SCHEDULE backstop. The "a schedule fact IS the schedule"
  // rule is prompt-only; a model (esp. Gemini) can still answer "ไม่มีตาราง...ใน
  // ปฏิทิน" while a recurring class block sits right in context. When this turn HAS
  // recurring_block constraints but the reply denies a schedule, the backend appends
  // the real blocks (weekday + time) so a present schedule can never be silently
  // denied. Heuristic by design (denial regex); only fires when blocks exist.
  const recurringBlocks = (ctx.constraints ?? []).filter(
    (c) => c.kind === "recurring_block",
  );
  // Schedule-table facts (weekly tables of single start-times) can't be structured
  // constraints but still represent a real schedule the model must not deny.
  const scheduleLikeFacts = (ctx.facts ?? []).filter(
    (f) => f.category === "routine" && /\d{1,2}[:.]\d{2}/.test(f.content),
  );
  const reply = check.data.reply;
  if (
    (recurringBlocks.length > 0 || scheduleLikeFacts.length > 0) &&
    SCHEDULE_DENIAL_RE.test(reply)
  ) {
    if (recurringBlocks.length > 0 && !recurringBlocks.some((c) => reply.includes(c.startLocal))) {
      // Structured blocks → tidy weekday + time summary.
      const summary = recurringBlocks
        .map((c) => `${formatThaiWeekdays(c.weekdays)} ${c.startLocal}–${c.endLocal}`)
        .join(", ");
      check.data.reply = `${reply}\n\n📚 หมายเหตุจากระบบ: มีตารางเรียนที่บันทึกไว้ — ${summary} (ถ้าต้องการเฉพาะวันใด บอกได้)`;
      if (check.data.spoken) {
        check.data.spoken = `${check.data.spoken} ที่จริงมีตารางเรียนบันทึกไว้ด้วย ลองถามเจาะจงวันได้`;
      }
    } else if (scheduleLikeFacts.length > 0) {
      // Unstructured weekly table → surface the stored table verbatim (truthful,
      // complete) so a real schedule is never denied even when it cannot be parsed
      // into per-day windows. Capped to keep the reply readable.
      const table = scheduleLikeFacts[0].content.slice(0, 600);
      check.data.reply = `${reply}\n\n📚 หมายเหตุจากระบบ: มีตารางเรียนบันทึกไว้ในความจำ — ${table}`;
      if (check.data.spoken) {
        check.data.spoken = `${check.data.spoken} ที่จริงมีตารางเรียนบันทึกไว้ในความจำด้วย ดูรายละเอียดบนหน้าจอได้`;
      }
    }
  }

  // 6. Persist the exchange (user + assistant). Only reaches here on success,
  //    so history never contains failed/rejected attempts.
  appendMessage("user", opts.originalMessage ?? message);
  const actionsJson =
    approvals.length > 0
      ? JSON.stringify(
          approvals.map((a) => ({ id: a.id, action_type: a.action_type })),
        )
      : null;
  // The reply is an ACK (written before execution). Attach the action buttons to
  // it, then append the TRUE outcome as a second assistant message so reporting
  // is never faked — it reflects the real executor result.
  appendMessage("assistant", check.data.reply, actionsJson);
  const report = buildActionReport(dispatched);
  if (report) appendMessage("assistant", report.text);

  const modelPrivate = check.data.sensitivity === "private";
  const verificationRequired =
    isGuardEnabled() && !verified && (kw.private || modelPrivate);

  return {
    kind: "replied",
    reply: check.data.reply,
    spoken: check.data.spoken,
    resultReport: report?.text,
    resultSpoken: report?.spoken,
    approvals,
    calendarPlan,
    clarification: check.data.clarification,
    clarificationChoices: check.data.clarification_choices,
    notes: check.data.notes,
    verificationRequired: verificationRequired || undefined,

    sensitivity: check.data.sensitivity,
  };
}
