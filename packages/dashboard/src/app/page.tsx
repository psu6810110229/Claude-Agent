"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion";
import {
  ArrowDown,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronDown,
  Clock3,
  Copy,
  Database,
  ExternalLink,
  FileText,
  Folder,
  Mail,
  MessageCircle,
  RotateCcw,
} from "lucide-react";
import {
  ApiError,
  approveApproval,
  generateDailyBrief,
  generateEveningBrief,
  getChallenge,
  getChatHistory,
  listApprovals,
  rejectApproval,
  requestChatFollowup,
  resetChat,
  sendChat,
  sendChatStream,
  prepareSpeech,
  speak,
  unlockAudioPlayback,
  verifyIdentity,
  uploadScheduleFile,
  createScheduleImport,
  listClassBlocks,
  getCalendarToday,
  getCalendarUpcoming,
  listEvents,
  listReminders,
  discardCalendarPlan,
} from "@/lib/api";
import { ScheduleImportCard } from "@/components/ScheduleImportCard";
import { CalendarPlanCard } from "@/components/CalendarPlanCard";
import { WeekHourGrid, type GridBlock } from "@/components/WeekHourGrid";
import { DayAgendaCard, type DayItem } from "@/components/DayAgendaCard";
import type {
  ScheduleImportResult,
  ApproveImportResult,
  CalendarPlanResult,
  ApproveCalendarPlanResult,
  ClassBlock,
  StagedAttachment,
} from "@/lib/types";
import {
  cancelAck,
  nextAckRequestId,
  preloadAckAudio,
  settleAckForFinal,
  startAck,
} from "@/lib/voiceAcks";
import { actionQuestion, isActionType } from "@/lib/actionDisplay";
import { ErrorBanner } from "@/components/States";
import { Orb, type OrbState } from "@/components/Orb";
import { JarvisInput } from "@/components/JarvisInput";
import { Button, ConfirmDialog, IconButton, Sheet } from "@/components/ui";
import { WelcomeAgenda } from "@/components/WelcomeAgenda";
import { useShell } from "@/components/Shell";
import { useToast } from "@/components/ToastProvider";
import {
  DEFAULT_GEMINI_MODEL,
  type ActionType,
  type ActiveJobProgress,
  type AiProviderId,
  type ProviderChoice,
  type Approval,
  type BriefResult,
  type BriefType,
  type ChatMessage,
  type ChatResult,
  type ChatSourcePreview,
  type VerifyResult,
} from "@/lib/types";

const PROVIDER_LABELS: Record<AiProviderId, string> = {
  claude: "Claude",
  gemini: "Gemini",
  qwen: "Qwen",
  glm: "GLM",
  gpt4o: "GPT-4o",
};

const CHAT_BUBBLE_REVEAL_INITIAL = {
  opacity: 0,
  y: 18,
  scale: 0.982,
  filter: "blur(10px)",
};

const CHAT_BUBBLE_REVEAL_ANIMATE = {
  opacity: 1,
  y: 0,
  scale: 1,
  filter: "blur(0px)",
};

const CHAT_BUBBLE_PHYSICS: Transition = {
  layout: { type: "spring", stiffness: 156, damping: 23, mass: 0.82 },
  y: { type: "spring", stiffness: 142, damping: 19, mass: 0.9 },
  scale: { type: "spring", stiffness: 190, damping: 22, mass: 0.72 },
  opacity: { duration: 0.22, ease: [0.25, 1, 0.5, 1] },
  filter: { duration: 0.34, ease: [0.25, 1, 0.5, 1] },
};

/** Idle delay before Jarvis offers a proactive follow-up after its last turn. */
const FOLLOWUP_IDLE_MS = 5000;

/** Deterministic "show me my timetable" intent — drives the inline grid render. */
const TIMETABLE_VIEW_MARKERS = [
  "ตารางเรียน",
  "ตารางสอน",
  "ขอตาราง",
  "ดูตาราง",
  "ตารางทั้งสัปดาห์",
  "ตารางสัปดาห์",
  "คาบเรียน",
  "timetable",
  "class schedule",
  "my schedule",
];
function isTimetableViewIntent(text: string): boolean {
  const m = text.toLowerCase();
  return TIMETABLE_VIEW_MARKERS.some((k) => m.includes(k.toLowerCase()));
}

/** ClassBlock "HH:MM" → minutes from midnight. */
function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * "What's on a given DAY" intent — classes + dated work + events for ONE day,
 * distinct from the weekly class timetable. Requires a day reference AND is NOT
 * a class-specific ask (so "ตารางเรียนวันนี้" stays the weekly classes view).
 */
const THAI_WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
/** Weekday name (Thai/English) → index, for "ขอตารางวันเสาร์" requests. */
const WEEKDAY_NAME_IDX: [string, number][] = [
  ["อาทิตย์", 0], ["sunday", 0],
  ["จันทร์", 1], ["monday", 1],
  ["อังคาร", 2], ["tuesday", 2],
  ["พุธ", 3], ["wednesday", 3],
  ["พฤหัสบดี", 4], ["พฤหัส", 4], ["thursday", 4],
  ["ศุกร์", 5], ["friday", 5],
  ["เสาร์", 6], ["saturday", 6],
];
const DAY_REF_MARKERS = [
  "วันนี้", "พรุ่งนี้", "มะรืน", "today", "tomorrow", "สุดสัปดาห์", "weekend",
  ...WEEKDAY_NAME_IDX.map(([n]) => n),
];
function isDayAgendaIntent(text: string): boolean {
  const m = text.toLowerCase();
  const hasDay = DAY_REF_MARKERS.some((k) => m.includes(k));
  const asksSchedule = ["ตาราง", "มีอะไร", "มีงาน", "ต้องทำ", "อะไรบ้าง", "นัด", "schedule", "what"].some(
    (k) => m.includes(k),
  );
  const classSpecific = ["ตารางเรียน", "ตารางสอน", "คาบเรียน", "timetable"].some((k) => m.includes(k));
  return hasDay && asksSchedule && !classSpecific;
}

function bkkDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d);
}
function bkkWeekday(d: Date): number {
  return new Date(d.toLocaleString("en-US", { timeZone: "Asia/Bangkok" })).getDay();
}
function bkkTimeLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Bangkok",
  }).format(new Date(iso));
}
function bkkMinOf(iso: string): number {
  const [h, m] = bkkTimeLabel(iso).split(":").map(Number);
  return h * 60 + m;
}
const DAY_MS = 24 * 60 * 60 * 1000;
/** The next date (>= today, Bangkok) that falls on `weekday`. */
function nextWeekday(weekday: number): Date {
  const now = new Date();
  const delta = (weekday - bkkWeekday(now) + 7) % 7;
  return new Date(now.getTime() + delta * DAY_MS);
}

/**
 * Resolve ALL days an agenda request references (supports multiple, e.g.
 * "เสาร์และอาทิตย์"). De-duped and sorted ascending. Falls back to today.
 */
function resolveAgendaDays(text: string): Date[] {
  const m = text.toLowerCase();
  const out: Date[] = [];
  const seen = new Set<string>();
  const add = (d: Date) => {
    const k = bkkDateStr(d);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(d);
    }
  };
  if (m.includes("วันนี้") || m.includes("today")) add(new Date());
  if (m.includes("พรุ่งนี้") || m.includes("tomorrow")) add(new Date(Date.now() + DAY_MS));
  if (m.includes("มะรืน")) add(new Date(Date.now() + 2 * DAY_MS));
  if (m.includes("สุดสัปดาห์") || m.includes("weekend")) {
    add(nextWeekday(6));
    add(nextWeekday(0));
  }
  for (const [name, idx] of WEEKDAY_NAME_IDX) {
    if (m.includes(name)) add(nextWeekday(idx));
  }
  if (out.length === 0) add(new Date());
  out.sort((a, b) => a.getTime() - b.getTime());
  return out.slice(0, 7);
}

function dayAgendaLabel(d: Date): string {
  const today = bkkDateStr(new Date());
  const tmr = bkkDateStr(new Date(Date.now() + DAY_MS));
  const ds = bkkDateStr(d);
  const prefix = ds === today ? "วันนี้" : ds === tmr ? "พรุ่งนี้" : "";
  const dm = new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Bangkok",
  }).format(d);
  const wd = THAI_WEEKDAYS[bkkWeekday(d)];
  return prefix ? `${prefix} · ${wd} ${dm}` : `วัน${wd} ${dm}`;
}

interface AgendaSources {
  blocks: ClassBlock[];
  locals: Awaited<ReturnType<typeof listEvents>>;
  reminders: Awaited<ReturnType<typeof listReminders>>;
  gevents: Awaited<ReturnType<typeof getCalendarToday>>["events"];
}

/** Fetch every agenda source ONCE (so a multi-day request isn't N× the calls). */
async function fetchAgendaSources(): Promise<AgendaSources> {
  const [blocks, locals, reminders, gToday, gUpcoming] = await Promise.all([
    listClassBlocks().catch(() => []),
    listEvents().catch(() => []),
    listReminders().catch(() => []),
    getCalendarToday().catch(() => ({ events: [], available: false })),
    getCalendarUpcoming().catch(() => ({ events: [], available: false })),
  ]);
  const seen = new Set<string>();
  const gevents = [...gToday.events, ...gUpcoming.events].filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  return { blocks, locals, reminders, gevents };
}

/** Assemble one day's combined agenda from pre-fetched sources. Pure. */
function assembleDay(targetDay: Date, src: AgendaSources): { dateLabel: string; items: DayItem[] } {
  const dateStr = bkkDateStr(targetDay);
  const wd = bkkWeekday(targetDay);
  const items: DayItem[] = [];
  for (const b of src.blocks) {
    if (b.weekday === wd) {
      items.push({ id: `c${b.id}`, kind: "class", startMin: hhmmToMin(b.start_local), startLabel: b.start_local, endLabel: b.end_local, title: b.subject, sub: b.location });
    }
  }
  for (const e of src.gevents) {
    if (e.allDay) {
      if (e.start === dateStr) {
        items.push({ id: `g${e.id}`, kind: "event", startMin: null, startLabel: null, endLabel: null, title: e.title, sub: e.location, allDay: true });
      }
    } else if (bkkDateStr(new Date(e.start)) === dateStr) {
      items.push({ id: `g${e.id}`, kind: "event", startMin: bkkMinOf(e.start), startLabel: bkkTimeLabel(e.start), endLabel: e.end ? bkkTimeLabel(e.end) : null, title: e.title, sub: e.location });
    }
  }
  for (const ev of src.locals) {
    if (ev.status !== "archived" && bkkDateStr(new Date(ev.starts_at)) === dateStr) {
      items.push({ id: `e${ev.id}`, kind: "event", startMin: bkkMinOf(ev.starts_at), startLabel: bkkTimeLabel(ev.starts_at), endLabel: ev.ends_at ? bkkTimeLabel(ev.ends_at) : null, title: ev.title, sub: ev.location });
    }
  }
  for (const r of src.reminders) {
    if (r.status === "active" && bkkDateStr(new Date(r.due_at)) === dateStr) {
      items.push({ id: `r${r.id}`, kind: "reminder", startMin: bkkMinOf(r.due_at), startLabel: bkkTimeLabel(r.due_at), endLabel: null, title: r.title, sub: r.notes });
    }
  }
  return { dateLabel: dayAgendaLabel(targetDay), items };
}

/** Build one agenda per referenced day (fetch once, assemble each). Fail-soft. */
async function buildDayAgendas(days: Date[]): Promise<{ dateLabel: string; items: DayItem[] }[]> {
  const src = await fetchAgendaSources();
  return days.map((d) => assembleDay(d, src));
}

/** Time-of-day greeting in the user's timezone (Asia/Bangkok). */
function greetingNow(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Bangkok",
    }).format(new Date()),
  );
  if (hour < 5) return "สวัสดีตอนเย็น";
  if (hour < 12) return "อรุณสวัสดิ์";
  if (hour < 18) return "สวัสดีตอนบ่าย";
  return "สวัสดีตอนเย็น";
}

