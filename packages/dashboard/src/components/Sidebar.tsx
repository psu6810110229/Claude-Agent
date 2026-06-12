"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  CheckCircle2,
  FolderKanban,
  Files,
  Home,
  ListTodo,
  MessageCircle,
  NotebookPen,
  Brain,
  CalendarDays,
} from "lucide-react";

const LINKS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/approvals", label: "Approvals", icon: CheckCircle2 },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/upcoming", label: "Upcoming", icon: CalendarDays },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/files", label: "File Explorer", icon: Files },
  { href: "/notepad", label: "Notepad", icon: NotebookPen },
  { href: "/projects", label: "Projects", icon: FolderKanban },
];

export function Sidebar({
  schedule,
  system,
}: {
  /** Today's schedule timeline (slot filled in by layout). */
  schedule?: React.ReactNode;
  /** System overview widgets (slot filled in by layout). */
  system?: React.ReactNode;
}) {
  const pathname = usePathname();

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
            >
              <Icon aria-hidden="true" strokeWidth={1.8} />
              {l.label}
            </Link>
          );
        })}
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

      <hr className="side-divider" />

      <div className="profile-card">
        <div className="avatar" aria-hidden="true">
          F
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="p-name">Fran</div>
          <div className="p-status">
            <span className="status-dot" aria-hidden="true" />
            All systems operational
          </div>
        </div>
      </div>
    </aside>
  );
}
