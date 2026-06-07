"use client";

import { useState } from "react";
import { ApiError, getSettings, updateSetting } from "@/lib/api";
import { useResource } from "@/lib/useResource";
import { Loading, ErrorBanner } from "@/components/States";
import type { Setting } from "@/lib/types";

export default function SettingsPage() {
  const { data, loading, error, reload } = useResource(getSettings);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-kicker">System</p>
          <h2>Settings</h2>
          <p className="lede">Enable or disable integrations at runtime. No restart needed.</p>
        </div>
      </header>

      {loading && <Loading />}
      {error && <ErrorBanner message={error} onRetry={reload} />}

      {data && (
        <div className="panel">
          {data.map((s) => (
            <SettingRow key={s.key} setting={s} onChanged={reload} />
          ))}
        </div>
      )}
    </>
  );
}

function SettingRow({
  setting,
  onChanged,
}: {
  setting: Setting;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    if (busy || !setting.configured) return;
    setBusy(true);
    setErr(null);
    try {
      await updateSetting(setting.key, !setting.enabled);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
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