// Resolve the element that actually scrolls above `node`. The chat list itself
// has `max-height: none`, so on this layout the window scrolls; this still
// returns an inner scroller if a future layout introduces one.
function getScrollParent(node: HTMLElement | null): HTMLElement | Window {
  let el: HTMLElement | null = node?.parentElement ?? null;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll" || oy === "overlay") && el.scrollHeight > el.clientHeight) {
      return el;
    }
    el = el.parentElement;
  }
  return window;
}

function distanceFromBottom(scroller: HTMLElement | Window): number {
  const el =
    scroller === window
      ? (document.scrollingElement ?? document.documentElement)
      : (scroller as HTMLElement);
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

type ApprovalMap = Record<number, Approval>;
interface MessageMeta {
  provider: AiProviderId;
  selectedModel?: string | null;
  latencyMs?: number;
}
interface ClarificationPrompt {
  messageId: number;
  question: string;
  choices: string[];
}

interface PendingApprovalRejection {
  id: number;
  question: string;
  rejectLabel: string;
}

export default function HomePage() {
  const { notify } = useToast();
  const { setNewSession } = useShell();
  const [greeting, setGreeting] = useState<string | null>(null);
  const reduceMotion = useReducedMotion() ?? false;
  const isCoarsePointer = useCoarsePointer();
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [provider, setProvider] = useState<ProviderChoice>("gemini");
  const [geminiModel, setGeminiModel] = useState<string>(DEFAULT_GEMINI_MODEL);
  const [messageProvider, setMessageProvider] = useState<
    Record<number, AiProviderId>
  >({});
  const [messageMeta, setMessageMeta] = useState<Record<number, MessageMeta>>({});
  const [messageJobProgress, setMessageJobProgress] = useState<
    Record<number, ActiveJobProgress[]>
  >({});
  const [messageSourcePreviews, setMessageSourcePreviews] = useState<
    Record<number, ChatSourcePreview[]>
  >({});
  const [approvalMap, setApprovalMap] = useState<ApprovalMap>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [briefBusy, setBriefBusy] = useState<BriefType | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [chatErrorRendered, setChatErrorRendered] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState<number | null>(null);
  const [pendingRejectAction, setPendingRejectAction] =
    useState<PendingApprovalRejection | null>(null);
  const [resetting, setResetting] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const [revealingMessageIds, setRevealingMessageIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [activeClarification, setActiveClarification] =
    useState<ClarificationPrompt | null>(null);
  const [muted, setMuted] = useState(false);
  // Schedule import — attach a timetable image/PDF → inline review card.
  const [attachBusy, setAttachBusy] = useState(false);
  const [importCard, setImportCard] = useState<ScheduleImportResult | null>(null);
  // Bulk Google Calendar add staged from a chat turn → inline review card. The
  // model put the whole event list in one action; nothing is on the calendar
  // until the user approves the selected items here.
  const [planCard, setPlanCard] = useState<CalendarPlanResult | null>(null);
  // Files STAGED in the composer but not yet sent — they wait for the user to
  // type a prompt and hit send, then ride along with that chat turn.
  const [pendingAttachments, setPendingAttachments] = useState<StagedAttachment[]>([]);
  // Files already sent in THIS conversation: their ids ride along with every
  // later chat turn so Friday can keep answering about them across follow-ups.
  const [activeAttachmentIds, setActiveAttachmentIds] = useState<string[]>([]);
  // When the user asks to SEE their timetable, render the real class blocks as a
  // visual grid inline (deterministic, not the model's text formatting).
  const [timetableBlocks, setTimetableBlocks] = useState<ClassBlock[] | null>(null);
  // When the user asks for specific DAY(S)' schedule (classes + work + events).
  // One entry per referenced day (supports "เสาร์และอาทิตย์").
  const [dayAgenda, setDayAgenda] = useState<{ dateLabel: string; items: DayItem[] }[] | null>(null);
  // Step 15 — privacy guard (conversational flow)
  const [verified, setVerified] = useState(false);
  const [guardEnabled, setGuardEnabled] = useState(false);
  const [pendingVerificationPrompt, setPendingVerificationPrompt] = useState<string | null>(null);
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null);
  const [streamThinking, setStreamThinking] = useState("");
  const [thinkingDone, setThinkingDone] = useState(false);
  // Ref mirror of streamThinking so doSend can read the FULL accumulated
  // reasoning after awaits (state closure would be stale = "").
  const streamThinkingRef = useRef("");
  // Persisted CoT per assistant message id (session-scoped, like messageMeta):
  // once a turn finishes, its reasoning attaches to that bubble as a collapsed
  // expandable panel instead of floating in a separate orphan bubble.
  const [messageThinking, setMessageThinking] = useState<Record<number, string>>({});
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // True while the user is at/near the bottom (or just sent a message). When
  // they scroll up to read history this flips false and auto-scroll is paused.
  const stickToBottomRef = useRef(true);
  const followupTimerRef = useRef<number | null>(null);
  // Live mirror of `muted` so the idle-follow-up timer reads the current value
  // (its closure is captured when scheduled, before any later mute toggle).
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // Hydrate muted + Gemini model from localStorage after mount (avoid SSR mismatch).
  useEffect(() => {
    setMuted(localStorage.getItem("jarvis.muted") === "true");
    const savedModel = localStorage.getItem("jarvis.geminiModel");
    if (savedModel) setGeminiModel(savedModel);
  }, []);

  // Step 15 — init per-tab sessionId (sessionStorage clears on tab close).
  useEffect(() => {
    let id = sessionStorage.getItem("chatSessionId");
    if (!id) {
      id = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
        ? crypto.randomUUID()
        : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
      sessionStorage.setItem("chatSessionId", id);
    }
    sessionIdRef.current = id;
    // Silently fetch guard state so the lock icon appears at startup.
    void getChallenge()
      .then((res) => {
        setGuardEnabled(res.guardEnabled);
      })
      .catch(() => {});
  }, []);

  // Step 23 — preload short acknowledgement phrases once on chat page load.
  // Fail-soft: missing ones fall back to on-demand /api/tts when spoken.
  useEffect(() => {
    void preloadAckAudio();
  }, []);

  // Cancel any pending follow-up when the component unmounts.
  useEffect(
    () => () => {
      if (followupTimerRef.current !== null) {
        window.clearTimeout(followupTimerRef.current);
      }
      abortControllerRef.current?.abort();
    },
    [],
  );

  // Surface the "เริ่มใหม่" control in the global TopBar (next to the bell).
  // Re-registers when busy state changes so the button disables correctly.
  useEffect(() => {
    setNewSession({
      onClick: requestNewSession,
      disabled: sending || briefBusy !== null || resetting,
      busy: resetting,
    });
    return () => setNewSession(null);
  }, [sending, briefBusy, resetting, setNewSession]);

  const hasConversation = messages.length > 0 || sending || briefBusy !== null;

  useEffect(() => {
    setGreeting(greetingNow());
  }, []);

  useEffect(() => {
    Promise.all([getChatHistory(100), listApprovals()])
      .then(([msgs, approvals]) => {
        setMessages(chatVisibleMessages(msgs));
        setApprovalMap(indexApprovals(approvals));
        const pendingCount = approvals.filter((a) => a.status === "pending").length;
        if (pendingCount > 0) {
          notify({
            kind: "warning",
            title: "มีงานรอ approve",
            description: `${pendingCount} รายการต้องตัดสินใจก่อนทำงานต่อ`,
          });
          setOrbState("alert");
        }
        setLoading(false);
      })
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : String(err));
        setLoading(false);
      });
  }, [notify]);

  // Track proximity to the bottom so reading history isn't interrupted.
  useEffect(() => {
    if (!hasConversation) return;
    const scroller = getScrollParent(bottomRef.current);
    const NEAR_BOTTOM_PX = 120;
    const onScroll = () => {
      const away = distanceFromBottom(scroller) >= NEAR_BOTTOM_PX;
      stickToBottomRef.current = !away;
      setShowScrollBottom(away);
    };
    const target: Window | HTMLElement = scroller;
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [hasConversation]);

  // Auto-scroll only when the user is already near the bottom or just sent a
  // message (doSend sets stickToBottomRef). Suppressed while reading history.
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
    setShowScrollBottom(false);
    // Intentionally NOT keyed on streamThinking: reasoning tokens must not
    // nudge the viewport. Scroll fires on send start + when the answer lands.
  }, [messages, sending, briefBusy, reduceMotion]);

  function clearFollowup() {
    if (followupTimerRef.current !== null) {
      window.clearTimeout(followupTimerRef.current);
      followupTimerRef.current = null;
    }
  }

  function scheduleFollowup() {
    clearFollowup();
    followupTimerRef.current = window.setTimeout(() => {
      void runFollowup();
    }, FOLLOWUP_IDLE_MS);
  }

  function attachJobProgress(messageId: number, jobs: ActiveJobProgress[] | undefined) {
    const visibleJobs = compactChatJobProgress(jobs);
    if (visibleJobs.length === 0) return;
    setMessageJobProgress((prev) => ({
      ...prev,
      [messageId]: visibleJobs,
    }));
  }

  function attachSourcePreviews(
    messageId: number,
    previews: ChatSourcePreview[] | undefined,
  ) {
    const visible = (previews ?? []).filter((preview) => preview.items.length > 0);
    if (visible.length === 0) return;
    setMessageSourcePreviews((prev) => ({
      ...prev,
      [messageId]: visible,
    }));
  }

  // Idle proactive nudge. Fires once after the user stays quiet; never loops
  // (it does not reschedule itself) and stays silent unless the backend offers
  // something useful. Any failure is swallowed — a nudge must never disrupt.
  async function runFollowup() {
    if (sending || briefBusy || resetting) return;
    const previousIds = new Set(messages.map((message) => message.id));
    try {
      const result = await requestChatFollowup(sessionIdRef.current ?? undefined);
      if (result.kind !== "followup") return;
      if (result.approvals.length > 0) {
        mergeApprovals(result.approvals);
        notifyPendingApprovals(result.approvals.length);
      }
      if (!mutedRef.current) void speak(result.spoken ?? result.reply);
      const updated = await getChatHistory(100);
      const visible = chatVisibleMessages(updated);
      const fresh = [...visible]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" && !previousIds.has(message.id),
        );
      setMessages(visible);
      if (fresh) {
        setRevealingMessageIds((prev) => new Set(prev).add(fresh.id));
      }
    } catch {
      // Silent — proactive follow-up must never surface an error.
    }
  }

  async function requestChatResult(
    text: string,
    turnAttachmentIds: string[],
    controller: AbortController,
  ): Promise<{ result: ChatResult; latencyMs: number }> {
    const startedAt = performance.now();
    if (typeof ReadableStream === "undefined") {
      const result = await sendChat(
        text,
        provider,
        sessionIdRef.current ?? undefined,
        geminiModel,
        turnAttachmentIds.length > 0 ? turnAttachmentIds : undefined,
      );
      return { result, latencyMs: Math.round(performance.now() - startedAt) };
    }

    let finalResult: ChatResult | null = null;
    let streamError: string | null = null;
    await sendChatStream(
      text,
      provider,
      sessionIdRef.current ?? undefined,
      geminiModel,
      turnAttachmentIds.length > 0 ? turnAttachmentIds : undefined,
      {
        onThinking: (delta) => {
          streamThinkingRef.current += delta;
          setStreamThinking((prev) => `${prev}${delta}`);
        },
        onDone: (result) => {
          finalResult = result;
          setThinkingDone(true);
          setThinkingStatus("กำลังเรียบเรียงคำตอบ");
        },
        onError: (message) => {
          streamError = message;
        },
      },
      controller.signal,
    );

    if (!finalResult) {
      throw new ApiError(streamError ?? "Chat stream ended before the final answer", 502);
    }
    return { result: finalResult, latencyMs: Math.round(performance.now() - startedAt) };
  }

  function stopStreaming() {
    const controller = abortControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort();
    cancelAck();
    setSending(false);
    setOrbState("idle");
    setThinkingStatus(null);
    setThinkingDone(true);
    notify({
      kind: "info",
      title: "หยุดแล้ว",
      description: "หยุดการสร้างคำตอบแล้ว",
    });
  }

  function scrollToLatest() {
    stickToBottomRef.current = true;
    setShowScrollBottom(false);
    bottomRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }

  function promptForRegenerate(content: string): string {
    const cleaned = content
      .split("\n")
      .filter((line) => !line.startsWith("\uD83D\uDCCE "))
      .join("\n")
      .trim();
    return cleaned || content;
  }

  async function regenerateFromAssistant(assistantId: number) {
    if (sending || briefBusy || resetting) return;
    const index = messages.findIndex((message) => message.id === assistantId);
    const previousUser = messages
      .slice(0, index >= 0 ? index : messages.length)
      .reverse()
      .find((message) => message.role === "user");
    if (!previousUser) return;
    await doSend(promptForRegenerate(previousUser.content));
  }

  async function doSend(text: string, isRetry = false) {
    if (briefBusy) return;
    // Unlock TTS playback while still inside the user's send gesture, so the
    // reply audio is allowed to play later under strict autoplay policies.
    unlockAudioPlayback();
    // A user-initiated send always pulls the view to the latest message.
    stickToBottomRef.current = true;
    clearFollowup();
    const previousIds = new Set(messages.map((message) => message.id));
    setOrbState("thinking");
    setSending(true);
    setSendError(null);
    setChatErrorRendered(false);
    setLastFailedMessage(null);
    setActiveClarification(null);
    setTimetableBlocks(null);
    setDayAgenda(null);

    // Files STAGED in the composer ride along with THIS turn (plus any already
    // sent earlier in the conversation). Snapshot now; kept staged through a
    // verification re-run and only promoted to "active" once the turn succeeds.
    const turnAttachmentIds = Array.from(
      new Set([...activeAttachmentIds, ...pendingAttachments.map((a) => a.id)]),
    );
    const stagedThisTurn = pendingAttachments;

    const cleanText = text.trim().toLowerCase();
    const isVerificationKeyword = cleanText === "โอเค" || cleanText.startsWith("โอเค") || cleanText === "1234";
    if (isVerificationKeyword) {
      setThinkingStatus("สักครู่ค่ะ");
    } else {
      setThinkingStatus(null);
    }
    setStreamThinking("");
    streamThinkingRef.current = "";
    setThinkingDone(false);
    abortControllerRef.current?.abort();

    let shouldFallThrough = false;
    const settleVisualThinking = () => {
      setSending(false);
      setOrbState("idle");
      setThinkingStatus(null);
    };
    
    // Conversational Privacy Guard flow
    if (pendingVerificationPrompt && !isRetry) {
      try {
        const res = await verifyIdentity(sessionIdRef.current ?? "", text);
        if (res.kind === "verified") {
          const optimisticUser: ChatMessage = {
            id: -Date.now(),
            role: "user",
            content: text,
            actions_json: null,
            status: "active",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, optimisticUser]);
          
          setVerified(true);
          const originalPrompt = pendingVerificationPrompt;
          setPendingVerificationPrompt(null);
          
          // Re-run original prompt, mark as retry to prevent duplicate user bubble
          await doSend(originalPrompt, true);
          return;
        } else if (res.kind === "denied" && res.reason === "locked") {
          const optimisticUser: ChatMessage = {
            id: -Date.now(),
            role: "user",
            content: text,
            actions_json: null,
            status: "active",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, optimisticUser]);
          
          const errorText = "❌ ยืนยันตัวตนไม่สำเร็จหลายครั้ง กรุณารอสักครู่แล้วลองใหม่ค่ะ";
          const failMsg: ChatMessage = fallbackAssistantMessage(errorText);
          setMessages((prev) => [...prev, failMsg]);
          if (!muted) void speak("ลองใหม่อีกครั้งภายหลังค่ะ");
          
          setSending(false);
          setOrbState("idle");
          setPendingVerificationPrompt(null);
          return;
        } else {
          // Wrong PIN or Phrase, but it might be natural language.
          // Fall through to let Claude reply conversationally!
          setPendingVerificationPrompt(null);
          shouldFallThrough = true;
        }
      } catch {
        setPendingVerificationPrompt(null);
        shouldFallThrough = true;
      }
    }

    if (!isRetry) {
      const attachLines = stagedThisTurn.map((a) => `📎 ${a.name}`).join("\n");
      const optimisticUser: ChatMessage = {
        id: -Date.now(),
        role: "user",
        content: attachLines ? `${attachLines}\n${text}` : text,
        actions_json: null,
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticUser]);
    }

    // Step 23 — start the responsive voice ack state machine for this send.
    // Per-message id so a newer send cancels older pending acknowledgements.
    const ackRequestId = nextAckRequestId();
    startAck(ackRequestId, text, muted);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const { result, latencyMs } = await requestChatResult(
        text,
        turnAttachmentIds,
        controller,
      );
      if (controller.signal.aborted) return false;
      setThinkingDone(true);
      // The instant the reply lands, kick off BOTH the history refetch and TTS
      // buffering concurrently. We buffer the spoken line WITHOUT playing it,
      // then reveal the text and start the voice in the same tick so they land
      // together. The result report (if any) is queued AFTER, non-overlapping.
      if (result.verificationRequired) {
        setPendingVerificationPrompt(text);
        
        const updated = await getChatHistory(100);
        const visible = chatVisibleMessages(updated);

        const freshAssistant = [...visible]
          .reverse()
          .find((message) => message.role === "assistant" && !previousIds.has(message.id));

        settleVisualThinking();
        setMessages(visible);

        if (freshAssistant) {
          const reasoning = streamThinkingRef.current.trim();
          if (reasoning) {
            setMessageThinking((prev) => ({ ...prev, [freshAssistant.id]: reasoning }));
          }
          setRevealingMessageIds((prev) => new Set(prev).add(freshAssistant.id));
          setMessageProvider((prev) => ({
            ...prev,
            [freshAssistant.id]: result.provider,
          }));
          setMessageMeta((prev) => ({
            ...prev,
            [freshAssistant.id]: {
              provider: result.provider,
              selectedModel: result.selectedModel ?? null,
              latencyMs,
            },
          }));
          attachJobProgress(freshAssistant.id, result.jobProgress);
          attachSourcePreviews(freshAssistant.id, result.sourcePreviews);
        }

        const speechText = result.spoken ?? result.reply;
        if (!muted && speechText) {
          const speech = prepareSpeech(speechText);
          await speech.ready;
          // Queue the real reply behind any playing ack; cancel pending ones.
          await settleAckForFinal(ackRequestId);
          speech.play();
        } else {
          await settleAckForFinal(ackRequestId);
        }

        return;
      }
      // Turn succeeded: promote staged files to conversation-active so follow-ups
      // keep referencing them, and clear the composer chips.
      if (stagedThisTurn.length > 0) {
        const stagedIds = stagedThisTurn.map((a) => a.id);
        setActiveAttachmentIds((prev) =>
          Array.from(new Set([...prev, ...stagedIds])),
        );
        setPendingAttachments((prev) =>
          prev.filter((a) => !stagedIds.includes(a.id)),
        );
      }
      const historyP = getChatHistory(100);
      const speech = !muted ? prepareSpeech(result.spoken ?? result.reply) : null;
      if (result.approvals.length > 0) {
        mergeApprovals(result.approvals);
        notifyPendingApprovals(result.approvals.length);
      }
      const updated = await historyP;
      const visible = chatVisibleMessages(updated);
      const freshAssistant = [...visible]
        .reverse()
        .find((message) => message.role === "assistant" && !previousIds.has(message.id));
      // Hold the text reveal until the audio is buffered (capped inside
      // prepareSpeech), so text + voice begin together. Fail-soft: muted /
      // disabled / slow TTS resolves fast and text shows anyway.
      if (speech) await speech.ready;
      settleVisualThinking();
      setMessages(visible);
      if (freshAssistant) {
        const reasoning = streamThinkingRef.current.trim();
        if (reasoning) {
          setMessageThinking((prev) => ({ ...prev, [freshAssistant.id]: reasoning }));
        }
        setRevealingMessageIds((prev) => new Set(prev).add(freshAssistant.id));
        // Record which provider answered so the bubble can show it (provider is
        // not persisted server-side, so this is session-scoped).
        setMessageProvider((prev) => ({
          ...prev,
          [freshAssistant.id]: result.provider,
        }));
        setMessageMeta((prev) => ({
          ...prev,
          [freshAssistant.id]: {
            provider: result.provider,
            selectedModel: result.selectedModel ?? null,
            latencyMs,
          },
        }));
        attachJobProgress(freshAssistant.id, result.jobProgress);
        attachSourcePreviews(freshAssistant.id, result.sourcePreviews);
      }
      // Text is already revealed above; gate only the VOICE behind any playing
      // ack so the final answer never overlaps it (and cancel a pending long ack).
      await settleAckForFinal(ackRequestId);
      speech?.play(); // text and voice together (after ack, if one was speaking)
      if (result.resultReport) {
        notify({
          kind: "success",
          title: "ดำเนินการแล้ว",
          description: result.resultReport.replace(/^[✅✔]\s*/, ""),
        });
      }
      if (!muted && result.resultSpoken) void speak(result.resultSpoken);
      // Visual schedule cards (deterministic — never depend on the model's text
      // formatting). Day-agenda takes precedence: "ตารางวันนี้" shows the whole day;
      // "ตารางเรียน" shows the weekly class grid.
      if (isDayAgendaIntent(text)) {
        try {
          setDayAgenda(await buildDayAgendas(resolveAgendaDays(text)));
        } catch {
          // Soft — the text answer still stands.
        }
      } else if (isTimetableViewIntent(text)) {
        try {
          const blocks = await listClassBlocks();
          if (blocks.length > 0) setTimetableBlocks(blocks);
        } catch {
          // Soft — the text answer still stands if blocks can't load.
        }
      }
      // Bulk calendar add → show the review card (nothing on the calendar yet).
      if (result.calendarPlan) setPlanCard(result.calendarPlan);
      const clarification = buildClarificationPrompt(
        visible,
        result.clarification,
        result.clarification_choices,
      );
      setActiveClarification(clarification);
      // Delayed auto follow-up disabled (spec §D): the ~5s proactive nudge was
      // off-topic and interruptive. Inline follow-up now lives in the reply
      // itself (prompt rules). The /api/chat/followup route + scheduleFollowup()
      // remain available but are no longer auto-fired here.
      return true;
    } catch (err) {
      if (controller.signal.aborted) return false;
      // No final answer → stop any pending/playing acknowledgement immediately.
      cancelAck();
      let message = err instanceof ApiError ? err.message : String(err);
      // Phase 4 — Auto mode never switches providers silently. On failure the
      // backend names another available provider; surface it as an explicit
      // retry hint instead of auto-retrying.
      const fallback =
        err instanceof ApiError
          ? (err.details?.fallbackProvider as AiProviderId | null | undefined)
          : undefined;
      if (fallback) {
        const hint = `ลองใหม่ด้วย ${PROVIDER_LABELS[fallback]} ได้ค่ะ`;
        message = `${message} (${hint})`;
      }
      setMessages((prev) => [
        ...prev,
        fallbackAssistantMessage(message),
      ]);
      setSendError(message);
      setChatErrorRendered(true);
      setLastFailedMessage(text);
      notify({
        kind: "error",
        title: "ส่งข้อความไม่สำเร็จ",
        description: message,
      });
      return false;
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setSending(false);
      setOrbState("idle");
      setThinkingStatus(null);
    }
  }

  // Attach an image/PDF: STAGE it in the composer — it is NOT sent yet. The user
  // types a prompt and hits send; the file then rides along with that chat turn
  // (see doSend). Turning a file into a class timetable is a separate explicit
  // action (onMakeTimetable). A failure surfaces as a toast, never silently.
  async function onAttach(file: File) {
    if (attachBusy || sending) return;
    clearFollowup();
    setAttachBusy(true);
    setSendError(null);
    try {
      const uploaded = await uploadScheduleFile(file);
      setPendingAttachments((prev) => [
        ...prev,
        { id: uploaded.id, name: file.name, kind: uploaded.kind },
      ]);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      notify({ kind: "error", title: "แนบไฟล์ไม่สำเร็จ", description: message });
    } finally {
      setAttachBusy(false);
    }
  }

  /** Remove a staged (not-yet-sent) attachment from the composer. */
  function onRemoveAttachment(id: string) {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  // Explicit "make a class timetable from this file" — the ONLY path into the
  // schedule-import review card now. Consumes the staged file (the import owns the
  // upload). A non-timetable file yields zero items and a gentle note instead.
  async function onMakeTimetable(att: StagedAttachment) {
    if (attachBusy || sending) return;
    clearFollowup();
    setAttachBusy(true);
    setImportCard(null);
    setTimetableBlocks(null);
    setDayAgenda(null);
    setSendError(null);
    setPendingAttachments((prev) => prev.filter((a) => a.id !== att.id));
    stickToBottomRef.current = true;
    try {
      const result = await createScheduleImport(att.id);
      if (result.items.length === 0) {
        setMessages((prev) => [
          ...prev,
          fallbackAssistantMessage(
            "ไฟล์นี้ยังอ่านเป็นตารางเรียนไม่ได้ค่ะ ลองรูปที่ชัดขึ้นหรือ PDF ตารางโดยตรง",
          ),
        ]);
        return;
      }
      setImportCard(result);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      setMessages((prev) => [...prev, fallbackAssistantMessage(`อ่านตารางไม่สำเร็จ: ${message}`)]);
      notify({ kind: "error", title: "อ่านตารางไม่สำเร็จ", description: message });
    } finally {
      setAttachBusy(false);
    }
  }

  function onImportApproved(result: ApproveImportResult) {
    setImportCard(null);
    const n = result.created.length;
    notify({
      kind: "success",
      title: "เพิ่มตารางเรียนแล้ว",
      description: `บันทึก ${n} คาบเข้าตารางในเครื่อง`,
    });
    setMessages((prev) => [
      ...prev,
      fallbackAssistantMessage(
        `เพิ่มตารางเรียนให้แล้ว ${n} คาบ ${result.skipped.length > 0 ? `(ข้าม ${result.skipped.length} คาบที่ข้อมูลไม่ครบ) ` : ""}— ถามได้เลยว่าวันไหนเรียนอะไร หรือให้หาเวลาว่างก็ได้ค่ะ`,
      ),
    ]);
  }

  // The calendar-plan card finished creating events. Post a TRUTHFUL outcome
  // line into the chat — created / skipped-due-to-conflict / failed are all named
  // so a clashing event the user did not confirm is NEVER silently lost.
  function onPlanResolved(result: ApproveCalendarPlanResult) {
    setPlanCard(null);
    const parts = [`เพิ่มลงปฏิทินแล้ว ${result.created.length} รายการ`];
    if (result.skippedConflict.length > 0) {
      const names = result.skippedConflict
        .map((s) => s.title + (s.conflict_with ? ` (ทับ ${s.conflict_with})` : ""))
        .join(", ");
      parts.push(`ข้าม ${result.skippedConflict.length} รายการที่เวลาทับและยังไม่ได้ยืนยันสร้างทับ: ${names}`);
    }
    if (result.failed.length > 0) {
      parts.push(`ล้มเหลว ${result.failed.length} รายการ: ${result.failed.map((f) => f.title).join(", ")}`);
    }
    notify({
      kind: result.failed.length > 0 ? "error" : "success",
      title: "อัปเดตปฏิทินแล้ว",
      description: `สร้าง ${result.created.length} รายการ`,
    });
    setMessages((prev) => [...prev, fallbackAssistantMessage(parts.join(" · "))]);
  }

  // User dismissed the plan card without creating anything ("ไม่เอาเลย").
  async function onPlanDiscard(planId: number) {
    setPlanCard(null);
    try {
      await discardCalendarPlan(planId);
    } catch {
      // Soft — the card is already gone from the UI.
    }
  }

  async function runBrief(type: BriefType) {
    if (sending || briefBusy) return;
    clearFollowup();
    setOrbState("thinking");
    setBriefBusy(type);
    setSendError(null);
    setChatErrorRendered(false);
    setLastFailedMessage(null);
    setActiveClarification(null);

    try {
      const result =
        type === "daily"
          ? await generateDailyBrief()
          : await generateEveningBrief();
      if (result.approvals.length > 0) {
        mergeApprovals(result.approvals);
        notifyPendingApprovals(result.approvals.length);
    }
    const message = briefToMessage(result);
    setMessages((prev) => [...prev, message]);
    setRevealingMessageIds((prev) => new Set(prev).add(message.id));
  } catch (err) {
    setSendError(err instanceof ApiError ? err.message : String(err));
    notify({
      kind: "error",
        title: "สร้าง brief ไม่สำเร็จ",
        description: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setBriefBusy(null);
      setOrbState("idle");
    }
  }

  function mergeApprovals(approvals: Approval[]) {
    setApprovalMap((prev) => ({ ...prev, ...indexApprovals(approvals) }));
  }

  function notifyPendingApprovals(count: number) {
    notify({
      kind: "warning",
      title: "มีงานรอ approve",
      description: `${count} รายการพร้อมให้ตรวจและตัดสินใจ`,
    });
  }

  async function runApproval(
    id: number,
    decision: "approve" | "reject",
  ): Promise<boolean> {
    if (approvalBusy) return false;
    clearFollowup();
    setApprovalBusy(id);
    setSendError(null);
    setChatErrorRendered(false);
    try {
      const updated =
        decision === "approve"
          ? await approveApproval(id)
          : await rejectApproval(id);
      mergeApprovals([updated]);
      notify({
        kind: decision === "approve" ? "success" : "info",
        title: decision === "approve" ? "อนุมัติแล้ว" : "ปฏิเสธแล้ว",
        description:
          decision === "approve"
            ? "ดำเนินการที่อนุมัติแล้ว"
            : "ยกเลิกงานที่รออนุมัติแล้ว",
      });
      return true;
    } catch (err) {
      try {
        mergeApprovals(await listApprovals());
      } catch {
        // Keep the original approval error visible if refresh also fails.
      }
      setSendError(err instanceof ApiError ? err.message : String(err));
      notify({
        kind: "error",
        title: "ทำรายการไม่สำเร็จ",
        description: err instanceof ApiError ? err.message : String(err),
      });
      return false;
    } finally {
      setApprovalBusy(null);
    }
  }

  async function onRetry() {
    if (!lastFailedMessage || sending) return;
    await doSend(lastFailedMessage);
  }

  function requestNewSession() {
    if (sending || briefBusy || resetting) return;
    setConfirmingReset(true);
  }

  async function confirmNewSession() {
    if (sending || briefBusy || resetting) return;
    clearFollowup();
    abortControllerRef.current?.abort();
    setResetting(true);
    try {
      await resetChat(sessionIdRef.current ?? undefined);
      setMessages([]);
      setMessageProvider({});
      setMessageMeta({});
      setMessageSourcePreviews({});
      setMessageJobProgress({});
      setActiveAttachmentIds([]);
      setPendingAttachments([]);
      setImportCard(null);
      setPlanCard(null);
      setStreamThinking("");
      setThinkingDone(false);
      setSendError(null);
      setChatErrorRendered(false);
      setActiveClarification(null);
      setConfirmingReset(false);
      setVerified(false);
      setPendingVerificationPrompt(null);
      notify({
        kind: "success",
        title: "เริ่มบทสนทนาใหม่",
        description: "เริ่มบทสนทนาใหม่แล้ว",
      });
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : String(err));
      notify({
        kind: "error",
        title: "เริ่ม session ใหม่ไม่สำเร็จ",
        description: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className={`jarvis-home ${hasConversation ? "has-conversation" : ""}`}>
      <div className="jarvis-stage">
        {!hasConversation && !loading && (
          <div className="jarvis-welcome">
            <Orb state={orbState} />

            <motion.div
              className="jarvis-greeting"
              initial={reduceMotion ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 70, damping: 18, delay: 0.15 }
              }
            >
              <h1
                className={`rt-line${greeting ? "" : " pending"}`}
                style={{ animationDelay: "150ms" }}
              >
                {greeting ?? "สวัสดี"} คุณ Fran
              </h1>
              <p className="rt-line" style={{ animationDelay: "230ms" }}>
                วันนี้ให้ Friday ช่วยอะไรดีคะ
              </p>
              <WelcomeAgenda
                onPrompt={(text) => {
                  void doSend(text);
                }}
                disabled={sending || briefBusy !== null}
              />
            </motion.div>
          </div>
        )}

        <div className="chat-layout home-chat">
          <div className="chat-messages">
            {loading && <ChatSkeleton />}
            {loadError && (
              <ErrorBanner message={loadError} onRetry={() => window.location.reload()} />
            )}

            {groupMessages(messages).map((group) => (
              <ChatMessageGroup
                key={group.key}
                group={group}
                isCoarsePointer={isCoarsePointer}
                reduceMotion={reduceMotion}
                messageProvider={messageProvider}
                messageMeta={messageMeta}
                messageThinking={messageThinking}
                messageJobProgress={messageJobProgress}
                messageSourcePreviews={messageSourcePreviews}
                approvalMap={approvalMap}
                approvalBusy={approvalBusy}
                revealingMessageIds={revealingMessageIds}
                onRevealDone={(id) =>
                  setRevealingMessageIds((prev) => {
                    if (!prev.has(id)) return prev;
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                  })
                }
                onApproval={runApproval}
                onRequestReject={(id, question, rejectLabel) =>
                  setPendingRejectAction({ id, question, rejectLabel })
                }
                activeClarification={activeClarification}
                onClarificationChoice={doSend}
                onClarificationSkip={() => setActiveClarification(null)}
                onRegenerate={regenerateFromAssistant}
              />
            ))}

            {attachBusy && (
              <div className="chat-bubble-wrapper assistant">
                <AssistantOrbAvatar thinking />
                <div className="chat-bubble assistant typing">
                  <ThinkingContent status="กำลังเตรียมไฟล์" />
                </div>
              </div>
            )}

            {importCard && (
              <div className="chat-bubble-wrapper assistant">
                <AssistantOrbAvatar />
                <div className="chat-import-slot">
                  <ScheduleImportCard
                    importId={importCard.import.id}
                    sourceKind={importCard.import.source_kind}
                    initialItems={importCard.items}
                    initialTermFrom={importCard.import.term_from}
                    initialTermUntil={importCard.import.term_until}
                    note={importCard.import.note}
                    onApproved={onImportApproved}
                    onCancel={() => setImportCard(null)}
                  />
                </div>
              </div>
            )}

            {planCard && (
              <div className="chat-bubble-wrapper assistant">
                <AssistantOrbAvatar />
                <div className="chat-import-slot">
                  <CalendarPlanCard
                    planId={planCard.plan.id}
                    initialItems={planCard.items}
                    note={planCard.plan.note}
                    onResolved={onPlanResolved}
                    onDiscard={() => onPlanDiscard(planCard.plan.id)}
                  />
                </div>
              </div>
            )}

            {timetableBlocks && (
              <div className="chat-bubble-wrapper assistant">
                <AssistantOrbAvatar />
                <div className="chat-import-slot">
                  <div className="si-card">
                    <div className="si-head-title">
                      <CalendarDays aria-hidden="true" />
                      <span>ตารางเรียนของคุณ</span>
                    </div>
                    <WeekHourGrid
                      blocks={timetableBlocks.map<GridBlock>((b) => ({
                        id: b.id,
                        weekday: b.weekday,
                        startMin: hhmmToMin(b.start_local),
                        endMin: hhmmToMin(b.end_local),
                        title: b.subject,
                        subtitle: b.location,
                      }))}
                      highlightWeekday={new Date(
                        new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }),
                      ).getDay()}
                    />
                  </div>
                </div>
              </div>
            )}

            {dayAgenda && dayAgenda.length > 0 && (
              <div className="chat-bubble-wrapper assistant">
                <AssistantOrbAvatar />
                <div className="chat-import-slot chat-day-stack">
                  {dayAgenda.map((day) => (
                    <DayAgendaCard key={day.dateLabel} dateLabel={day.dateLabel} items={day.items} />
                  ))}
                </div>
              </div>
            )}

            {/* Live thinking: a COMPACT fixed-size indicator only. We no longer
                stream the growing reasoning here — an expanding bubble during
                thinking caused the viewport to jump on every token. The full
                reasoning is still accumulated (streamThinking) and attaches to
                the reply bubble afterward as the expandable in-bubble CoT, so
                the page scrolls exactly once, when the answer lands. */}
            {sending && (
              <div className="chat-bubble-wrapper assistant">
                <AssistantOrbAvatar thinking />
                <div className="chat-import-slot">
                  <div className="chat-bubble assistant typing">
                    <ThinkingContent status={thinkingStatus} />
                  </div>
                </div>
              </div>
            )}

            {/* Persisted CoT no longer floats as its own orphan bubble. Once the
                turn lands, the accumulated reasoning attaches to the assistant
                message bubble itself (messageThinking) as a collapsed, expandable
                panel — seamless with the reply instead of a leftover box. */}

            {briefBusy && (
              <div className="chat-bubble-wrapper assistant">
                <AssistantOrbAvatar thinking />
                <div className="chat-bubble assistant typing">
                  <ThinkingContent
                    status={`กำลังสร้าง${briefBusy === "daily" ? "สรุปเช้า" : "สรุปเย็น"}`}
                  />
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {sendError && !chatErrorRendered && (
            <ErrorBanner message={sendError} onRetry={onRetry} />
          )}
          {showScrollBottom && (
            <button
              type="button"
              className="scroll-bottom-btn"
              onClick={scrollToLatest}
              aria-label="เลื่อนไปข้อความล่าสุด"
            >
              <ArrowDown aria-hidden="true" strokeWidth={2} />
              <span>ล่าสุด</span>
            </button>
          )}
        </div>
      </div>

      <motion.div
        className="jarvis-input-dock"
        initial={reduceMotion ? false : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: "spring", stiffness: 70, damping: 18, delay: 0.3 }
        }
      >
        <JarvisInput
          onSubmit={(text) => {
            void doSend(text);
          }}
          onBrief={runBrief}
          onAttach={onAttach}
          attachments={pendingAttachments}
          onRemoveAttachment={onRemoveAttachment}
          onMakeTimetable={onMakeTimetable}
          attachBusy={attachBusy}
          disabled={sending || briefBusy !== null}
          sending={sending}
          onStop={stopStreaming}
          briefBusy={briefBusy}
          provider={provider}
          onProviderChange={setProvider}
          geminiModel={geminiModel}
          onGeminiModelChange={(model) => {
            setGeminiModel(model);
            localStorage.setItem("jarvis.geminiModel", model);
          }}
          onFocusChange={() =>
            setOrbState((s) => (s === "thinking" ? s : "idle"))
          }
          muted={muted}
          onToggleMute={() =>
            setMuted((prev) => {
              const next = !prev;
              localStorage.setItem("jarvis.muted", String(next));
              return next;
            })
          }
        />
      </motion.div>

      {confirmingReset && (
        <SessionConfirmDialog
          busy={resetting}
          onCancel={() => setConfirmingReset(false)}
          onConfirm={confirmNewSession}
        />
      )}
      <ConfirmDialog
        open={pendingRejectAction !== null}
        onCancel={() => setPendingRejectAction(null)}
        onConfirm={async () => {
          if (!pendingRejectAction) return;
          const ok = await runApproval(pendingRejectAction.id, "reject");
          if (ok) setPendingRejectAction(null);
        }}
        busy={
          pendingRejectAction !== null &&
          approvalBusy === pendingRejectAction.id
        }
        title="ไม่อนุมัติรายการนี้?"
        description={pendingRejectAction?.question}
        confirmLabel={pendingRejectAction?.rejectLabel ?? "ปฏิเสธ"}
        confirmVariant="danger"
      >
        <p className="muted u-text-sm">
          Friday จะไม่ดำเนินการรายการนี้จนกว่าจะมีการเสนอใหม่
        </p>
      </ConfirmDialog>
    </div>
  );
}

function buildClarificationPrompt(
  messages: ChatMessage[],
  question?: string,
  choices?: string[],
): ClarificationPrompt | null {
  if (!question) return null;
  const assistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (!assistant) return null;
  return {
    messageId: assistant.id,
    question,
    choices: (choices ?? []).slice(0, 4),
  };
}

function isActionResultMessage(message: ChatMessage): boolean {
  if (message.role !== "assistant" || message.actions_json) return false;
  const content = message.content.replace(/\s+/g, " ").trim();
  return (
    /^[✅✔]/.test(content) &&
    (content.includes("เรียบร้อย") ||
      content.includes("จัดการให้แล้ว") ||
      content.includes("ดำเนินการสำเร็จ"))
  );
}

function chatVisibleMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => !isActionResultMessage(message));
}

