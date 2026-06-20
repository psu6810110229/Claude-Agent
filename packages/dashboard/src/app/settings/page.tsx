"use client";

import { useState } from "react";
import { ApiError, getSettings, updateSetting } from "@/lib/api";
import { useData } from "@/lib/useData";
import { ErrorBanner } from "@/components/States";
import { useToast } from "@/components/ToastProvider";
import { SchedulePrefsPanel } from "@/components/SchedulePrefsPanel";
import type { Setting } from "@/lib/types";

function SettingsSkeleton() {
  return (
    <div className="panel">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="row"
          style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.25rem", padding: "1rem 0" }}
        >
          <div style={{ display: "flex", width: "100%", alignItems: "center", gap: "0.75rem" }}>
            <span className="skel" style={{ flex: 1, height: 18 }} />
            <span className="skel" style={{ width: 72, height: 32, flexShrink: 0 }} />
          </div>
          <span className="skel" style={{ width: "58%", height: 13 }} />
        </div>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const { notify } = useToast();
  const { data, loading, error, reload } = useData("/api/settings", getSettings);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-kicker">System</p>
          <h2>Settings</h2>
          <p className="lede">Enable or disable integrations at runtime. No restart needed.</p>
        </div>
      </header>

      {loading && <SettingsSkeleton />}
      {error && <ErrorBanner message={error} onRetry={reload} />}

      {data && (
        <div className="panel">
          {data.map((s) => (
            <SettingRow key={s.key} setting={s} onChanged={reload} notify={notify} />
          ))}
        </div>
      )}

      <section className="section" style={{ marginTop: "1.5rem" }}>
        <h3>ตั้งค่าตาราง</h3>
        <p className="lede" style={{ marginBottom: "0.75rem" }}>
          ปรับเกณฑ์ตรวจสุขภาพตาราง — เวลางาน เวลาพัก และวันที่กันไว้
        </p>
        <SchedulePrefsPanel />
      </section>
    </>
  );
}

function SettingRow({
  setting,
  onChanged,
  notify,
}: {
  setting: Setting;
  onChanged: () => void;
  notify: (toast: {
    title: string;
    description?: string;
    kind?: "success" | "info" | "warning" | "error";
  }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    if (busy || !setting.configured) return;
    setBusy(true);
    setErr(null);
    try {
      const nextEnabled = !setting.enabled;
      await updateSetting(setting.key, nextEnabled);
      onChanged();
      notify({
        kind: "success",
        title: nextEnabled ? "Enabled" : "Disabled",
        description: setting.label,
      });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
      notify({
        kind: "error",
        title: "Setting failed",
        description: e instanceof ApiError ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.25rem", padding: "1rem 0" }}>
      <div style={{ display: "flex", width: "100%", alignItems: "center", gap: "0.75rem" }}>
        <div className="grow">
          <strong>{setting.label}</strong>
          <span className={`badge ${setting.enabled ? "" : "muted"}`} style={{ marginLeft: "0.5rem" }}>
            {setting.enabled ? "enabled" : "disabled"}
          </span>
        </div>
        <button
          className={setting.enabled ? "secondary" : "primary"}
          onClick={toggle}
          disabled={busy || !setting.configured}
          title={setting.configured ? undefined : setting.description}
        >
          {busy ? "Saving…" : setting.enabled ? "Disable" : "Enable"}
        </button>
      </div>
      <div className="muted" style={{ fontSize: "0.85rem" }}>{setting.description}</div>
      {err && <div className="muted" style={{ color: "var(--color-error, #c00)", fontSize: "0.85rem" }}>{err}</div>}
    </div>
  );
}
