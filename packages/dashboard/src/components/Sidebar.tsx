"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { preload } from "swr";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  FolderKanban,
  Files,
  Home,
  HardDrive,
  ListTodo,
  Mail,
  NotebookPen,
  Brain,
  CalendarDays,
} from "lucide-react";
import {
  getCalendarUpcoming,
  getChatHistory,
  getDriveFiles,
  getGmailUnread,
  getSettings,
  listActivity,
  listApprovals,
  listEvents,
  listMemory,
  listReminders,
  listTasks,
} from "@/lib/api";

/** Matches keys used in useData() calls in each page. */
const PRELOADERS: Record<string, () => void> = {
  "/":          () => preload("/api/chat/history", () => getChatHistory(100)),
  "/tasks":     () => preload("/api/tasks",    listTasks),
  "/approvals": () => preload("/api/approvals", listApprovals),
  "/activity":  () => preload("/api/activity",  () => listActivity(100)),
  "/settings":  () => preload("/api/settings",  getSettings),
  "/memory":    () => preload("/api/memory",    listMemory),
  "/gmail":     () => preload("/api/gmail/unread", getGmailUnread),
  "/drive":     () => preload("/api/drive/files", () => getDriveFiles()),
  "/upcoming":  () =>
    preload("/api/upcoming", () =>
      Promise.all([getCalendarUpcoming(), listEvents(), listReminders()]).then(
        ([calendar, events, reminders]) => ({ calendar, events, reminders }),
      ),
    ),
};

const LINKS = [
  { href: "/",          label: "หน้าหลัก",      icon: Home          },
  { href: "/approvals", label: "การอนุมัติ",    icon: CheckCircle2  },
];

const MORE_LINKS = [
  { href: "/tasks",     label: "งาน",           icon: ListTodo      },
  { href: "/activity",  label: "กิจกรรม",       icon: Activity      },
  { href: "/upcoming",  label: "กำหนดการ",      icon: CalendarDays  },
  { href: "/gmail",     label: "Gmail",         icon: Mail          },
  { href: "/drive",     label: "Drive",         icon: HardDrive     },
  { href: "/memory",    label: "ความจำ",        icon: Brain         },
  { href: "/files",     label: "ไฟล์",          icon: Files         },
  { href: "/notepad",   label: "โน้ต",          icon: NotebookPen   },
  { href: "/projects",  label: "โปรเจกต์",      icon: FolderKanban  },
];

export function Sidebar({
  schedule,
  system,
}: {
  schedule?: React.ReactNode;
  system?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  // On mobile the "เพิ่มเติม" collapse is dropped — every link shows in one
  // vertical column. Track the breakpoint so the toggle is hidden and the
  // secondary links stay expanded (and keyboard-reachable).
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 980px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const secondaryActive = MORE_LINKS.some((l) => pathname === l.href);
  const showMore = isMobile || expanded || secondaryActive;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-orb" aria-hidden="true" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>Friday</h1>
          <div className="status-line">
            <span className="status-dot" aria-hidden="true" />
            ออนไลน์
          </div>
        </div>
      </div>

      <nav className="nav" aria-label="Primary">
        {LINKS.map((l) => {
          const Icon = l.icon;
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={active ? "active" : ""}
              aria-current={active ? "page" : undefined}
              onMouseEnter={() => PRELOADERS[l.href]?.()}
            >
              <Icon aria-hidden="true" strokeWidth={1.8} />
              {l.label}
            </Link>
          );
        })}

        {!isMobile && (
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={showMore}
            aria-controls="sidebar-more-nav"
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDown aria-hidden="true" strokeWidth={1.8} />
            เพิ่มเติม
          </button>
        )}

        <div
          id="sidebar-more-nav"
          className={`nav-more ${showMore ? "open" : ""}`}
          aria-hidden={!showMore}
        >
          <div className="nav-more-inner">
            {MORE_LINKS.map((l) => {
              const Icon = l.icon;
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={active ? "active" : ""}
                  aria-current={active ? "page" : undefined}
                  tabIndex={showMore ? undefined : -1}
                  onMouseEnter={() => PRELOADERS[l.href]?.()}
                >
                  <Icon aria-hidden="true" strokeWidth={1.8} />
                  {l.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {schedule && (
        <>
          <hr className="side-divider" />
          <p className="side-label">ตารางวันนี้</p>
          {schedule}
        </>
      )}

      {system && (
        <>
          <hr className="side-divider" />
          <p className="side-label">ภาพรวมระบบ</p>
          {system}
        </>
      )}

    </aside>
  );
}