function fallbackAssistantMessage(content: string): ChatMessage {
  const now = new Date().toISOString();
  return {
    id: -Date.now() - 1,
    role: "assistant",
    content,
    actions_json: null,
    status: "active",
    created_at: now,
    updated_at: now,
  };
}

function SessionConfirmDialog({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (busy) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  return (
    <div
      className="jarvis-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className="jarvis-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-dialog-title"
        aria-describedby="session-dialog-desc"
      >
        <div className="jarvis-dialog-orb" aria-hidden="true" />
        <div className="jarvis-dialog-copy">
          <p className="page-kicker">บทสนทนา</p>
          <h3 id="session-dialog-title">เริ่มบทสนทนาใหม่?</h3>
          <p id="session-dialog-desc">
            บทสนทนาปัจจุบันจะถูกเก็บเข้าคลัง ข้อความยังอยู่ในฐานข้อมูล
            แต่จะไม่แสดงในแชตนี้และจะไม่ถูกส่งให้ Claude
          </p>
        </div>
        <div className="jarvis-dialog-actions">
          <Button variant="secondary" onClick={onCancel} disabled={busy} autoFocus>
            ยกเลิก
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy} loading={busy}>
            เริ่มใหม่
          </Button>
        </div>
      </section>
    </div>
  );
}

