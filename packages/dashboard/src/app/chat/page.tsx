"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiError, getChatHistory, resetChat, sendChat } from "@/lib/api";
import { formatTs } from "@/lib/format";
import { ErrorBanner, Loading } from "@/components/States";
import type { ChatMessage, ChatResult } from "@/lib/types";

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ChatResult | null>(null);
  const [resetting, setResetting] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  // Load history on mount.
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

  // Scroll to bottom when messages change.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);
    setSendError(null);
    setLastResult(null);

    // Optimistic: add user bubble immediately.
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

      // Replace optimistic with real history from server.
      const updated = await getChatHistory(100);
      setMessages(updated);
    } catch (err) {
      // Remove optimistic message on failure.
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      setSendError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSending(false);
    }
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
    <>
      <header className="page-header">
        <div>
          <p className="page-kicker">Agent</p>
          <h2>Chat</h2>
          <p className="lede">
            Conversational agent with recall of your tasks, schedule, and memory.
            Writes require approval before executing.
          </p>
        </div>
        <button
          className="secondary"
          onClick={onNewSession}
          disabled={sending || resetting}
          title="Archive this session — old messages stay in DB but won't be sent to Claude"
        >
          {resetting ? "Resetting…" : "New session"}
        </button>
      </header>

      <div className="chat-layout">
        <div className="chat-messages panel">
          {loading && <Loading />}
          {loadError && (
            <ErrorBanner message={loadError} onRetry={() => window.location.reload()} />
          )}

          {!loading && messages.length === 0 && (
            <div className="chat-empty">
              Start a conversation. Ask what&rsquo;s on your plate, set a reminder,
              or create a task.
            </div>
          )}

          {messages.map((msg) => (
            <ChatBubble key={msg.id} msg={msg} />
          ))}

          {/* Sending indicator */}
          {sending && (
            <div className="chat-bubble assistant typing">
              <span className="chat-role">Agent</span>
              <span className="chat-content muted">Thinking&hellip;</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Approvals notice after last send */}
        {lastResult && lastResult.approvals.length > 0 && (
          <div className="chat-notice">
            <strong>{lastResult.approvals.length} proposal(s) queued</strong>
            {" — "}
            <Link href="/approvals" className="section-link">
              Review in Approvals
            </Link>
          </div>
        )}

        {sendError && (
          <ErrorBanner message={sendError} onRetry={() => setSendError(null)} />
        )}

        <form className="composer chat-composer" onSubmit={onSend}>
          <input
            placeholder="Message the agent..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
            autoFocus
          />
          <button
            type="submit"
            className="primary"
            disabled={sending || input.trim() === ""}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      </div>
    </>
  );
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  const actions = parseActions(msg.actions_json);

  return (
    <div className={`chat-bubble ${isUser ? "user" : "assistant"}`}>
      <div className="chat-bubble-header">
        <span className="chat-role">{isUser ? "You" : "Agent"}</span>
        <span className="ts">{formatTs(msg.created_at)}</span>
      </div>
      <div className="chat-content">{msg.content}</div>
      {actions.length > 0 && (
        <div className="chat-actions-note">
          Queued {actions.length} proposal(s):{" "}
          {actions.map((a: { action_type: string }) => a.action_type).join(", ")}{" "}
          &mdash;{" "}
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
