import { execFile } from "node:child_process";
import { DESKTOP_NOTIFICATIONS_ENABLED } from "../config.js";
import { getConfigBool } from "../db/repositories/configRepo.js";
import { logActivity } from "../db/repositories/activityRepo.js";

/**
 * Runtime gate for desktop toasts: DB config override (Settings toggle) wins;
 * falls back to the env seed default. Mirrors isAutoExecuteEnabled (actionDispatcher).
 */
export function isDesktopNotificationsEnabled(): boolean {
  const dbValue = getConfigBool("desktop_notifications_enabled");
  if (dbValue !== null) return dbValue;
  return DESKTOP_NOTIFICATIONS_ENABLED;
}

/** Escape the five XML predefined entities so title/body can't break the toast XML. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

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
    if (!isDesktopNotificationsEnabled()) return;

    // XML-escape so &, <, >, ", ' can't break the toast XML. After escaping no
    // literal single-quote remains, so the values are safe inside the PS '...' literal.
    const safeTitle = escapeXml(title);
    const safeBody = escapeXml(body ?? "");
    // PowerShell's own AUMID is registered on every Windows install, so toasts
    // reliably appear in the Action Center (an unregistered AUMID is silently dropped).
    const aumid = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

    const ps = `
[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null;
[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom,ContentType=WindowsRuntime]|Out-Null;
$x=[Windows.Data.Xml.Dom.XmlDocument]::new();
$x.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${safeTitle}</text><text>${safeBody}</text></binding></visual></toast>');
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${aumid}').Show([Windows.UI.Notifications.ToastNotification]::new($x))
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