function briefToMessage(result: BriefResult): ChatMessage {
  const label = result.type === "daily" ? "สรุปเช้า" : "สรุปเย็น";
  const now = new Date().toISOString();
  const notes = result.notes ? `\n\nหมายเหตุ: ${result.notes}` : "";

  return {
    id: -Date.now(),
    role: "assistant",
    content: `${label}\n\n${result.summary}${notes}`,
    actions_json:
      result.approvals.length > 0 ? JSON.stringify(result.approvals) : null,
    status: "active",
    created_at: now,
    updated_at: now,
  };
}

function ChatSkeleton() {
  return (
    <>
      {[
        { role: "assistant", lines: [70, 55] },
        { role: "user", lines: [45] },
        { role: "assistant", lines: [65, 40] },
      ].map((item, i) => (
        <div className={`chat-bubble ${item.role}`} key={i}>
          <div className="chat-bubble-header">
            <span className="skel" style={{ width: item.role === "user" ? 30 : 40, height: 13 }} />
            <span className="skel" style={{ width: 58, height: 11 }} />
          </div>
          {item.lines.map((w, j) => (
            <span
              key={j}
              className="skel"
              style={{ display: "block", width: `${w}%`, height: 14, marginTop: j ? 6 : 0 }}
            />
          ))}
        </div>
      ))}
    </>
  );
}

