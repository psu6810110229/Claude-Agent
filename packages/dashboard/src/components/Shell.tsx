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
