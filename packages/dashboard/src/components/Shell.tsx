"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { usePathname } from "next/navigation";

const ShellContext = createContext({
  drawerOpen: false,
  setDrawerOpen: (v: boolean) => {}
});

export function useShell() {
  return useContext(ShellContext);
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // close drawer on navigation
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

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
    <ShellContext.Provider value={{ drawerOpen, setDrawerOpen }}>
      <div className={`shell ${drawerOpen ? 'drawer-open' : ''}`}>
        {children}
        {drawerOpen && (
          <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
        )}
      </div>
    </ShellContext.Provider>
  );
}
