"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/tasks", label: "Tasks" },
  { href: "/approvals", label: "Approvals" },
  { href: "/memory", label: "Memory" },
  { href: "/activity", label: "Activity" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={pathname === l.href ? "active" : ""}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
