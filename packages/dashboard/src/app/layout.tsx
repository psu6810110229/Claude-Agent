import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { SidebarSchedule } from "@/components/SidebarSchedule";
import { SidebarSystem } from "@/components/SidebarSystem";
import "./globals.css";

export const metadata: Metadata = {
  title: "J.A.R.V.I.S",
  description: "Personal AI operating system",
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
        <div className="shell">
          <Sidebar schedule={<SidebarSchedule />} system={<SidebarSystem />} />
          <div className="content">
            <TopBar />
            <main className="main">
              <div className="main-inner">{children}</div>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
