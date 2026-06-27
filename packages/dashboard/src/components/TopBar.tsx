"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Brain, Settings, User, Menu, RotateCcw } from "lucide-react";
import { NotificationCenter } from "@/components/NotificationCenter";
import { useShell } from "@/components/Shell";

/**
 * Minimal top bar: notifications, settings, profile menu — top right only.
 * No search bar, no command bar, no toolbar clutter.
 */
export function TopBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { drawerOpen, setDrawerOpen, collapsed, setCollapsed, newSession } = useShell();

  // One button, two behaviors: open the slide-in drawer on mobile, collapse the
  // sticky sidebar on desktop.
  const onMenuClick = () => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 980px)").matches) {
      setDrawerOpen(true);
    } else {
      setCollapsed(!collapsed);
    }
  };

  useEffect(() => {
    if (!menuOpen) return;
    const raf = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    // Escape closes the menu and returns focus to the chip that opened it.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        chipRef.current?.focus();
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="topbar" ref={wrapRef}>
      <button
        type="button"
        className="icon-btn menu-btn"
        onClick={onMenuClick}
        aria-label="เปิดเมนู"
        aria-controls="app-sidebar"
        aria-expanded={drawerOpen || !collapsed}
      >
        <Menu aria-hidden="true" strokeWidth={1.8} />
      </button>

      <div style={{ flex: 1 }} />

      {newSession && (
        <button
          type="button"
          className="topbar-session-btn"
          onClick={newSession.onClick}
          disabled={newSession.disabled}
          title="เก็บบทสนทนานี้เข้าคลัง — ข้อความเก่ายังอยู่ในฐานข้อมูล แต่จะไม่ถูกส่งให้ Claude"
        >
          <RotateCcw aria-hidden="true" strokeWidth={1.8} />
          <span>{newSession.busy ? "กำลังรีเซ็ต..." : "เริ่มใหม่"}</span>
        </button>
      )}

      <NotificationCenter />

      <Link href="/settings" className="icon-btn" aria-label="ตั้งค่า">
        <Settings aria-hidden="true" strokeWidth={1.8} />
      </Link>

      <button
        ref={chipRef}
        type="button"
        className="profile-chip"
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-controls={menuOpen ? "topbar-profile-menu" : undefined}
      >
        <span className="avatar" aria-hidden="true">
          F
        </span>
        Fran
      </button>

      {menuOpen && (
        <div
          ref={menuRef}
          id="topbar-profile-menu"
          className="menu-pop"
          role="menu"
          aria-label="เมนูโปรไฟล์"
        >
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
