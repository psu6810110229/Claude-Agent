import { execFile } from "node:child_process";
import { DESKTOP_NOTIFICATIONS_ENABLED } from "../config.js";
import { logActivity } from "../db/repositories/activityRepo.js";

/**
 * Abstraction for firing a native desktop toast. Injectable so the smoke test
 * can pass a stub — the real PowerShell call is never reached in tests.
 */
export interface DesktopNotifier {
  notify(title: string, body?: string): void;
}

/**
 * No-op stub: records calls. Used by smoke tests and as the fallback when
 * DESKTOP_NOTIFICATIONS_ENABLED is off.
 */
export class StubDesktopNotifier implements DesktopNotifier {
  readonly calls: Array<{ title: string; body?: string }> = [];
  notify(title: string, body?: string): void {
    this.calls.push({ title, body });
  }
}

/**
 * Windows desktop toast via PowerShell WinRT (no Store app ID required).
 * Spawns a detached, windowless PowerShell process — fire-and-forget.
 * Gated by DESKTOP_NOTIFICATIONS_ENABLED; fails soft (logs + swallows).
 */
class RealDesktopNotifier implements DesktopNotifier {
  notify(title: string, body?: string): void {
    if (!DESKTOP_NOTIFICATIONS_ENABLED) return;

    // Sanitise: strip single-quotes so they can't break the PS string literal.
    const safeTitle = title.replace(/'/g, "’");
    const safeBody = (body ?? "").replace(/'/g, "’");
    const message = safeBody ? `${safeTitle}: ${safeBody}` : safeTitle;

    const ps = `
[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null;
[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom,ContentType=WindowsRuntime]|Out-Null;
$x=[Windows.Data.Xml.Dom.XmlDocument]::new();
$x.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${safeTitle}</text><text>${message}</text></binding></visual></toast>');
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claude_Agent').Show([Windows.UI.Notifications.ToastNotification]::new($x))
`.trim();

    execFile(
      "powershell.exe",
      ["-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps],
      { timeout: 8000, windowsHide: true },
      (err) => {
        if (err) {
          const detail = err.message;
          try {
            logActivity("notification.desktop_failed", detail);
          } catch {
            // best-effort
          }
        }
      },
    );
  }
}

export const realDesktopNotifier: DesktopNotifier = new RealDesktopNotifier();
