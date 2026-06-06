import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude_Agent",
  description: "Local-first Personal Agent OS dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
          attributes onto <body> before React hydrates, which otherwise trips a
          dev-only hydration mismatch. This suppresses only this element's
          attribute diff, not its children. */}
      <body suppressHydrationWarning>
        <div className="layout">
          <aside className="sidebar">
            <div className="brand">
              <div className="brand-mark" aria-hidden="true">
                CA
              </div>
              <div>
                <h1>Claude_Agent</h1>
                <p>Personal Agent OS</p>
              </div>
            </div>
            <Nav />
          </aside>
          <main className="main">
            <div className="main-inner">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
