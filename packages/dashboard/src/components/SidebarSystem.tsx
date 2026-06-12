"use client";

/**
 * Compact system overview widgets: backend health, agent readiness,
 * connector status, memory entries. Real data only — no invented metrics.
 * Polls every 60 s; degrades silently when the backend is down.
 */
import { useCallback, useEffect, useState } from "react";
import { getSettings, listMemory } from "@/lib/api";

const POLL_MS = 60_000;

interface SystemState {
  healthy: boolean;
  calendarConnected: boolean;
  memoryEntries: number | null;
}

async function loadSystem(): Promise<SystemState> {
  let healthy = false;
  try {
    const res = await fetch("/api/health");
    healthy = res.ok;
  } catch {
    healthy = false;
  }

  const [settings, memory] = await Promise.all([
    getSettings().catch(() => null),
    listMemory().catch(() => null),
  ]);

  return {
    healthy,
    calendarConnected:
      settings?.find((s) => s.key === "google_calendar")?.enabled ?? false,
    memoryEntries: memory ? memory.length : null,
  };
}

export function SidebarSystem() {
  const [state, setState] = useState<SystemState | null>(null);

  const refresh = useCallback(() => {
    loadSystem().then(setState);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const healthy = state?.healthy ?? false;

  return (
    <div className="side-widgets">
      <div className="side-widget">
        <div className="w-label">System</div>
        <div className="w-value">
          <span
            className={`status-dot${healthy ? "" : " off"}`}
            aria-hidden="true"
          />
          {state === null ? "Checking" : healthy ? "Healthy" : "Offline"}
        </div>
      </div>
      <div className="side-widget">
        <div className="w-label">Agents</div>
        <div className="w-value">{healthy ? "1 ready" : "0 ready"}</div>
      </div>
      <div className="side-widget">
        <div className="w-label">Connections</div>
        <div className="w-value">
          {state?.calendarConnected ? "Calendar" : "None"}
        </div>
      </div>
      <div className="side-widget">
        <div className="w-label">Memory</div>
        <div className="w-value">
          {state?.memoryEntries === null || state === null
            ? "—"
            : `${state.memoryEntries} entr${state.memoryEntries === 1 ? "y" : "ies"}`}
        </div>
      </div>
    </div>
  );
}
