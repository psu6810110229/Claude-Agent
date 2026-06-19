"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Brain, Settings, User, Menu } from "lucide-react";
import { NotificationCenter } from "@/components/NotificationCenter";
import { useShell } from "@/components/Shell";

/**
 * Minimal top bar: notifications, settings, profile menu — top right only.
 * No search bar, no command bar, no toolbar clutter.
 */
export function TopBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { setDrawerOpen } = useShell();

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  return (
    <header className="topbar" ref={wrapRef}>
      <button 
        type="button" 
        className="icon-btn mobile-menu-btn" 
        onClick={() => setDrawerOpen(true)}
        aria-label="เปิดเมนู"
      >
        <Menu aria-hidden="true" strokeWidth={1.8} />
      </button>

      <div style={{ flex: 1 }} />

      <NotificationCenter />

      <Link href="/settings" className="icon-btn" aria-label="ตั้งค่า">
        <Settings aria-hidden="true" strokeWidth={1.8} />
      </Link>

      <button
        type="button"
        className="profile-chip"
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
      >
        <span className="avatar" aria-hidden="true">
          F
        </span>
        Fran
      </button>

      {menuOpen && (
        <div className="menu-pop" role="menu">
          <Link href="/memory" role="menuitem" onClick={() => setMenuOpen(false)}>
            <Brain size={15} strokeWidth={1.8} aria-hidden="true" />
            ความจำ
          </Link>
          <Link href="/settings" role="menuitem" onClick={() => setMenuOpen(false)}>
            <Settings size={15} strokeWidth={1.8} aria-hidden="true" />
            ตั้งค่า
          </Link>
          <Link href="/activity" role="menuitem" onClick={() => setMenuOpen(false)}>
            <User size={15} strokeWidth={1.8} aria-hidden="true" />
            บันทึกกิจกรรม
          </Link>
        </div>
      )}
    </header>
  );
}
