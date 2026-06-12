"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { preload } from "swr";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  FolderKanban,
  Files,
  Home,
  ListTodo,
  NotebookPen,
  Brain,
  CalendarDays,
} from "lucide-react";
import {
  getCalendarUpcoming,
  getChatHistory,
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
  "/upcoming":  () =>
    preload("/api/upcoming", () =>
      Promise.all([getCalendarUpcoming(), listEvents(), listReminders()]).then(
        ([calendar, events, reminders]) => ({ calendar, events, reminders }),
      ),
    ),
};

const LINKS = [
  { href: "/",          label: "Home",          icon: Home          },
  { href: "/approvals", label: "Approvals",     icon: CheckCircle2  },
];

const MORE_LINKS = [
  { href: "/tasks",     label: "Tasks",         icon: ListTodo      },
  { href: "/activity",  label: "Activity",      icon: Activity      },
  { href: "/upcoming",  label: "Upcoming",      icon: CalendarDays  },
  { href: "/memory",    label: "Memory",        icon: Brain         },
  { href: "/files",     label: "File Explorer", icon: Files         },
  { href: "/notepad",   label: "Notepad",       icon: NotebookPen   },
  { href: "/projects",  label: "Projects",      icon: FolderKanban  },
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
  const secondaryActive = MORE_LINKS.some((l) => pathname === l.href);
  const showMore = expanded || secondaryActive;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-orb" aria-hidden="true" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>J.A.R.V.I.S</h1>
          <div className="status-line">
            <span className="status-dot" aria-hidden="true" />
            Online
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

        <button
          type="button"
          className="nav-toggle"
          aria-expanded={showMore}
          aria-controls="sidebar-more-nav"
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown aria-hidden="true" strokeWidth={1.8} />
          More
        </button>

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
          <p className="side-label">Today&apos;s Schedule</p>
          {schedule}
        </>
      )}

      {system && (
        <>
          <hr className="side-divider" />
          <p className="side-label">System Overview</p>
          {system}
        </>
      )}

    </aside>
  );
}