/**
 * Honest, generic phases shown while Jarvis is working. These describe the
 * real request lifecycle (thinking → processing → composing) — never fabricated
 * specifics like "checking your calendar" that may not be happening.
 */
const THINKING_PHASES = [
  "สักครู่ค่ะ",
  "กำลังเรียบเรียงคำตอบ",
  "กำลังตรวจรายละเอียด",
  "กำลังจัดคำตอบให้อ่านง่าย",
  "กำลังเชื่อมโยงข้อมูลที่เกี่ยวข้อง",
  "กำลังเลือกคำตอบที่เหมาะที่สุด",
  "กำลังกลั่นให้กระชับ",
  "กำลังเตรียมคำตอบให้คุณ",
];

function formatChatTs(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const now = new Date();
  const dateKey = new Intl.DateTimeFormat("en-CA").format(date);
  const todayKey = new Intl.DateTimeFormat("en-CA").format(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = new Intl.DateTimeFormat("en-CA").format(yesterday);
  const time = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  if (dateKey === todayKey) return `วันนี้ ${time}`;
  if (dateKey === yesterdayKey) return `เมื่อวาน ${time}`;

  const dayMonth = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    day: "numeric",
    month: "short",
  }).format(date);
  if (date.getFullYear() === now.getFullYear()) return `${dayMonth} ${time}`;

  const withYear = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  return `${withYear} ${time}`;
}

function AssistantOrbAvatar({
  thinking = false,
}: {
  thinking?: boolean;
}) {
  return (
    <div className="chat-avatar assistant-avatar" aria-hidden="true">
      <Orb state={thinking ? "thinking" : "idle"} variant="avatar" />
    </div>
  );
}

function ThinkingContent({
  status,
}: {
  status?: string | null;
}) {
  const [phase, setPhase] = useState(0);

  // Cycle the generic phases only when no explicit (truthful) status is given.
  useEffect(() => {
    if (status) return;
    const timer = window.setInterval(
      () => setPhase((current) => (current + 1) % THINKING_PHASES.length),
      4200,
    );
    return () => window.clearInterval(timer);
  }, [status]);

  const label = status ?? THINKING_PHASES[phase];

  return (
    <div className="thinking-content" aria-live="polite">
      <div className="thinking-line">
        <span className="thinking-label" key={label}>
          {label}
        </span>
      </div>
    </div>
  );
}

function TypingSkeleton() {
  return (
    <div className="typing-skeleton" aria-hidden="true">
      <span />
      <span />
    </div>
  );
}

interface ChatGroup {
  key: string;
  role: ChatMessage["role"];
  messages: ChatMessage[];
}

function groupMessages(messages: ChatMessage[]): ChatGroup[] {
  const groups: ChatGroup[] = [];
  for (const message of messages) {
    const previous = groups[groups.length - 1];
    const lastMessage = previous?.messages[previous.messages.length - 1];
    const closeInTime =
      lastMessage &&
      Math.abs(
        new Date(message.created_at).getTime() -
          new Date(lastMessage.created_at).getTime(),
      ) <= 5 * 60 * 1000;

    if (previous && previous.role === message.role && closeInTime) {
      previous.messages.push(message);
    } else {
      groups.push({
        key: `${message.role}-${message.id}`,
        role: message.role,
        messages: [message],
      });
    }
  }
  return groups;
}

