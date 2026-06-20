import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Throwaway memory dir + AI disabled before importing config-dependent modules.
const TEST_MEMORY_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "claude-agent-step26-"),
);
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_AI_ENABLED = "";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8826);

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

function ev(id: string, start: string, end: string): any {
  return {
    id,
    title: id,
    start,
    end,
    allDay: false,
    location: null,
    description: null,
    htmlLink: null,
    source: "google",
  };
}

const NEW = {
  title: "ประชุม B",
  starts_at: "2026-06-22T09:00:00.000Z",
  ends_at: "2026-06-22T10:00:00.000Z",
};

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 26 (create-time conflict warning) smoke test...");

  const { initDb } = await import("../src/db/init.js");
  const { closeDb } = await import("../src/db/connection.js");
  const { buildServer } = await import("../src/server.js");
  const { findCreateConflicts } = await import(
    "../src/services/eventConflicts.js"
  );
  const { DEFAULT_SCHEDULE_HEALTH_OPTIONS } = await import(
    "../src/services/scheduleHealth.js"
  );
  const { dispatchProposedAction } = await import(
    "../src/services/actionDispatcher.js"
  );
  const { createApproval, listPendingApprovals } = await import(
    "../src/db/repositories/approvalRepo.js"
  );
  const { setConfigBool } = await import(
    "../src/db/repositories/configRepo.js"
  );

  initDb();

  // --- 1. findCreateConflicts: overlap detected, names the existing event ---
  {
    const existing = [
      ev("A", "2026-06-22T09:30:00.000Z", "2026-06-22T10:30:00.000Z"),
    ];
    const conflicts = findCreateConflicts(
      NEW,
      existing,
      DEFAULT_SCHEDULE_HEALTH_OPTIONS,
    );
    assert(
      conflicts.length === 1 && conflicts[0].kind === "overlap",
      "overlap with an existing event is detected",
    );
    assert(conflicts[0].withTitle === "A", "conflict names the existing event");
  }

  // --- 2. no clash when the new event is comfortably clear ---
  {
    const existing = [
      ev("A", "2026-06-22T14:00:00.000Z", "2026-06-22T15:00:00.000Z"),
    ];
    const conflicts = findCreateConflicts(
      NEW,
      existing,
      DEFAULT_SCHEDULE_HEALTH_OPTIONS,
    );
    assert(conflicts.length === 0, "no conflict for a clear slot");
  }

  // --- 3. dispatcher FORCES pending on a clashing create, even auto-exec ON ---
  {
    setConfigBool("auto_execute_enabled", true);

    // Sanity: a non-create action really DOES auto-execute (proves auto-exec on).
    const t = await dispatchProposedAction(
      "task.create",
      { title: "auto task" },
      "test",
    );
    assert(t.mode === "executed", "task.create auto-executes (auto-exec is ON)");

    // A create with a clash must be held pending (never silently executed).
    const stubChecker = async () => [
      {
        kind: "overlap" as const,
        severity: "high" as const,
        withTitle: "A",
        detail: "overlap 30m",
        startUtc: NEW.starts_at,
        endUtc: NEW.ends_at,
      },
    ];
    const d = await dispatchProposedAction("google_event.create", NEW, "test", {
      conflictChecker: stubChecker,
    });
    assert(d.mode === "pending", "clashing create is held PENDING despite auto-exec ON");
    assert(d.conflicts.length === 1, "dispatch result carries the conflict");

    setConfigBool("auto_execute_enabled", false);
  }

  // --- 4. GET /api/approvals recomputes conflicts for pending creates ---
  {
    // Pending create row whose time overlaps the stubbed calendar event.
    const pendingCreate = createApproval("google_event.create", NEW);
    const stubFetcher = async (): Promise<any[]> => [
      ev("A", "2026-06-22T09:30:00.000Z", "2026-06-22T10:30:00.000Z"),
    ];
    const app = buildServer({ calendarFetcher: stubFetcher });
    await app.listen({ host: HOST, port: PORT });
    try {
      const res = await fetch(`http://${HOST}:${PORT}/api/approvals`);
      const json: any = await res.json();
      assert(res.status === 200, "GET /api/approvals returns 200");
      assert(
        Array.isArray(json.approvals) && typeof json.conflicts === "object",
        "response carries approvals + a conflicts map",
      );
      const c = json.conflicts[String(pendingCreate.id)];
      assert(
        Array.isArray(c) && c.length === 1 && c[0].withTitle === "A",
        "pending create row is flagged as conflicting with the existing event",
      );
    } finally {
      await app.close();
    }
  }

  // --- 5. fail-closed: calendar error → no conflicts, no route error ---
  {
    const throwFetcher = async (): Promise<any[]> => {
      throw new Error("boom");
    };
    const app = buildServer({ calendarFetcher: throwFetcher });
    await app.listen({ host: HOST, port: PORT + 1 });
    try {
      const res = await fetch(`http://${HOST}:${PORT + 1}/api/approvals`);
      const json: any = await res.json();
      assert(
        res.status === 200 && Object.keys(json.conflicts).length === 0,
        "calendar error → empty conflicts map, route still 200",
      );
    } finally {
      await app.close();
    }
  }

  // confirm the pending create is still queued (never auto-executed away)
  {
    const pend = listPendingApprovals().filter(
      (a: any) => a.action_type === "google_event.create",
    );
    assert(pend.length >= 1, "clashing create remains in the pending queue");
  }

  closeDb();
  fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });
  console.log("\nSTEP 26 SMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSTEP 26 SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
