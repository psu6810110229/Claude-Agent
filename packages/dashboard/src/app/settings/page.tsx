"use client";

import { useState } from "react";
import { ApiError, getSettings, updateSetting } from "@/lib/api";
import { useData } from "@/lib/useData";
import { ErrorBanner } from "@/components/States";
import { useToast } from "@/components/ToastProvider";
import { SchedulePrefsPanel } from "@/components/SchedulePrefsPanel";
import { Button } from "@/components/ui/Button";
import type { Setting } from "@/lib/types";

function SettingsSkeleton() {
  return (
    <div className="panel">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="row setting-row">
          <div className="setting-row-inner">
            <span className="skel setting-skel-label" />
            <span className="skel setting-skel-btn" />
          </div>
          <span className="skel setting-skel-desc" />
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

      <section className="section setting-schedule">
        <h3>ตั้งค่าตาราง</h3>
        <p className="lede setting-schedule-lede">
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
    <div className="row setting-row">
      <div className="setting-row-inner">
        <div className="grow">
          <strong>{setting.label}</strong>
          <span className={`badge setting-badge ${setting.enabled ? "" : "muted"}`}>
            {setting.enabled ? "enabled" : "disabled"}
          </span>
        </div>
        <Button
          variant={setting.enabled ? "secondary" : "primary"}
          size="sm"
          loading={busy}
          disabled={!setting.configured}
          title={setting.configured ? undefined : setting.description}
          onClick={toggle}
        >
          {setting.enabled ? "Disable" : "Enable"}
        </Button>
      </div>
      <div className="muted setting-desc">{setting.description}</div>
      {err && <div className="setting-error">{err}</div>}
    </div>
  );
}