function ChatMessageGroup({
  group,
  isCoarsePointer,
  reduceMotion,
  messageProvider,
  messageMeta,
  messageThinking,
  messageJobProgress,
  messageSourcePreviews,
  approvalMap,
  approvalBusy,
  revealingMessageIds,
  onRevealDone,
  onApproval,
  onRequestReject,
  activeClarification,
  onClarificationChoice,
  onClarificationSkip,
  onRegenerate,
}: {
  group: ChatGroup;
  isCoarsePointer: boolean;
  reduceMotion: boolean;
  messageProvider: Record<number, AiProviderId>;
  messageMeta: Record<number, MessageMeta>;
  messageThinking: Record<number, string>;
  messageJobProgress: Record<number, ActiveJobProgress[]>;
  messageSourcePreviews: Record<number, ChatSourcePreview[]>;
  approvalMap: ApprovalMap;
  approvalBusy: number | null;
  revealingMessageIds: Set<number>;
  onRevealDone: (id: number) => void;
  onApproval: (id: number, decision: "approve" | "reject") => void;
  onRequestReject: (
    id: number,
    question: string,
    rejectLabel: string,
  ) => void;
  activeClarification: ClarificationPrompt | null;
  onClarificationChoice: (text: string) => void;
  onClarificationSkip: () => void;
  onRegenerate: (assistantId: number) => void;
}) {
  const isUser = group.role === "user";
  const first = group.messages[0];
  const groupSources = mergeSourceHints(
    group.messages.flatMap((message) =>
      inferSourceHints(
        message,
        parseActions(message.actions_json),
        messageSourcePreviews[message.id],
      ),
    ),
  );
  return (
    <section className={`chat-group ${isUser ? "user" : "assistant"}`}>
      <div className="chat-group-header">
        <span className="chat-role">{isUser ? "คุณ" : "Friday"}</span>
        <span className="ts">{formatChatTs(first.created_at)}</span>
        {!isUser && <SourceHintList hints={groupSources} />}
      </div>
      <div className="chat-group-stack">
        {group.messages.map((msg, index) => (
          <ChatBubble
            key={msg.id}
            msg={msg}
            groupedIndex={index}
            isCoarsePointer={isCoarsePointer}
            reduceMotion={reduceMotion}
            approvalMap={approvalMap}
            meta={messageMeta[msg.id]}
            thinking={messageThinking[msg.id]}
            jobProgress={messageJobProgress[msg.id]}
            sourcePreviews={messageSourcePreviews[msg.id]}
            approvalBusy={approvalBusy}
            revealing={revealingMessageIds.has(msg.id)}
            onRevealDone={onRevealDone}
            onApproval={onApproval}
            onRequestReject={onRequestReject}
            clarification={
              activeClarification?.messageId === msg.id
                ? activeClarification
                : null
            }
            onClarificationChoice={onClarificationChoice}
            onClarificationSkip={onClarificationSkip}
            onRegenerate={onRegenerate}
          />
        ))}
      </div>
    </section>
  );
}

