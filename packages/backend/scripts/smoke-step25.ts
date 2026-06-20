import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Throwaway memory dir + AI disabled before importing config-dependent modules.
const TEST_MEMORY_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "claude-agent-step25-"),
);
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_AI_ENABLED = "";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8825);

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

// Minimal GoogleEvent factory (Bangkok +07:00 inputs).
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

/** Stub invoker that returns a fixed raw string (mimics a provider response). */
function fixedInvoker(raw: string) {
  return async () => raw;
}

async function postFix(port: number): Promise<{ status: number; json: any }> {
  const res = await fetch(`http://${HOST}:${port}/api/calendar/fix-proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return { status: res.status, json: await res.json() };
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 25 (Tier 2 schedule fixes) smoke test...");

  const { initDb } = await import("../src/db/init.js");
  const { closeDb } = await import("../src/db/connection.js");
  const { buildServer } = await import("../src/server.js");
  const { listPendingApprovals } = await import(
    "../src/db/repositories/approvalRepo.js"
  );
  const { setConfigBool } = await import(
    "../src/db/repositories/configRepo.js"
  );

  initDb();

  // Two overlapping events → Tier 1 emits an overlap finding.
  const overlapping = [
    ev("evt-a", "2026-06-22T09:00:00+07:00", "2026-06-22T10:00:00+07:00"),
    ev("evt-b", "2026-06-22T09:30:00+07:00", "2026-06-22T10:30:00+07:00"),
  ];

  // --- 1. happy path: AI proposes a valid move → queued as a PENDING approval ---
  {
    // Move evt-b to 10:30–11:30 Bangkok = 03:30–04:30Z. Targets a real id.
    const aiRaw = JSON.stringify({
      proposals: [
        {
          payload: {
            id: "evt-b",
            starts_at: "2026-06-22T03:30:00.000Z",
            ends_at: "2026-06-22T04:30:00.000Z",
          },
          reason: "Move evt-b 60 min later to clear the overlap with evt-a.",
          finding_ref: 0,
        },
      ],
    });
    const app = buildServer({
      calendarFetcher: async () => overlapping,
      aiInvoker: fixedInvoker(aiRaw),
    });
    await app.listen({ host: HOST, port: PORT });
    try {
      const { status, json } = await postFix(PORT);
      assert(status === 200, "POST /fix-proposals returns 200");
      assert(json.available === true, "available: true when calendar ok");
      assert(json.proposals.length === 1, "one proposal returned");
      const p = json.proposals[0];
      assert(
        p.actionType === "google_event.update" && p.payload.id === "evt-b",
        "proposal is a google_event.update targeting the real event id",
      );
      assert(
        p.findingKind === "overlap" && p.eventTitle === "evt-b" && !!p.reason,
        "proposal carries findingKind, eventTitle and a reason",
      );
      assert(typeof p.approvalId === "number", "proposal has an approvalId");

      const pending = listPendingApprovals();
      const row = pending.find((a: any) => a.id === p.approvalId);
      assert(
        !!row && row.status === "pending" &&
          row.execution_status === "not_started",
        "approval is PENDING and not executed",
      );
      assert(
        row.action_type === "google_event.update",
        "queued approval is a google_event.update",
      );
    } finally {
      await app.close();
    }
  }

  // --- 2. force-pending even with auto-execute ON (no auto-reschedule) ---
  {
    setConfigBool("auto_execute_enabled", true);
    const aiRaw = JSON.stringify({
      proposals: [
        {
          payload: {
            id: "evt-b",
            starts_at: "2026-06-22T03:30:00.000Z",
            ends_at: "2026-06-22T04:30:00.000Z",
          },
          reason: "Shift evt-b to resolve overlap.",
          finding_ref: 0,
        },
      ],
    });
    const app = buildServer({
      calendarFetcher: async () => overlapping,
      aiInvoker: fixedInvoker(aiRaw),
    });
    await app.listen({ host: HOST, port: PORT + 1 });
    try {
      const { json } = await postFix(PORT + 1);
      assert(json.proposals.length === 1, "proposal queued with auto-exec ON");
      const row = listPendingApprovals().find(
        (a: any) => a.id === json.proposals[0].approvalId,
      );
      assert(
        !!row && row.status === "pending",
        "google_event.update stays PENDING despite auto-execute ON",
      );
    } finally {
      await app.close();
    }
    setConfigBool("auto_execute_enabled", false);
  }

  // --- 3. fabricated/unknown target id is dropped (never queued) ---
  {
    const aiRaw = JSON.stringify({
      proposals: [
        {
          payload: {
            id: "does-not-exist",
            starts_at: "2026-06-22T03:30:00.000Z",
            ends_at: "2026-06-22T04:30:00.000Z",
          },
          reason: "Move a phantom event.",
        },
      ],
    });
    const app = buildServer({
      calendarFetcher: async () => overlapping,
      aiInvoker: fixedInvoker(aiRaw),
    });
    await app.listen({ host: HOST, port: PORT + 2 });
    try {
      const { json } = await postFix(PORT + 2);
      assert(
        json.available === true && json.proposals.length === 0,
        "proposal targeting an unknown id is dropped",
      );
    } finally {
      await app.close();
    }
  }

  // --- 4. no findings → no AI call, empty proposals ---
  {
    let called = false;
    const app = buildServer({
      // Single non-conflicting event → no findings.
      calendarFetcher: async () => [
        ev("solo", "2026-06-23T10:00:00+07:00", "2026-06-23T11:00:00+07:00"),
      ],
      aiInvoker: async () => {
        called = true;
        return "{}";
      },
    });
    await app.listen({ host: HOST, port: PORT + 3 });
    try {
      const { json } = await postFix(PORT + 3);
      assert(
        json.available === true && json.proposals.length === 0,
        "no findings → empty proposals",
      );
      assert(!called, "AI is NOT invoked when there are no findings");
    } finally {
      await app.close();
    }
  }

  // --- 5. calendar fetch error → fail closed (available: false) ---
  {
    const app = buildServer({
      calendarFetcher: async () => {
        throw new Error("boom");
      },
      aiInvoker: fixedInvoker("{}"),
    });
    await app.listen({ host: HOST, port: PORT + 4 });
    try {
      const { json } = await postFix(PORT + 4);
      assert(
        json.available === false && json.proposals.length === 0,
        "calendar error → available: false, no proposals",
      );
    } finally {
      await app.close();
    }
  }

  // --- 6. invalid AI JSON → fail closed (200, empty proposals, notes set) ---
  {
    const app = buildServer({
      calendarFetcher: async () => overlapping,
      aiInvoker: fixedInvoker("not json at all"),
    });
    await app.listen({ host: HOST, port: PORT + 5 });
    try {
      const { status, json } = await postFix(PORT + 5);
      assert(
        status === 200 && json.available === true && json.proposals.length === 0,
        "invalid AI output → 200 with no proposals",
      );
      assert(typeof json.notes === "string", "a notes line explains the empty result");
    } finally {
      await app.close();
    }
  }

  closeDb();
  fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });
  console.log("\nSTEP 25 SMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSTEP 25 SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
