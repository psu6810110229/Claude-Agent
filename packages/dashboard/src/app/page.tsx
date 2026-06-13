"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  CalendarDays,
  CheckSquare,
  Clock3,
  Database,
  Lock,
  MessageCircle,
  Unlock,
  Volume2,
  VolumeX,
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
  prepareSpeech,
  speak,
  verifyIdentity,
} from "@/lib/api";
import { formatTs } from "@/lib/format";
import { actionQuestion, isActionType } from "@/lib/actionDisplay";
import { ErrorBanner } from "@/components/States";
import { Orb, type OrbState } from "@/components/Orb";
import { JarvisInput } from "@/components/JarvisInput";
import { useToast } from "@/components/ToastProvider";
import type {
  ActionType,
  AiProviderId,
  ProviderChoice,
  Approval,
  BriefResult,
  BriefType,
  ChatMessage,
  VerifyResult,
} from "@/lib/types";

const PROVIDER_LABELS: Record<AiProviderId, string> = {
  claude: "Claude",
  gemini: "Gemini",
};

/** Idle delay before Jarvis offers a proactive follow-up after its last turn. */
const FOLLOWUP_IDLE_MS = 5000;

/** Time-of-day greeting in the user's timezone (Asia/Bangkok). */
function greetingNow(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Bangkok",
    }).format(new Date()),
  );
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

type ApprovalMap = Record<number, Approval>;
interface ClarificationPrompt {
  messageId: number;
  question: string;
  choices: string[];
}

