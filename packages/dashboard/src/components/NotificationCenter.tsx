"use client";

/**
 * NotificationCenter (Step 11). Mounted globally in layout.tsx so it's active
 * on every page. Polls /api/notifications/unread every 30 s, surfaces newly-seen
 * ids, and lets the user mark items as read.
 *
 * CROSS-DEVICE: scheduler voice + the native Windows toast are server-side and
 * only ever fire on the HOST machine. The DB-backed unread feed is the ONLY
 * channel that reaches other devices (Android / a second laptop) over Tailscale.
 * So a new notification here is surfaced THREE ways, most-portable first:
 *   1. in-app toast (ToastProvider) — pure DOM, works on every device/tab even
 *      over plain-HTTP Tailscale where the OS Notification API is blocked;
 *   2. in-browser voice via speak() — same path as chat replies, so remote
 *      devices hear the alert too (host speaker stays for the host);
 *   3. OS Notification — best-effort enhancement, only when secure + granted.
 *
 * Design:
 * - First poll on mount SEEDS seenIds silently (no toast/voice storm for the
 *   backlog of unread on every page load); only genuinely new ids alert after.
 * - Requests browser Notification permission once on first new notification.
 * - Degrades silently on backend errors (no crash, no noisy console).
 * - Direct write (markNotificationRead) is NOT approval-gated (benign UI state).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  listUnreadNotifications,
  markNotificationRead,
  speak,
} from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import type { Notification } from "@/lib/types";

const POLL_INTERVAL_MS = 30_000;

function BellIcon({ hasBadge }: { hasBadge: boolean }) {
  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      aria-hidden="true"
    >
      {/* Simple bell SVG */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 2a6 6 0 0 1 6 6c0 3.5 1.5 5 2 6H2c.5-1 2-2.5 2-6a6 6 0 0 1 6-6Z" />
        <path d="M8.5 18a1.5 1.5 0 0 0 3 0" />
      </svg>
      {hasBadge && (
        <span
          style={{
            position: "absolute",
            top: -3,
            right: -4,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--rose)",
            border: "1.5px solid var(--surface)",
          }}
        />
      )}
    </span>
  );
}

export function NotificationCenter() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const seenIds = useRef<Set<number>>(new Set());
  const permissionAsked = useRef(false);
  const seeded = useRef(false);
  const { notify: toast } = useToast();

  const raiseBrowserToast = useCallback(
    (title: string, body?: string) => {
      if (typeof window === "undefined" || !("Notification" in window)) return;

      const doNotify = () => {
        try {
          // eslint-disable-next-line no-new
          new window.Notification(title, { body, icon: "/favicon.ico" });
        } catch {
          // Silently ignore — some browsers deny even after permission grant.
        }
      };

      if (window.Notification.permission === "granted") {
        doNotify();
      } else if (!permissionAsked.current) {
        permissionAsked.current = true;
        window.Notification.requestPermission().then((perm) => {
          if (perm === "granted") doNotify();
        });
      }
    },
    [],
  );

  const alertNew = useCallback(
    (n: Notification) => {
      // 1. in-app toast — most portable (works without a secure context).
      toast({
        title: n.title,
        description: n.body ?? undefined,
        kind: n.kind === "reminder.due" ? "warning" : "info",
      });
      // 2. in-browser voice so remote devices hear it too. Fire-and-forget;
      //    speak() is a no-op when TTS is disabled and never throws.
      const spoken = n.body ? `${n.title}. ${n.body}` : n.title;
      void speak(spoken);
      // 3. OS notification — best-effort enhancement (secure context + granted).
      raiseBrowserToast(n.title, n.body ?? undefined);
    },
    [toast, raiseBrowserToast],
  );

  const poll = useCallback(async () => {
    try {
      const fresh = await listUnreadNotifications();
      // First poll only SEEDS the seen set: the backlog of already-unread items
      // must not trigger a toast/voice storm on every page load. Genuinely new
      // ids that arrive on later polls alert through all three channels.
      const firstRun = !seeded.current;
      for (const n of fresh) {
        if (!seenIds.current.has(n.id)) {
          seenIds.current.add(n.id);
          if (!firstRun) alertNew(n);
        }
      }
      seeded.current = true;
      setNotifications(fresh);
    } catch {
      // Backend unreachable — keep current state, don't crash.
    }
  }, [alertNew]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const handleMarkRead = useCallback(
    async (n: Notification) => {
      try {
        await markNotificationRead(n.id);
        setNotifications((prev) => prev.filter((x) => x.id !== n.id));
      } catch {
        // best-effort
      }
    },
    [],
  );

  const unreadCount = notifications.length;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        onClick={() => {
          if (!open && btnRef.current) {
            const r = btnRef.current.getBoundingClientRect();
            setDropPos({ top: r.bottom + 8, left: r.right - 300 });
          }
          setOpen((v) => !v);
        }}
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`
            : "Notifications"
        }
        className="icon-btn"
      >
        <BellIcon hasBadge={unreadCount > 0} />
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            top: dropPos?.top ?? 0,
            left: Math.max(8, dropPos?.left ?? 0),
            width: 300,
            background: "rgba(26, 27, 32, 0.92)",
            backdropFilter: "blur(30px) saturate(150%)",
            WebkitBackdropFilter: "blur(30px) saturate(150%)",
            borderRadius: 16,
            boxShadow: "var(--shadow), var(--inner-light)",
            zIndex: 100,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <strong style={{ fontSize: 13 }}>Notifications</strong>
            {unreadCount > 0 && (
              <span
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                }}
              >
                {unreadCount} unread
              </span>
            )}
          </div>

          {notifications.length === 0 ? (
            <p
              style={{
                padding: "16px 14px",
                margin: 0,
                color: "var(--muted)",
                fontSize: 13,
              }}
            >
              No new notifications
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {notifications.map((n) => (
                <li
                  key={n.id}
                  style={{
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background:
                        n.kind === "reminder.due"
                          ? "var(--rose-soft)"
                          : "var(--amber-soft)",
                      color:
                        n.kind === "reminder.due"
                          ? "var(--rose)"
                          : "var(--amber)",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      marginTop: 1,
                    }}
                  >
                    {n.kind === "reminder.due" ? "Due" : "Soon"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {n.title}
                    </div>
                    {n.body && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--muted)",
                          marginTop: 2,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {n.body}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleMarkRead(n)}
                    title="Mark as read"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--muted)",
                      fontSize: 16,
                      padding: "0 2px",
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                    aria-label={`Mark "${n.title}" as read`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
