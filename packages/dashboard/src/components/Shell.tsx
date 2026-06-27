"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/** Lets the chat page surface its "เริ่มใหม่" control in the global TopBar. */
export interface NewSessionControl {
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
}

const ShellContext = createContext<{
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
  newSession: NewSessionControl | null;
  setNewSession: (c: NewSessionControl | null) => void;
}>({
  drawerOpen: false,
  setDrawerOpen: () => {},
  newSession: null,
  setNewSession: () => {},
});

export function useShell() {
  return useContext(ShellContext);
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newSession, setNewSession] = useState<NewSessionControl | null>(null);
  const drawerReturnFocus = useRef<HTMLElement | null>(null);
  const pathname = usePathname();

  // close drawer on navigation
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    drawerReturnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sidebar = document.querySelector<HTMLElement>(".sidebar");
    document.body.classList.add("drawer-lock");
    sidebar?.focus({ preventScroll: true });

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDrawerOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("drawer-lock");
      drawerReturnFocus.current?.focus({ preventScroll: true });
      drawerReturnFocus.current = null;
    };
  }, [drawerOpen]);

  // Keep the sticky bottom dock above the on-screen keyboard on iOS Safari,
  // where the layout viewport does not shrink when the keyboard opens. We
  // measure visualViewport and expose the covered height as --kb; CSS lifts
  // the dock by that amount. Other platforms report 0 and are unaffected.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--kb", `${Math.round(inset)}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty("--kb");
    };
  }, []);

  return (
    <ShellContext.Provider value={{ drawerOpen, setDrawerOpen, newSession, setNewSession }}>
      <div className={`shell ${drawerOpen ? 'drawer-open' : ''}`}>
        {children}
        {drawerOpen && (
          <div
            className="drawer-backdrop"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
        )}
      </div>
    </ShellContext.Provider>
  );
}