export default function HomePage() {
  const { notify } = useToast();
  const [greeting, setGreeting] = useState<string | null>(null);
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [provider, setProvider] = useState<ProviderChoice>("gemini");
  const [messageProvider, setMessageProvider] = useState<
    Record<number, AiProviderId>
  >({});
  const [approvalMap, setApprovalMap] = useState<ApprovalMap>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [briefBusy, setBriefBusy] = useState<BriefType | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [chatErrorRendered, setChatErrorRendered] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState<number | null>(null);
  const [resetting, setResetting] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const [revealingMessageIds, setRevealingMessageIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [activeClarification, setActiveClarification] =
    useState<ClarificationPrompt | null>(null);
  const [muted, setMuted] = useState(false);
  // Step 15 — privacy guard (conversational flow)
  const [verified, setVerified] = useState(false);
  const [guardEnabled, setGuardEnabled] = useState(false);
  const [pendingVerificationPrompt, setPendingVerificationPrompt] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const followupTimerRef = useRef<number | null>(null);
  // Live mirror of `muted` so the idle-follow-up timer reads the current value
  // (its closure is captured when scheduled, before any later mute toggle).
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // Hydrate muted from localStorage after mount (avoid SSR mismatch).
  useEffect(() => {
    setMuted(localStorage.getItem("jarvis.muted") === "true");
  }, []);

  // Step 15 — init per-tab sessionId (sessionStorage clears on tab close).
  useEffect(() => {
    let id = sessionStorage.getItem("chatSessionId");
    if (!id) {
      id = crypto.randomUUID();
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

  // Cancel any pending follow-up when the component unmounts.
  useEffect(
    () => () => {
      if (followupTimerRef.current !== null) {
        window.clearTimeout(followupTimerRef.current);
      }
    },
    [],
  );

  const hasConversation = messages.length > 0 || sending || briefBusy !== null;

  useEffect(() => {
    setGreeting(greetingNow());
  }, []);

  useEffect(() => {
    Promise.all([getChatHistory(100), listApprovals()])
      .then(([msgs, approvals]) => {
        setMessages(msgs);
        setApprovalMap(indexApprovals(approvals));
        const pendingCount = approvals.filter((a) => a.status === "pending").length;
        if (pendingCount > 0) {
          notify({
            kind: "warning",
            title: "มีงานรอ approve",
            description: `${pendingCount} รายการต้องตัดสินใจก่อนทำงานต่อ`,
          });
        }
        setLoading(false);
      })
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : String(err));
        setLoading(false);
      });
  }, [notify]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending, briefBusy]);

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

  // Idle proactive nudge. Fires once after the user stays quiet; never loops
  // (it does not reschedule itself) and stays silent unless the backend offers
  // something useful. Any failure is swallowed — a nudge must never disrupt.
  async function runFollowup() {
    if (sending || briefBusy || resetting) return;
    const previousIds = new Set(messages.map((message) => message.id));
    try {
      const result = await requestChatFollowup();
      if (result.kind !== "followup") return;
      if (result.approvals.length > 0) {
        mergeApprovals(result.approvals);
        notifyPendingApprovals(result.approvals.length);
      }
      if (!mutedRef.current) void speak(result.spoken ?? result.reply);
      const updated = await getChatHistory(100);
      const fresh = [...updated]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" && !previousIds.has(message.id),
        );
      setMessages(updated);
      if (fresh) {
        setRevealingMessageIds((prev) => new Set(prev).add(fresh.id));
      }
    } catch {
      // Silent — proactive follow-up must never surface an error.
    }
  }

  async function doSend(text: string, isRetry = false) {
    if (briefBusy) return;
    clearFollowup();
    const previousIds = new Set(messages.map((message) => message.id));
    setOrbState("thinking");
    setSending(true);
    setSendError(null);
    setChatErrorRendered(false);
    setLastFailedMessage(null);
    setActiveClarification(null);

    let shouldFallThrough = false;
    
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
          
          const successMsg: ChatMessage = fallbackAssistantMessage("✅ ปลดล็อกสำเร็จครับ กำลังดำเนินการต่อ...");
          setMessages((prev) => [...prev, successMsg]);
          if (!muted) void speak("เรียบร้อยครับ ดำเนินการต่อเลย");
          
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
          
          const errorText = "❌ ยืนยันตัวตนไม่สำเร็จหลายครั้ง กรุณารอสักครู่แล้วลองใหม่ครับ";
          const failMsg: ChatMessage = fallbackAssistantMessage(errorText);
          setMessages((prev) => [...prev, failMsg]);
          if (!muted) void speak("รหัสผิดหลายครั้ง พักก่อนนะครับ");
          
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
    }

    try {
      const result = await sendChat(text, provider, sessionIdRef.current ?? undefined);
      // The instant the reply lands, kick off BOTH the history refetch and TTS
      // buffering concurrently. We buffer the spoken line WITHOUT playing it,
      // then reveal the text and start the voice in the same tick so they land
      // together. The result report (if any) is queued AFTER, non-overlapping.
      if (result.verificationRequired) {
        setPendingVerificationPrompt(text);
        
        const updated = await getChatHistory(100);
        const reqMsg: ChatMessage = fallbackAssistantMessage("🔒 ข้อมูลถูกจำกัดการเข้าถึงครับ กรุณาพิมพ์ รหัส PIN หรือ คำลับ เพื่อดำเนินการต่อครับ");
        
        const freshAssistant = [...updated]
          .reverse()
          .find((message) => message.role === "assistant" && !previousIds.has(message.id));
          
        setMessages([...updated, reqMsg]);
        
        if (freshAssistant) {
          setRevealingMessageIds((prev) => new Set(prev).add(freshAssistant.id));
          setMessageProvider((prev) => ({
            ...prev,
            [freshAssistant.id]: result.provider,
          }));
        }

        const speechText = result.spoken ?? result.reply;
        if (!muted) {
          if (speechText) {
             const speech = prepareSpeech(speechText);
             await speech.ready;
             speech.play();
             // chain the lock nag after the natural reply
             void speak("ระบบล็อคอยู่ครับ ขอดูรหัสพินหรือคำลับก่อนนะครับ");
          } else {
             void speak("ระบบล็อคอยู่ครับ ขอดูรหัสพินหรือคำลับก่อนนะครับ");
          }
        }
        
        setSending(false);
        setOrbState("idle");
        return;
      }
      const historyP = getChatHistory(100);
      const speech = !muted ? prepareSpeech(result.spoken ?? result.reply) : null;
      if (result.approvals.length > 0) {
        mergeApprovals(result.approvals);
        notifyPendingApprovals(result.approvals.length);
      }
      const updated = await historyP;
      const freshAssistant = [...updated]
        .reverse()
        .find((message) => message.role === "assistant" && !previousIds.has(message.id));
      // Hold the text reveal until the audio is buffered (capped inside
      // prepareSpeech), so text + voice begin together. Fail-soft: muted /
      // disabled / slow TTS resolves fast and text shows anyway.
      if (speech) await speech.ready;
      setMessages(updated);
      if (freshAssistant) {
        setRevealingMessageIds((prev) => new Set(prev).add(freshAssistant.id));
        // Record which provider answered so the bubble can show it (provider is
        // not persisted server-side, so this is session-scoped).
        setMessageProvider((prev) => ({
          ...prev,
          [freshAssistant.id]: result.provider,
        }));
      }
      speech?.play(); // same tick as the reveal → text and voice together
      if (!muted && result.resultSpoken) void speak(result.resultSpoken);
      const clarification = buildClarificationPrompt(
        updated,
        result.clarification,
        result.clarification_choices,
      );
      setActiveClarification(clarification);
      // Offer a proactive follow-up after a quiet pause — but not while we are
      // already waiting on the user to answer a clarification.
      if (!clarification) scheduleFollowup();
    } catch (err) {
      let message = err instanceof ApiError ? err.message : String(err);
      // Phase 4 — Auto mode never switches providers silently. On failure the
      // backend names another available provider; surface it as an explicit
      // retry hint instead of auto-retrying.
      const fallback =
        err instanceof ApiError
          ? (err.details?.fallbackProvider as AiProviderId | null | undefined)
          : undefined;
      if (fallback) {
        const hint = `ลองใหม่ด้วย ${PROVIDER_LABELS[fallback]} ได้ครับ`;
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
    } finally {
      setSending(false);
      setOrbState("idle");
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

  async function runApproval(id: number, decision: "approve" | "reject") {
    if (approvalBusy) return;
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
        title: decision === "approve" ? "Approved" : "Rejected",
        description:
          decision === "approve"
            ? "ดำเนินการที่อนุมัติแล้ว"
            : "ยกเลิกงานที่รออนุมัติแล้ว",
      });
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
    setResetting(true);
    try {
      await resetChat(sessionIdRef.current ?? undefined);
      setMessages([]);
      setSendError(null);
      setChatErrorRendered(false);
      setActiveClarification(null);
      setConfirmingReset(false);
      setVerified(false);
      setPendingVerificationPrompt(null);
      notify({
        kind: "success",
        title: "New session",
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
      <div className="jarvis-session-bar">
        <button
          className="secondary"
          onClick={requestNewSession}
          disabled={sending || briefBusy !== null || resetting}
          title="Archive this session - old messages stay in DB but won't be sent to Claude"
        >
          {resetting ? "Resetting..." : "New session"}
        </button>
        {guardEnabled && (
          <div
            className={`jarvis-lock-btn ${verified ? "verified" : ""}`}
            title={verified ? "ยืนยันตัวตนแล้ว" : "ระบบล็อกความปลอดภัยการเข้าถึงข้อมูลส่วนตัว"}
            aria-label={verified ? "ยืนยันตัวตนแล้ว" : "ระบบล็อก"}
          >
            {verified ? (
              <Unlock strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <Lock strokeWidth={1.8} aria-hidden="true" />
            )}
            <span className="jarvis-lock-label">
              {verified ? "ยืนยันแล้ว" : "ล็อก"}
            </span>
          </div>
        )}
      </div>

      <div className="jarvis-stage">
        {!hasConversation && !loading && (
          <div className="jarvis-welcome">
            <Orb state={orbState} />

            <motion.div
              className="jarvis-greeting"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 70, damping: 18, delay: 0.15 }}
            >
              <h1 className={greeting ? "" : "pending"}>
                {greeting ?? "Hello"}, Fran.
              </h1>
              <p>How can I help you today?</p>
              <div className="chat-empty-actions" aria-label="Suggested prompts">
                {[
                  "What is on my schedule today?",
                  "Show open tasks",
                  "Draft a quick reminder",
                ].map((prompt) => (
                  <button
                    type="button"
                    key={prompt}
                    onClick={() => doSend(prompt)}
                    disabled={sending || briefBusy !== null}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
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
                messageProvider={messageProvider}
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
                activeClarification={activeClarification}
                onClarificationChoice={doSend}
                onClarificationSkip={() => setActiveClarification(null)}
              />
            ))}

            {sending && (
              <div className="chat-bubble assistant typing">
                <span className="chat-role">Jarvis</span>
                <ThinkingContent
                  label="Checking context"
                  detail="Reviewing chat history, tasks, reminders, and approvals"
                />
              </div>
            )}

            {briefBusy && (
              <div className="chat-bubble assistant typing">
                <span className="chat-role">Jarvis</span>
                <ThinkingContent
                  label={`Generating ${briefBusy === "daily" ? "Daily Brief" : "Evening Brief"}`}
                  detail="Collecting schedule, tasks, and pending approvals"
                />
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {sendError && !chatErrorRendered && (
            <ErrorBanner message={sendError} onRetry={onRetry} />
          )}
        </div>
      </div>

      <motion.div
        className="jarvis-input-dock"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 70, damping: 18, delay: 0.3 }}
      >
        <JarvisInput
          onSubmit={doSend}
          onBrief={runBrief}
          disabled={sending || briefBusy !== null}
          briefBusy={briefBusy}
          provider={provider}
          onProviderChange={setProvider}
          onFocusChange={(focused) =>
            setOrbState((s) =>
              s === "thinking" ? s : focused ? "listening" : "idle",
            )
          }
        />
        <button
          type="button"
          className="jarvis-mute-btn"
          onClick={() =>
            setMuted((prev) => {
              const next = !prev;
              localStorage.setItem("jarvis.muted", String(next));
              return next;
            })
          }
          title={muted ? "Unmute voice" : "Mute voice"}
          aria-label={muted ? "Unmute voice" : "Mute voice"}
          aria-pressed={muted}
        >
          {muted ? (
            <VolumeX strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <Volume2 strokeWidth={1.8} aria-hidden="true" />
          )}
        </button>
      </motion.div>

      {confirmingReset && (
        <SessionConfirmDialog
          busy={resetting}
          onCancel={() => setConfirmingReset(false)}
          onConfirm={confirmNewSession}
        />
      )}
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
          <p className="page-kicker">Session</p>
          <h3 id="session-dialog-title">Start a new session?</h3>
          <p id="session-dialog-desc">
            Current messages will be archived. They stay in the database, but
            they will not appear in this chat or be sent to Claude.
          </p>
        </div>
        <div className="jarvis-dialog-actions">
          <button type="button" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Starting..." : "New session"}
          </button>
        </div>
      </section>
    </div>
  );
}

function briefToMessage(result: BriefResult): ChatMessage {
  const label = result.type === "daily" ? "Daily Brief" : "Evening Brief";
  const now = new Date().toISOString();
  const notes = result.notes ? `\n\nNotes: ${result.notes}` : "";

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

function ThinkingContent({
  label,
  detail,
}: {
  label: string;
  detail: string;
}) {
  return (
    <div className="thinking-content" aria-live="polite">
      <div className="thinking-line">
        <span>{label}</span>
        <span className="thinking-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className="thinking-detail">{detail}</div>
      <div className="thinking-progress" aria-hidden="true" />
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
  messageProvider,
  approvalMap,
  approvalBusy,
  revealingMessageIds,
  onRevealDone,
  onApproval,
  activeClarification,
  onClarificationChoice,
  onClarificationSkip,
}: {
  group: ChatGroup;
  messageProvider: Record<number, AiProviderId>;
  approvalMap: ApprovalMap;
  approvalBusy: number | null;
  revealingMessageIds: Set<number>;
  onRevealDone: (id: number) => void;
  onApproval: (id: number, decision: "approve" | "reject") => void;
  activeClarification: ClarificationPrompt | null;
  onClarificationChoice: (text: string) => void;
  onClarificationSkip: () => void;
}) {
  const isUser = group.role === "user";
  const first = group.messages[0];
  const groupSources = mergeSourceHints(
    group.messages.flatMap((message) =>
      inferSourceHints(message, parseActions(message.actions_json)),
    ),
  );
  const groupProvider = isUser
    ? undefined
    : group.messages
        .map((message) => messageProvider[message.id])
        .find((value): value is AiProviderId => Boolean(value));

  return (
    <section className={`chat-group ${isUser ? "user" : "assistant"}`}>
      <div className="chat-group-header">
        <span className="chat-role">{isUser ? "You" : "Jarvis"}</span>
        <span className="ts">{formatTs(first.created_at)}</span>
        {groupProvider && (
          <span className="provider-badge" title="AI provider">
            {PROVIDER_LABELS[groupProvider]}
          </span>
        )}
        {!isUser && <SourceHintList hints={groupSources} />}
      </div>
      <div className="chat-group-stack">
        {group.messages.map((msg, index) => (
          <ChatBubble
            key={msg.id}
            msg={msg}
            groupedIndex={index}
            approvalMap={approvalMap}
            approvalBusy={approvalBusy}
            revealing={revealingMessageIds.has(msg.id)}
            onRevealDone={onRevealDone}
            onApproval={onApproval}
            clarification={
              activeClarification?.messageId === msg.id
                ? activeClarification
                : null
            }
            onClarificationChoice={onClarificationChoice}
            onClarificationSkip={onClarificationSkip}
          />
        ))}
      </div>
    </section>
  );
}

function ChatBubble({
  msg,
  groupedIndex,
  approvalMap,
  approvalBusy,
  revealing,
  onRevealDone,
  onApproval,
  clarification,
  onClarificationChoice,
  onClarificationSkip,
}: {
  msg: ChatMessage;
  groupedIndex: number;
  approvalMap: ApprovalMap;
  approvalBusy: number | null;
  revealing: boolean;
  onRevealDone: (id: number) => void;
  onApproval: (id: number, decision: "approve" | "reject") => void;
  clarification: ClarificationPrompt | null;
  onClarificationChoice: (text: string) => void;
  onClarificationSkip: () => void;
}) {
  const isUser = msg.role === "user";
  const actions = parseActions(msg.actions_json);

  return (
    <div
      className={`chat-bubble ${isUser ? "user" : "assistant"} ${
        groupedIndex > 0 ? "grouped" : ""
      }`}
    >
      <RichText
        text={msg.content}
        reveal={revealing && !isUser}
        onRevealDone={() => onRevealDone(msg.id)}
      />
      {actions.length > 0 && (
        <div className="chat-approval-stack">
          {actions.map((action) => (
            <InlineApproval
              key={action.id}
              action={action}
              approval={approvalMap[action.id]}
              busy={approvalBusy === action.id}
              onApproval={onApproval}
            />
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
          <button
            type="button"
            className="primary"
            key={choice}
            onClick={() => onChoice(choice)}
          >
            {choice}
          </button>
        ))}
        <button type="button" onClick={onSkip}>
          Skip
        </button>
      </div>
    </div>
  );
}

function InlineApproval({
  action,
  approval,
  busy,
  onApproval,
}: {
  action: ActionRef;
  approval: Approval | undefined;
  busy: boolean;
  onApproval: (id: number, decision: "approve" | "reject") => void;
}) {
  const status = approval?.status ?? "pending";
  const executionStatus = approval?.execution_status ?? "not_started";
  const copy = actionQuestion(approval ?? action);
  const disabled = status !== "pending" || busy;
  const failed = status === "pending" && executionStatus === "failed";
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
        <div className="chat-approval-actions">
          {failed && <span className="badge failed">failed</span>}
          <button
            type="button"
            className="primary"
            disabled={disabled}
            onClick={() => onApproval(action.id, "approve")}
          >
            {busy ? "..." : copy.approve}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onApproval(action.id, "reject")}
          >
            {copy.reject}
          </button>
        </div>
      ) : (
        <span className={`badge ${executionStatus === "succeeded" ? "succeeded" : status}`}>
          {executionStatus === "succeeded" ? "done" : status}
        </span>
      )}
    </div>
  );
}

function approvalExecutionMessage(approval: Approval): string | null {
  if (approval.execution_status === "failed") {
    return approval.execution_error
      ? `Execution failed: ${approval.execution_error}`
      : "Execution failed. You can retry or reject it.";
  }
  if (approval.execution_status === "succeeded") {
    return approval.result_summary ?? "Executed successfully.";
  }
  return null;
}

function RichText({
  text,
  reveal = false,
  onRevealDone,
}: {
  text: string;
  reveal?: boolean;
  onRevealDone?: () => void;
}) {
  const [visibleCount, setVisibleCount] = useState(reveal ? 0 : text.length);
  const displayText = reveal ? text.slice(0, visibleCount) : text;

  useEffect(() => {
    if (!reveal) {
      setVisibleCount(text.length);
      return;
    }
    setVisibleCount(0);
    const step = Math.max(3, Math.ceil(text.length / 90));
    const timer = window.setInterval(() => {
      setVisibleCount((current) => {
        const next = Math.min(text.length, current + step);
        if (next >= text.length) {
          window.clearInterval(timer);
          window.setTimeout(() => onRevealDone?.(), 120);
        }
        return next;
      });
    }, 16);
    return () => window.clearInterval(timer);
  }, [onRevealDone, reveal, text]);

  const blocks = parseMarkdownBlocks(displayText);
  return (
    <div className="chat-content">
      {blocks.map((block, blockIndex) => renderBlock(block, blockIndex))}
      {reveal && visibleCount < text.length && (
        <span className="stream-caret" aria-hidden="true" />
      )}
    </div>
  );
}

type MarkdownBlock =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
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

  for (const line of lines) {
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

function renderBlock(block: MarkdownBlock, index: number) {
  if (block.kind === "code") {
    return (
      <pre className="rt-code-block" key={index}>
        <code>{block.text}</code>
      </pre>
    );
  }

  if (block.kind === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag className="rt-list" key={index}>
        {block.items.map((item, itemIndex) => (
          <li key={`${index}-${itemIndex}`}>{renderInline(item)}</li>
        ))}
      </Tag>
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

type SourceHint = "calendar" | "tasks" | "reminders" | "memory" | "chat";

const SOURCE_LABELS: Record<SourceHint, string> = {
  calendar: "Calendar",
  tasks: "Tasks",
  reminders: "Reminders",
  memory: "Memory",
  chat: "Chat",
};

const SOURCE_ICONS: Record<SourceHint, typeof CalendarDays> = {
  calendar: CalendarDays,
  tasks: CheckSquare,
  reminders: Clock3,
  memory: Database,
  chat: MessageCircle,
};

function SourceHintList({ hints }: { hints: SourceHint[] }) {
  if (hints.length === 0) return null;
  return (
    <span className="source-hints" aria-label="Message context">
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

function inferSourceHints(message: ChatMessage, actions: ActionRef[]): SourceHint[] {
  if (message.role === "user") return [];
  const hints = new Set<SourceHint>();
  for (const action of actions) {
    if (action.action_type.includes("event")) hints.add("calendar");
    if (action.action_type.includes("task")) hints.add("tasks");
    if (action.action_type.includes("reminder")) hints.add("reminders");
    if (action.action_type.includes("memory")) hints.add("memory");
  }

  const content = message.content.toLowerCase();
  if (/\b(calendar|schedule|event|brief)\b/.test(content)) hints.add("calendar");
  if (/\btask|todo\b/.test(content)) hints.add("tasks");
  if (/\breminder\b/.test(content)) hints.add("reminders");
  if (/\bmemory|preference|routine|project\b/.test(content)) hints.add("memory");
  if (hints.size === 0) hints.add("chat");
  return [...hints];
}

function mergeSourceHints(hints: SourceHint[]): SourceHint[] {
  const order: SourceHint[] = ["calendar", "tasks", "reminders", "memory", "chat"];
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
