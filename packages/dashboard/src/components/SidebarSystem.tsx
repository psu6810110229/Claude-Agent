"use client";

/** Compact system overview widgets. Live data wired in Sprint 3. */
export function SidebarSystem() {
  return (
    <div className="side-widgets">
      <div className="side-widget">
        <div className="w-label">System</div>
        <div className="w-value">
          <span className="status-dot" aria-hidden="true" />
          Checking
        </div>
      </div>
      <div className="side-widget">
        <div className="w-label">Agents</div>
        <div className="w-value">—</div>
      </div>
      <div className="side-widget">
        <div className="w-label">Connections</div>
        <div className="w-value">—</div>
      </div>
      <div className="side-widget">
        <div className="w-label">Memory</div>
        <div className="w-value">—</div>
      </div>
    </div>
  );
}