// Chain-of-thought disclosure: a quiet control above the assistant bubble,
// Claude-style. The reasoning panel opens below that control but above the
// answer, so it does not become another message card.
function BubbleThinking({
  text,
  reduceMotion,
  open,
}: {
  text: string;
  reduceMotion: boolean;
  open: boolean;
}) {
  return (
    <div className="chat-bubble-cot">
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="chat-bubble-cot-body"
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={
              reduceMotion
                ? { opacity: 1, height: "auto" }
                : { opacity: 0, height: 0 }
            }
            transition={reduceMotion ? { duration: 0 } : { duration: 0.18 }}
          >
            <div className="chat-bubble-cot-text">{text}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const INLINE_JOB_WINDOW_MS = 30 * 60 * 1000;

const ACTIVE_JOB_STATUS_LABELS: Record<ActiveJobProgress["status"], string> = {
  queued: "รอเริ่ม",
  understanding: "กำลังทำความเข้าใจ",
  searching: "กำลังค้นหา",
  verifying: "กำลังตรวจสอบ",
  needs_user: "รอคำตอบจากคุณ",
  reporting: "กำลังสรุป",
  done: "เสร็จแล้ว",
  failed: "ไม่สำเร็จ",
  cancelled: "ยกเลิกแล้ว",
};

const TERMINAL_JOB_STATUSES = new Set<ActiveJobProgress["status"]>([
  "done",
  "failed",
  "cancelled",
]);

function compactChatJobProgress(
  jobs: ActiveJobProgress[] | undefined,
): ActiveJobProgress[] {
  if (!jobs || jobs.length === 0) return [];
  const now = Date.now();
  return jobs
    .filter((job) => {
      if (!TERMINAL_JOB_STATUSES.has(job.status)) return true;
      const updated = new Date(job.updated_at).getTime();
      return Number.isFinite(updated) && now - updated <= INLINE_JOB_WINDOW_MS;
    })
    .slice(0, 3);
}

function SourcePreviewPanel({ previews }: { previews: ChatSourcePreview[] }) {
  return (
    <div className="chat-source-previews" aria-label="หลักฐานจาก Gmail และ Drive">
      {previews.map((preview) => {
        const Icon = preview.kind === "gmail" ? Mail : Folder;
        const title = preview.kind === "gmail" ? "Gmail ที่อ่านเจอ" : "ไฟล์ Drive ที่อ่านเจอ";
        return (
          <section className={`chat-source-preview ${preview.kind}`} key={preview.kind}>
            <div className="chat-source-preview-head">
              <span className="chat-source-preview-icon" aria-hidden="true">
                <Icon strokeWidth={1.8} />
              </span>
              <div>
                <strong>{title}</strong>
                <span>{preview.query}</span>
              </div>
              <span className="chat-source-preview-count">
                {preview.items.length} รายการ
              </span>
            </div>
            <div className="chat-source-preview-list">
              {preview.kind === "gmail"
                ? preview.items.map((item) => (
                    <article className="chat-source-item gmail" key={item.id}>
                      <div className="chat-source-item-top">
                        <strong>{item.subject || "(ไม่มีหัวข้อ)"}</strong>
                        <span>{formatChatTs(item.receivedAt)}</span>
                      </div>
                      <div className="chat-source-item-meta">{formatMailSender(item.from)}</div>
                      {item.preview && <p>{item.preview}</p>}
                      {item.truncated && <span className="chat-source-note">ตัดให้สั้น</span>}
                    </article>
                  ))
                : preview.items.map((item) => (
                    <article className="chat-source-item drive" key={item.id}>
                      <div className="chat-source-item-top">
                        <span className="chat-source-file-icon" aria-hidden="true">
                          {item.mimeType.includes("folder") ? (
                            <Folder strokeWidth={1.8} />
                          ) : (
                            <FileText strokeWidth={1.8} />
                          )}
                        </span>
                        <strong>{item.name}</strong>
                        {item.webViewLink && (
                          <a
                            href={item.webViewLink}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`เปิด ${item.name} ใน Google Drive`}
                          >
                            <ExternalLink aria-hidden="true" strokeWidth={1.8} />
                          </a>
                        )}
                      </div>
                      <div className="chat-source-item-meta">
                        {driveMimeLabel(item.mimeType)}
                        {!item.readable ? " · อ่านเนื้อหาจากตรงนี้ไม่ได้" : ""}
                      </div>
                      {item.preview && <p>{item.preview}</p>}
                      {item.childNames && item.childNames.length > 0 && (
                        <p>มีไฟล์: {item.childNames.join(", ")}</p>
                      )}
                      {item.truncated && <span className="chat-source-note">ตัดให้สั้น</span>}
                    </article>
                  ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function formatMailSender(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*<?[^>]*>?$/);
  return match?.[1]?.trim() || from || "ไม่ทราบผู้ส่ง";
}

function driveMimeLabel(mimeType: string): string {
  if (mimeType.includes("google-apps.folder")) return "โฟลเดอร์";
  if (mimeType.includes("google-apps.document")) return "Google Docs";
  if (mimeType.includes("google-apps.spreadsheet")) return "Google Sheets";
  if (mimeType.includes("google-apps.presentation")) return "Google Slides";
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.startsWith("text/")) return "Text";
  return mimeType.replace("application/vnd.google-apps.", "").replace("application/", "");
}

function JobProgressInline({ jobs }: { jobs: ActiveJobProgress[] }) {
  const [selectedJob, setSelectedJob] = useState<ActiveJobProgress | null>(null);

  return (
    <div className="chat-job-progress" aria-label="ความคืบหน้างาน">
      <div className="chat-job-progress-head">
        <span>งานที่ Friday กำลังติดตาม</span>
        <span>{jobs.length} รายการ</span>
      </div>
      <div className="chat-job-list">
        {jobs.map((job) => {
          const latest = latestJobMilestone(job);
          return (
            <div className="chat-job-row" key={job.job_id}>
              <div className="chat-job-row-main">
                <span className={`chat-job-status ${job.status}`}>
                  {ACTIVE_JOB_STATUS_LABELS[job.status]}
                </span>
                <strong>{job.title}</strong>
                <span>{latest?.message ?? job.result_summary ?? job.error ?? "ยังไม่มีความคืบหน้าใหม่"}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedJob(job)}
              >
                รายละเอียด
              </Button>
            </div>
          );
        })}
      </div>
      <Sheet
        open={selectedJob !== null}
        onClose={() => setSelectedJob(null)}
        side="right"
        size="md"
        title="รายละเอียดงาน"
        className="active-work-sheet"
      >
        {selectedJob && <ActiveJobDetail job={selectedJob} />}
      </Sheet>
    </div>
  );
}

function ActiveJobDetail({
  job,
}: {
  job: ActiveJobProgress;
}) {
  const evidenceRows = buildEvidenceRows(job);
  return (
    <div className="active-work-detail">
      <div className="active-work-summary">
        <span className={`chat-job-status ${job.status}`}>
          {ACTIVE_JOB_STATUS_LABELS[job.status]}
        </span>
        <h3>{job.title}</h3>
        <p>{job.result_summary ?? job.error ?? latestJobMilestone(job)?.message ?? "ยังไม่มีรายงานสุดท้าย"}</p>
      </div>

      <section className="active-work-section">
        <h4>ความคืบหน้า</h4>
        {job.milestones.length === 0 ? (
          <p className="active-work-empty">ยังไม่มี milestone</p>
        ) : (
          <ol className="active-work-events">
            {job.milestones.map((event) => (
              <li key={event.id}>
                <span>{formatChatTs(event.created_at)}</span>
                <strong>{ACTIVE_JOB_STATUS_LABELS[event.status]}</strong>
                <p>{event.message}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="active-work-section">
        <h4>หลักฐานและแหล่งข้อมูล</h4>
        {evidenceRows.length === 0 ? (
          <p className="active-work-empty">ยังไม่มี metadata หลักฐาน</p>
        ) : (
          <dl className="active-work-evidence">
            {evidenceRows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}

function latestJobMilestone(
  job: ActiveJobProgress,
): ActiveJobProgress["milestones"][number] | undefined {
  return job.milestones[job.milestones.length - 1];
}

function buildEvidenceRows(job: ActiveJobProgress): { label: string; value: string }[] {
  const evidence = asJobRecord(job.evidence);
  const source = stringFromUnknown(evidence?.source) ?? job.source;
  const sourceRef = stringFromUnknown(evidence?.source_ref) ?? job.source_ref;
  const fetchedAt = stringFromUnknown(evidence?.fetched_at);
  const newestAt = stringFromUnknown(evidence?.newest_at);
  const confidence = stringFromUnknown(evidence?.confidence);
  const count = numberFromUnknown(evidence?.count);
  const limitations = stringArrayFromUnknown(evidence?.limitations);
  const caveats = [
    boolFromUnknown(evidence?.stale) ? "ข้อมูลอาจเก่า" : null,
    boolFromUnknown(evidence?.capped) ? "ถูกตัดให้สั้น" : null,
    boolFromUnknown(evidence?.partial) ? "หลักฐานบางส่วน" : null,
  ].filter((item): item is string => Boolean(item));

  return [
    source ? { label: "แหล่งข้อมูล", value: source } : null,
    sourceRef ? { label: "อ้างอิง", value: sourceRef } : null,
    fetchedAt ? { label: "ดึงข้อมูลเมื่อ", value: formatChatTs(fetchedAt) } : null,
    newestAt ? { label: "ข้อมูลล่าสุด", value: formatChatTs(newestAt) } : null,
    typeof count === "number" ? { label: "จำนวนหลักฐาน", value: String(count) } : null,
    confidence ? { label: "ความมั่นใจ", value: confidence } : null,
    caveats.length > 0 ? { label: "ข้อจำกัด", value: caveats.join(", ") } : null,
    limitations.length > 0 ? { label: "หมายเหตุ", value: limitations.join(", ") } : null,
  ].filter((row): row is { label: string; value: string } => row !== null);
}

function asJobRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberFromUnknown(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolFromUnknown(value: unknown): boolean {
  return value === true;
}

function stringArrayFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function ChatBubble({
  msg,
  groupedIndex,
  isCoarsePointer,
  reduceMotion,
  meta,
  thinking,
  jobProgress,
  sourcePreviews,
  approvalMap,
  approvalBusy,
  revealing,
  onRevealDone,
  onApproval,
  onRequestReject,
  clarification,
  onClarificationChoice,
  onClarificationSkip,
  onRegenerate,
}: {
  msg: ChatMessage;
  groupedIndex: number;
  isCoarsePointer: boolean;
  reduceMotion: boolean;
  meta?: MessageMeta;
  thinking?: string;
  jobProgress?: ActiveJobProgress[];
  sourcePreviews?: ChatSourcePreview[];
  approvalMap: ApprovalMap;
  approvalBusy: number | null;
  revealing: boolean;
  onRevealDone: (id: number) => void;
  onApproval: (id: number, decision: "approve" | "reject") => void;
  onRequestReject: (
    id: number,
    question: string,
    rejectLabel: string,
  ) => void;
  clarification: ClarificationPrompt | null;
  onClarificationChoice: (text: string) => void;
  onClarificationSkip: () => void;
  onRegenerate: (assistantId: number) => void;
}) {
  const isUser = msg.role === "user";
  const [copied, setCopied] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  // Show approval cards ONLY for items still awaiting the user's explicit
  // confirmation. Anything Jarvis already handled itself (auto-executed →
  // approved, or rejected) is hidden — no noisy "done" cards. A failed
  // auto-exec stays `pending`, so it correctly remains visible for retry.
  const actions = parseActions(msg.actions_json).filter((action) => {
    const approval = approvalMap[action.id];
    return !approval || approval.status === "pending";
  });

  useEffect(
    () => () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
    },
    [],
  );

  function clearLongPress() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }

  async function copyMessage(closeSheet: unknown = false) {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      if (closeSheet === true) setMobileActionsOpen(false);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  function handleBubblePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (isUser || !isCoarsePointer || event.pointerType !== "touch") return;
    if (isInteractiveTarget(event.target)) return;
    clearLongPress();
    longPressStartRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      setMobileActionsOpen(true);
      clearLongPress();
    }, 420);
  }

  function handleBubblePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!longPressStartRef.current) return;
    const dx = event.clientX - longPressStartRef.current.x;
    const dy = event.clientY - longPressStartRef.current.y;
    if (Math.hypot(dx, dy) > 10) clearLongPress();
  }

  function handleMobileRegenerate() {
    setMobileActionsOpen(false);
    onRegenerate(msg.id);
  }

  const assistantTools =
    !isUser && !isCoarsePointer ? (
      <div className="chat-bubble-tools" aria-label="เครื่องมือข้อความ">
        <IconButton
          className="chat-tool-btn"
          variant="ghost"
          size="sm"
          onClick={() => onRegenerate(msg.id)}
          aria-label="สร้างคำตอบใหม่"
          title="สร้างคำตอบใหม่"
        >
          <RotateCcw aria-hidden="true" strokeWidth={1.8} />
        </IconButton>
        <IconButton
          className="chat-tool-btn"
          variant="ghost"
          size="sm"
          onClick={() => void copyMessage()}
          aria-label={copied ? "คัดลอกแล้ว" : "คัดลอกข้อความ"}
          title={copied ? "คัดลอกแล้ว" : "คัดลอกข้อความ"}
        >
          {copied ? (
            <Check aria-hidden="true" strokeWidth={1.9} />
          ) : (
            <Copy aria-hidden="true" strokeWidth={1.8} />
          )}
        </IconButton>
        {thinking && (
          <button
            type="button"
            className="chat-bubble-cot-toggle"
            aria-expanded={thinkingOpen}
            onClick={() => setThinkingOpen((value) => !value)}
          >
            <span className="chat-bubble-cot-title">ดูที่ friday คิด</span>
            <ChevronDown
              className={`chat-bubble-cot-chevron${thinkingOpen ? " open" : ""}`}
              aria-hidden="true"
              strokeWidth={2}
            />
          </button>
        )}
      </div>
    ) : null;

  const bubbleLayout = (
    <>
      <motion.div
        layout={reduceMotion ? false : "position"}
        className={`chat-bubble-wrapper ${isUser ? "user" : "assistant"} ${
          groupedIndex > 0 ? "grouped" : ""
        }`}
        initial={
          revealing && !isUser && !reduceMotion
            ? CHAT_BUBBLE_REVEAL_INITIAL
            : false
        }
        animate={CHAT_BUBBLE_REVEAL_ANIMATE}
        transition={reduceMotion ? { duration: 0 } : CHAT_BUBBLE_PHYSICS}
        style={{ transformOrigin: isUser ? "right top" : "left top" }}
      >
        {!isUser && groupedIndex === 0 && <AssistantOrbAvatar />}
        {!isUser && groupedIndex > 0 && <div className="chat-avatar-spacer" />}
        <div className={`chat-bubble-column ${isUser ? "user" : "assistant"}`}>
          <div
            className={`chat-bubble-frame ${isUser ? "user" : "assistant"}`}
            onPointerDown={handleBubblePointerDown}
            onPointerMove={handleBubblePointerMove}
            onPointerUp={clearLongPress}
            onPointerCancel={clearLongPress}
            onPointerLeave={clearLongPress}
            onContextMenu={(event) => {
              if (!isUser && isCoarsePointer) event.preventDefault();
            }}
          >
            <div
              className={`chat-bubble ${isUser ? "user" : "assistant"} ${
                groupedIndex > 0 ? "grouped" : ""
              } ${revealing && !isUser ? "revealing" : ""}`}
            >
              <RichText
                text={msg.content}
                reduceMotion={reduceMotion}
                reveal={revealing && !isUser}
                onRevealDone={() => onRevealDone(msg.id)}
              />
              {!isUser && sourcePreviews && sourcePreviews.length > 0 && (
                <SourcePreviewPanel previews={sourcePreviews} />
              )}
              {!isUser && jobProgress && jobProgress.length > 0 && (
                <JobProgressInline jobs={jobProgress} />
              )}
              {actions.length > 0 && (
                <div className="chat-approval-stack">
                  {actions.map((action, i) => (
                    <div
                      key={action.id}
                      className={revealing && !isUser ? "rt-line" : undefined}
                      style={
                        revealing && !isUser
                          ? { animationDelay: `${Math.min(i * 90, 1400)}ms` }
                          : undefined
                      }
                    >
                      <InlineApproval
                        action={action}
                        approval={approvalMap[action.id]}
                        busy={approvalBusy === action.id}
                        onApproval={onApproval}
                        onRequestReject={onRequestReject}
                      />
                    </div>
                  ))}
                </div>
              )}
              {!isUser && clarification && (
                <ClarificationPanel
                  prompt={clarification}
                  onChoice={onClarificationChoice}
                  onSkip={onClarificationSkip}
                />
              )}
            </div>
          </div>
          {!isUser && (
            <div className="chat-bubble-footer">
              {assistantTools}
              {meta && <MessageMetaBadge meta={meta} />}
            </div>
          )}
          {!isUser && thinking && (
            <BubbleThinking
              text={thinking}
              reduceMotion={reduceMotion}
              open={thinkingOpen}
            />
          )}
        </div>
      </motion.div>
      {!isUser && isCoarsePointer && (
        <Sheet
          open={mobileActionsOpen}
          onClose={() => setMobileActionsOpen(false)}
          side="bottom"
          size="sm"
          title="จัดการข้อความ"
          className="chat-message-sheet"
        >
          <div className="chat-message-sheet-meta">
            {meta ? <MessageMetaBadge meta={meta} /> : <span>ข้อความจาก Friday</span>}
          </div>
          <div className="chat-message-sheet-actions">
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              iconLeading={copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              onClick={() => void copyMessage(true)}
            >
              {copied ? "คัดลอกแล้ว" : "คัดลอกข้อความ"}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              iconLeading={<RotateCcw aria-hidden="true" />}
              onClick={handleMobileRegenerate}
            >
              สร้างคำตอบใหม่
            </Button>
          </div>
        </Sheet>
      )}
    </>
  );

  if (bubbleLayout) return bubbleLayout;

  return (
    <div
      className={`chat-bubble-wrapper ${isUser ? "user" : "assistant"} ${
        groupedIndex > 0 ? "grouped" : ""
      }`}
    >
      {!isUser && groupedIndex === 0 && <AssistantOrbAvatar />}
      {!isUser && groupedIndex > 0 && (
        <div className="chat-avatar-spacer" />
      )}
      <div
        className={`chat-bubble ${isUser ? "user" : "assistant"} ${
          groupedIndex > 0 ? "grouped" : ""
        } ${revealing && !isUser ? "revealing" : ""}`}
      >
        <RichText
          text={msg.content}
          reduceMotion={reduceMotion}
          reveal={revealing && !isUser}
          onRevealDone={() => onRevealDone(msg.id)}
        />
        {!isUser && (
          <div className="chat-bubble-tools">
            {meta && <MessageMetaBadge meta={meta} />}
            <button
              type="button"
              className="chat-tool-btn"
              onClick={() => onRegenerate(msg.id)}
              aria-label="สร้างคำตอบใหม่"
              title="สร้างคำตอบใหม่"
            >
              <RotateCcw aria-hidden="true" strokeWidth={1.8} />
            </button>
          <button
            type="button"
            className="chat-tool-btn"
            onClick={copyMessage}
            aria-label={copied ? "คัดลอกแล้ว" : "คัดลอกข้อความ"}
            title={copied ? "คัดลอกแล้ว" : "คัดลอกข้อความ"}
            >
              {copied ? (
                <Check aria-hidden="true" strokeWidth={1.9} />
              ) : (
                <Copy aria-hidden="true" strokeWidth={1.8} />
              )}
            </button>
          </div>
        )}
        {actions.length > 0 && (
          <div className="chat-approval-stack">
            {actions.map((action, i) => (
              <div
                key={action.id}
                className={revealing && !isUser ? "rt-line" : undefined}
                style={
                  revealing && !isUser
                    ? { animationDelay: `${Math.min(i * 90, 1400)}ms` }
                    : undefined
                }
              >
                <InlineApproval
                  action={action}
                  approval={approvalMap[action.id]}
                  busy={approvalBusy === action.id}
                  onApproval={onApproval}
                  onRequestReject={onRequestReject}
                />
              </div>
            ))}
          </div>
        )}
        {!isUser && clarification && (
          <ClarificationPanel
            prompt={clarification}
            onChoice={onClarificationChoice}
            onSkip={onClarificationSkip}
          />
        )}
      </div>
    </div>
  );
}

function MessageMetaBadge({ meta }: { meta: MessageMeta }) {
  const parts = [
    PROVIDER_LABELS[meta.provider],
    meta.selectedModel ? compactModelName(meta.selectedModel) : null,
    typeof meta.latencyMs === "number" ? formatLatency(meta.latencyMs) : null,
  ].filter((part): part is string => Boolean(part));
  return <span className="message-meta-badge">{parts.join(" · ")}</span>;
}

function compactModelName(model: string): string {
  return model
    .replace(/^models\//, "")
    .replace(/^openai\//, "")
    .replace(/^qwen\//, "")
    .replace(/^z-ai\//, "");
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function useCoarsePointer(): boolean {
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(hover: none), (pointer: coarse)");
    const update = () => setIsCoarsePointer(media.matches);
    update();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  return isCoarsePointer;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        "button, a, input, textarea, select, summary, [role='button'], [role='menuitem']",
      ),
    )
  );
}

function ClarificationPanel({
  prompt,
  onChoice,
  onSkip,
}: {
  prompt: ClarificationPrompt;
  onChoice: (text: string) => void;
  onSkip: () => void;
}) {
  return (
    <div className="chat-clarification">
      <span>{prompt.question}</span>
      <div className="chat-clarification-actions">
        {prompt.choices.map((choice) => (
          <Button variant="primary" size="sm" key={choice} onClick={() => onChoice(choice)}>
            {choice}
          </Button>
        ))}
        <Button variant="ghost" size="sm" onClick={onSkip}>
          ข้าม
        </Button>
      </div>
    </div>
  );
}

const APPROVAL_STATUS_LABELS: Record<string, string> = {
  pending: "รอดำเนินการ",
  approved: "อนุมัติแล้ว",
  rejected: "ปฏิเสธแล้ว",
  succeeded: "เสร็จแล้ว",
  failed: "ไม่สำเร็จ",
};

function InlineApproval({
  action,
  approval,
  busy,
  onApproval,
  onRequestReject,
}: {
  action: ActionRef;
  approval: Approval | undefined;
  busy: boolean;
  onApproval: (id: number, decision: "approve" | "reject") => void;
  onRequestReject: (
    id: number,
    question: string,
    rejectLabel: string,
  ) => void;
}) {
  const status = approval?.status ?? "pending";
  const executionStatus = approval?.execution_status ?? "not_started";
  const copy = actionQuestion(approval ?? action);
  const disabled = status !== "pending" || busy;
  const failed = status === "pending" && executionStatus === "failed";
  const approveLabel = failed ? "ลองใหม่" : copy.approve;
  const executionMessage = approval
    ? approvalExecutionMessage(approval)
    : null;

  return (
    <div className={`chat-approval ${status} ${failed ? "failed" : ""}`}>
      <span>
        {copy.question}
        {executionMessage && (
          <small className="approval-execution-note">{executionMessage}</small>
        )}
      </span>
      {status === "pending" ? (
        <div className="chat-approval-decision">
          <div className="chat-approval-actions">
          {failed && <span className="badge failed">ไม่สำเร็จ</span>}
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={disabled}
            onClick={() => onApproval(action.id, "approve")}
          >
            {approveLabel}
          </Button>
          </div>
          <div className="chat-approval-danger">
          <Button
            variant="link"
            size="sm"
            disabled={disabled}
            onClick={() =>
              onRequestReject(action.id, copy.question, copy.reject)
            }
          >
            {copy.reject}
          </Button>
          </div>
        </div>
      ) : (
        <span className={`badge ${executionStatus === "succeeded" ? "succeeded" : status}`}>
          {executionStatus === "succeeded" ? "เสร็จแล้ว" : APPROVAL_STATUS_LABELS[status] ?? status}
        </span>
      )}
    </div>
  );
}

function approvalExecutionMessage(approval: Approval): string | null {
  if (approval.execution_status === "failed") {
    return approval.execution_error
      ? `ดำเนินการไม่สำเร็จ: ${approval.execution_error}`
      : "ดำเนินการไม่สำเร็จ ลองใหม่หรือปฏิเสธได้ค่ะ";
  }
  if (approval.execution_status === "succeeded") {
    return approval.result_summary ?? "ดำเนินการสำเร็จแล้วค่ะ";
  }
  return null;
}

function RichText({
  text,
  reduceMotion = false,
  reveal = false,
  onRevealDone,
}: {
  text: string;
  reduceMotion?: boolean;
  reveal?: boolean;
  onRevealDone?: () => void;
}) {
  // Premium reveal: render the whole reply at once, then fade each line in
  // with a short, fast stagger (fade + slight rise + blur clear). Feels silky
  // and "typed by light" rather than a mechanical character ticker.
  const animate = reveal && !reduceMotion;
  const STAGGER_MS = 85;
  const FADE_MS = 620;
  const CAP_MS = 1900; // never delay a line past this, even in long replies
  const blocks = parseMarkdownBlocks(text);

  let seq = 0;
  const nextDelay = () => Math.min(seq++ * STAGGER_MS, CAP_MS);
  const rendered = blocks.map((block, blockIndex) =>
    renderBlock(block, blockIndex, animate, nextDelay),
  );
  const totalMs = animate
    ? Math.min(Math.max(seq - 1, 0) * STAGGER_MS, CAP_MS) + FADE_MS + 80
    : 0;

  useEffect(() => {
    if (!reveal) return;
    if (!animate) {
      const raf = window.requestAnimationFrame(() => onRevealDone?.());
      return () => window.cancelAnimationFrame(raf);
    }
    const timer = window.setTimeout(() => onRevealDone?.(), totalMs);
    return () => window.clearTimeout(timer);
  }, [animate, onRevealDone, reveal, text, totalMs]);

  return (
    <div className={`chat-content${animate ? " rt-reveal" : ""}`}>{rendered}</div>
  );
}

type MarkdownBlock =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "code"; text: string };

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;

  function flushParagraph() {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", lines: paragraph });
      paragraph = [];
    }
  }

  function flushList() {
    if (list) {
      blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
      list = null;
    }
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (line.trim().startsWith("```")) {
      if (code) {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else {
        flushParagraph();
        flushList();
        code = [];
      }
      continue;
    }

    if (code) {
      code.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    if (
      isTableRow(line) &&
      lineIndex + 1 < lines.length &&
      isTableSeparator(lines[lineIndex + 1])
    ) {
      flushParagraph();
      flushList();
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      lineIndex += 2;
      while (lineIndex < lines.length && isTableRow(lines[lineIndex])) {
        rows.push(splitTableRow(lines[lineIndex]));
        lineIndex++;
      }
      lineIndex--;
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextOrdered = Boolean(ordered);
      if (!list || list.ordered !== nextOrdered) flushList();
      if (!list) list = { ordered: nextOrdered, items: [] };
      list.items.push((ordered?.[1] ?? unordered?.[1] ?? "").trim());
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (code) blocks.push({ kind: "code", text: code.join("\n") });
  flushParagraph();
  flushList();
  return blocks;
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.includes("|", 1);
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderBlock(
  block: MarkdownBlock,
  index: number,
  reveal = false,
  nextDelay?: () => number,
) {
  // When revealing, each animatable line gets `.rt-line` + a staggered delay
  // so the reply fades in line-by-line. Off-reveal, layout is untouched.
  const lineProps = (): { className?: string; style?: CSSProperties } =>
    reveal && nextDelay
      ? { className: "rt-line", style: { animationDelay: `${nextDelay()}ms` } }
      : {};

  if (block.kind === "code") {
    const { className, style } = lineProps();
    return (
      <pre
        className={`rt-code-block${className ? ` ${className}` : ""}`}
        style={style}
        key={index}
      >
        <code>{block.text}</code>
      </pre>
    );
  }

  if (block.kind === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag className="rt-list" key={index}>
        {block.items.map((item, itemIndex) => (
          <li key={`${index}-${itemIndex}`} {...lineProps()}>
            {renderInline(item)}
          </li>
        ))}
      </Tag>
    );
  }

  if (block.kind === "table") {
    return (
      <div className="rt-table-wrap" key={index}>
        <table className="rt-table">
          <thead>
            <tr {...lineProps()}>
              {block.headers.map((header, headerIndex) => (
                <th key={`${index}-h-${headerIndex}`}>{renderInline(header)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${index}-r-${rowIndex}`} {...lineProps()}>
                {block.headers.map((_, cellIndex) => (
                  <td key={`${index}-r-${rowIndex}-${cellIndex}`}>
                    {renderInline(row[cellIndex] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (reveal && nextDelay) {
    // Each source line becomes its own block-level span so it can rise+fade
    // independently (no <br> — the spans stack and animate per line).
    return (
      <p className="rt-block" key={index}>
        {block.lines.map((line, lineIndex) => (
          <span
            key={`${index}-${lineIndex}`}
            className="rt-line rt-pline"
            style={{ animationDelay: `${nextDelay()}ms` }}
          >
            {renderInline(line)}
          </span>
        ))}
      </p>
    );
  }

  return (
    <p className="rt-block" key={index}>
      {block.lines.map((line, lineIndex) => (
        <Fragment key={`${index}-${lineIndex}`}>
          {lineIndex > 0 && <br />}
          {renderInline(line)}
        </Fragment>
      ))}
    </p>
  );
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const token = /(`[^`\n]+?`|\[([^\]\n]+?)\]\(([^)\s]+?)\)|<u>[\s\S]+?<\/u>|\+\+[\s\S]+?\+\+|\*\*[\s\S]+?\*\*|\*[^*\n]+?\*|_[^_\n]+?_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = token.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const raw = match[0];
    const key = `${match.index}-${raw}`;
    if (raw.startsWith("`")) {
      nodes.push(<code key={key}>{raw.slice(1, -1)}</code>);
    } else if (raw.startsWith("[")) {
      const href = sanitizeHref(match[3]);
      nodes.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noreferrer">
            {match[2]}
          </a>
        ) : (
          raw
        ),
      );
    } else if (raw.startsWith("**")) {
      nodes.push(<strong key={key}>{raw.slice(2, -2)}</strong>);
    } else if (raw.startsWith("<u>")) {
      nodes.push(<u key={key}>{raw.slice(3, -4)}</u>);
    } else if (raw.startsWith("++")) {
      nodes.push(<u key={key}>{raw.slice(2, -2)}</u>);
    } else {
      nodes.push(<em key={key}>{raw.slice(1, -1)}</em>);
    }
    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function sanitizeHref(href: string): string | null {
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href;
  return null;
}

type SourceHint = "calendar" | "gmail" | "drive" | "tasks" | "reminders" | "memory" | "chat";

const SOURCE_LABELS: Record<SourceHint, string> = {
  calendar: "ปฏิทิน",
  gmail: "Gmail",
  drive: "Drive",
  tasks: "งาน",
  reminders: "เตือนความจำ",
  memory: "ความจำ",
  chat: "แชต",
};

const SOURCE_ICONS: Record<SourceHint, typeof CalendarDays> = {
  calendar: CalendarDays,
  gmail: Mail,
  drive: Folder,
  tasks: CheckSquare,
  reminders: Clock3,
  memory: Database,
  chat: MessageCircle,
};

function SourceHintList({ hints }: { hints: SourceHint[] }) {
  if (hints.length === 0) return null;
  return (
    <span className="source-hints" aria-label="แหล่งข้อมูล">
      {hints.map((hint) => {
        const Icon = SOURCE_ICONS[hint];
        return (
          <span className="source-hint" key={hint} title={SOURCE_LABELS[hint]}>
            <Icon aria-hidden="true" strokeWidth={1.8} />
            <span>{SOURCE_LABELS[hint]}</span>
          </span>
        );
      })}
    </span>
  );
}

function inferSourceHints(
  message: ChatMessage,
  actions: ActionRef[],
  previews?: ChatSourcePreview[],
): SourceHint[] {
  if (message.role === "user") return [];
  const hints = new Set<SourceHint>();
  for (const preview of previews ?? []) {
    if (preview.kind === "gmail") hints.add("gmail");
    if (preview.kind === "drive") hints.add("drive");
  }
  for (const action of actions) {
    if (action.action_type.includes("event")) hints.add("calendar");
    if (action.action_type.includes("task")) hints.add("tasks");
    if (action.action_type.includes("reminder")) hints.add("reminders");
    if (action.action_type.includes("memory")) hints.add("memory");
  }

  const content = message.content.toLowerCase();
  if (/\b(calendar|schedule|event|brief)\b/.test(content)) hints.add("calendar");
  if (/\b(gmail|email|mail|inbox)\b|อีเมล|อีเมล์|เมล/.test(content)) hints.add("gmail");
  if (/\b(drive|file|document|folder|sheet|slide)\b|ไดรฟ์|ไดร์ฟ|ไฟล์|เอกสาร/.test(content)) hints.add("drive");
  if (/\btask|todo\b/.test(content)) hints.add("tasks");
  if (/\breminder\b/.test(content)) hints.add("reminders");
  if (/\bmemory|preference|routine|project\b/.test(content)) hints.add("memory");
  if (hints.size === 0) hints.add("chat");
  return [...hints];
}

function mergeSourceHints(hints: SourceHint[]): SourceHint[] {
  const order: SourceHint[] = ["calendar", "gmail", "drive", "tasks", "reminders", "memory", "chat"];
  const set = new Set(hints);
  return order.filter((hint) => set.has(hint)).slice(0, 3);
}

interface ActionRef {
  id: number;
  action_type: ActionType;
  payload?: unknown;
}

function parseActions(actionsJson: string | null): ActionRef[] {
  if (!actionsJson) return [];
  try {
    const parsed = JSON.parse(actionsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!isActionRef(item)) return [];
      return [item];
    });
  } catch {
    return [];
  }
}

function isActionRef(value: unknown): value is ActionRef {
  if (typeof value !== "object" || value == null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "number" &&
    typeof record.action_type === "string" &&
    isActionType(record.action_type)
  );
}

function indexApprovals(approvals: Approval[]): ApprovalMap {
  return Object.fromEntries(approvals.map((approval) => [approval.id, approval]));
}
