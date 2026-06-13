import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { SidebarSchedule } from "@/components/SidebarSchedule";
import { SidebarSystem } from "@/components/SidebarSystem";
import { Prefetcher } from "@/components/Prefetcher";
import { ToastProvider } from "@/components/ToastProvider";
import { Shell } from "@/components/Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "J.A.R.V.I.S",
  description: "Personal AI operating system",
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
          attributes onto <html>/<body> before React hydrates, which otherwise
          trips a hydration mismatch. This suppresses only these elements'
          attribute diffs, not their children. */}
      <body suppressHydrationWarning>
        <ToastProvider>
          <Shell>
            <Prefetcher />
            <Sidebar schedule={<SidebarSchedule />} system={<SidebarSystem />} />
            <div className="content">
              <TopBar />
              <main className="main">
                <div className="main-inner">{children}</div>
              </main>
            </div>
          </Shell>
        </ToastProvider>
      </body>
    </html>
  );
}
