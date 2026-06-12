"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ApiError, getChatHistory, resetChat, sendChat } from "@/lib/api";
import { formatTs } from "@/lib/format";
import { ErrorBanner } from "@/components/States";
import { Orb, type OrbState } from "@/components/Orb";
import { JarvisInput } from "@/components/JarvisInput";
import type { ChatMessage, ChatResult } from "@/lib/types";

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

export default function HomePage() {
  const [greeting, setGreeting] = useState<string | null>(null);
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ChatResult | null>(null);
  const [resetting, setResetting] = useState(false);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setGreeting(greetingNow());
  }, []);

  useEffect(() => {
    getChatHistory(100)
      .then((msgs) => {
        setMessages(msgs);
        setLoading(false);
      })
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function doSend(text: string) {
    setOrbState("thinking");
    setSending(true);
    setSendError(null);
    setLastResult(null);
    setLastFailedMessage(null);

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

    try {
      const result = await sendChat(text);
      setLastResult(result);
      const updated = await getChatHistory(100);
      setMessages(updated);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      setSendError(err instanceof ApiError ? err.message : String(err));
      setLastFailedMessage(text);
    } finally {
      setSending(false);
      setOrbState("idle");
    }
  }

  async function onRetry() {
    if (!lastFailedMessage || sending) return;
    await doSend(lastFailedMessage);
  }

  async function onNewSession() {
    if (sending || resetting) return;
    if (!window.confirm("Archive this session and start fresh? Old messages are kept in the DB but won't appear in chat or be sent to Claude.")) return;
    setResetting(true);
    try {
      await resetChat();
      setMessages([]);
      setLastResult(null);
      setSendError(null);
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="jarvis-home">
      <div className="jarvis-session-bar">
        <button
          className="secondary"
          onClick={onNewSession}
          disabled={sending || resetting}
          title="Archive this session - old messages stay in DB but won't be sent to Claude"
        >
          {resetting ? "Resetting..." : "New session"}
        </button>
      </div>

      <div className="jarvis-stage">
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
        </motion.div>

        <div className="chat-layout home-chat">
          <div className="chat-messages panel">
            {loading && <ChatSkeleton />}
            {loadError && (
              <ErrorBanner message={loadError} onRetry={() => window.location.reload()} />
            )}

            {!loading && messages.length === 0 && (
              <div className="chat-empty">
                Start a conversation. Ask what is on your plate, set a reminder,
                or create a task.
              </div>
            )}

            {messages.map((msg) => (
              <ChatBubble key={msg.id} msg={msg} />
            ))}

            {sending && (
              <div className="chat-bubble assistant typing">
                <span className="chat-role">Jarvis</span>
                <span className="chat-content muted">Thinking...</span>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {lastResult && lastResult.approvals.length > 0 && (
            <div className="chat-notice">
              <strong>{lastResult.approvals.length} proposal(s) queued</strong>
              {" - "}
              <Link href="/approvals" className="section-link">
                Review in Approvals
              </Link>
            </div>
          )}

          {sendError && <ErrorBanner message={sendError} onRetry={onRetry} />}
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
          disabled={sending}
          onFocusChange={(focused) =>
            setOrbState((s) =>
              s === "thinking" ? s : focused ? "listening" : "idle",
            )
          }
        />
      </motion.div>
    </div>
  );
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

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  const actions = parseActions(msg.actions_json);

  return (
    <div className={`chat-bubble ${isUser ? "user" : "assistant"}`}>
      <div className="chat-bubble-header">
        <span className="chat-role">{isUser ? "You" : "Jarvis"}</span>
        <span className="ts">{formatTs(msg.created_at)}</span>
      </div>
      <div className="chat-content">{msg.content}</div>
      {actions.length > 0 && (
        <div className="chat-actions-note">
          Queued {actions.length} proposal(s):{" "}
          {actions.map((a: { action_type: string }) => a.action_type).join(", ")}{" "}
          -{" "}
          <Link href="/approvals" className="section-link">
            Approvals
          </Link>
        </div>
      )}
    </div>
  );
}

function parseActions(actionsJson: string | null): { action_type: string }[] {
  if (!actionsJson) return [];
  try {
    return JSON.parse(actionsJson) as { action_type: string }[];
  } catch {
    return [];
  }
}
