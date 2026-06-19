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
import { usePathname } from "next/navigation";
import {
  listUnreadNotifications,
  markNotificationRead,
  speak,
} from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import type { Notification } from "@/lib/types";

const DROPDOWN_WIDTH = 300;

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
  const dropRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef<Set<number>>(new Set());
  const permissionAsked = useRef(false);
  const seeded = useRef(false);
  const { notify: toast } = useToast();
  const pathname = usePathname();

  // Anchor the fixed-position dropdown under the bell button.
  const reposition = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setDropPos({ top: r.bottom + 8, left: r.right - DROPDOWN_WIDTH });
  }, []);
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

  // Close on route change so a stale dropdown never lingers across navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // While open: outside-click + Escape dismissal, and keep the fixed dropdown
  // anchored to the bell as the page scrolls or the viewport resizes.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (dropRef.current?.contains(target) || btnRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

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
          if (!open) reposition();
          setOpen((v) => !v);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          unreadCount > 0
            ? `การแจ้งเตือน ยังไม่อ่าน ${unreadCount} รายการ`
            : "การแจ้งเตือน"
        }
        className="icon-btn"
      >
        <BellIcon hasBadge={unreadCount > 0} />
      </button>

      {open && (
        <div
          ref={dropRef}
          role="dialog"
          aria-label="การแจ้งเตือน"
          style={{
            position: "fixed",
            top: dropPos?.top ?? 0,
            left: Math.max(8, dropPos?.left ?? 0),
            width: DROPDOWN_WIDTH,
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
            <strong style={{ fontSize: 13 }}>การแจ้งเตือน</strong>
            {unreadCount > 0 && (
              <span
                style={{
                  fontSize: 11,
                  color: "var(--muted-strong)",
                }}
              >
                ยังไม่อ่าน {unreadCount}
              </span>
            )}
          </div>

          {notifications.length === 0 ? (
            <p
              style={{
                padding: "16px 14px",
                margin: 0,
                color: "var(--muted-strong)",
                fontSize: 13,
              }}
            >
              ไม่มีการแจ้งเตือนใหม่
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
                    {n.kind === "reminder.due" ? "ถึงกำหนด" : "ใกล้ถึง"}
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
                    title="ทำเครื่องหมายว่าอ่านแล้ว"
                    style={{
                      display: "grid",
                      placeItems: "center",
                      width: 44,
                      height: 44,
                      margin: "-12px -10px -12px 0",
                      background: "none",
                      border: "none",
                      borderRadius: 10,
                      cursor: "pointer",
                      color: "var(--muted-strong)",
                      fontSize: 18,
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                    aria-label={`ทำเครื่องหมายว่าอ่านแล้ว: ${n.title}`}
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
