import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Throwaway memory dir + AI disabled before importing config-dependent modules.
const TEST_MEMORY_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "claude-agent-step23-"),
);
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_AI_ENABLED = "";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8823);
const BASE = `http://${HOST}:${PORT}`;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

// Minimal GoogleEvent factory (Bangkok +07:00 inputs).
function ev(
  id: string,
  start: string,
  end: string | null,
  opts: { location?: string | null; allDay?: boolean } = {},
): any {
  return {
    id,
    title: id,
    start,
    end,
    allDay: opts.allDay ?? false,
    location: opts.location ?? null,
    description: null,
    htmlLink: null,
    source: "google",
  };
}

function kinds(findings: any[]): Set<string> {
  return new Set(findings.map((f) => f.kind));
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 23 (schedule health) smoke test...");

  const { analyzeSchedule } = await import(
    "../src/services/scheduleHealth.js"
  );
  const { buildServer } = await import("../src/server.js");

  // --- 1. overlap (high) ---
  {
    const { findings } = analyzeSchedule([
      ev("a", "2026-06-15T09:00:00+07:00", "2026-06-15T10:00:00+07:00"),
      ev("b", "2026-06-15T09:30:00+07:00", "2026-06-15T10:30:00+07:00"),
    ]);
    const o = findings.find((f: any) => f.kind === "overlap");
    assert(o && o.severity === "high", "overlap detected as high severity");
    assert(
      o.eventIds.includes("a") && o.eventIds.includes("b"),
      "overlap names both events",
    );
  }

  // --- 2. tight_travel (high): diff location, gap < 30m ---
  {
    const { findings } = analyzeSchedule([
      ev("a", "2026-06-15T09:00:00+07:00", "2026-06-15T10:00:00+07:00", {
        location: "Office A",
      }),
      ev("b", "2026-06-15T10:15:00+07:00", "2026-06-15T11:00:00+07:00", {
        location: "Office B",
      }),
    ]);
    const t = findings.find((f: any) => f.kind === "tight_travel");
    assert(t && t.severity === "high", "tight_travel detected (diff location)");
    assert(!kinds(findings).has("no_buffer"), "tight_travel supersedes no_buffer");
  }

  // --- 3. no_buffer (medium): same/none location, gap < 10m ---
  {
    const { findings } = analyzeSchedule([
      ev("a", "2026-06-15T09:00:00+07:00", "2026-06-15T10:00:00+07:00"),
      ev("b", "2026-06-15T10:05:00+07:00", "2026-06-15T11:00:00+07:00"),
    ]);
    const n = findings.find((f: any) => f.kind === "no_buffer");
    assert(n && n.severity === "medium", "no_buffer detected as medium");
  }

  // --- 4. comfortable gap (>= buffer): no finding ---
  {
    const { findings } = analyzeSchedule([
      ev("a", "2026-06-15T09:00:00+07:00", "2026-06-15T10:00:00+07:00"),
      ev("b", "2026-06-15T11:00:00+07:00", "2026-06-15T11:30:00+07:00"),
    ]);
    assert(
      !kinds(findings).has("no_buffer") && !kinds(findings).has("overlap"),
      "comfortable 60m gap produces no conflict finding",
    );
  }

  // --- 5. long_streak (medium): continuous busy >= 4h ---
  {
    const { findings } = analyzeSchedule([
      ev("a", "2026-06-15T08:00:00+07:00", "2026-06-15T12:30:00+07:00"),
    ]);
    const s = findings.find((f: any) => f.kind === "long_streak");
    assert(s && s.severity === "medium", "long_streak detected for 4h30m block");
  }

  // --- 6. overloaded_day (medium): >= 8h busy in a day ---
  {
    const { findings } = analyzeSchedule([
      ev("a", "2026-06-15T08:00:00+07:00", "2026-06-15T12:00:00+07:00"),
      ev("b", "2026-06-15T13:00:00+07:00", "2026-06-15T17:00:00+07:00"),
    ]);
    assert(
      kinds(findings).has("overloaded_day"),
      "overloaded_day detected for 8h total",
    );
  }

  // --- 7. after_hours (low): ends after work window ---
  {
    const { findings } = analyzeSchedule([
      ev("a", "2026-06-15T20:00:00+07:00", "2026-06-15T21:00:00+07:00"),
    ]);
    const h = findings.find((f: any) => f.kind === "after_hours");
    assert(h && h.severity === "low", "after_hours detected as low");
  }

  // --- 8. weekend (low): Saturday event ---
  {
    const { findings } = analyzeSchedule([
      ev("a", "2026-06-20T10:00:00+07:00", "2026-06-20T11:00:00+07:00"),
    ]);
    const w = findings.find((f: any) => f.kind === "weekend");
    assert(w && w.severity === "low", "weekend (Saturday) detected as low");
  }

  // --- 9. all-day events skipped from time analysis ---
  {
    const { findings } = analyzeSchedule([
      ev("a", "2026-06-15", "2026-06-16", { allDay: true }),
      ev("b", "2026-06-15", "2026-06-16", { allDay: true }),
    ]);
    assert(findings.length === 0, "all-day events produce no time findings");
  }

  // --- 10. severity ranking: high sorts before low ---
  {
    const { findings } = analyzeSchedule([
      ev("w", "2026-06-20T10:00:00+07:00", "2026-06-20T11:00:00+07:00"), // weekend low
      ev("a", "2026-06-15T09:00:00+07:00", "2026-06-15T10:00:00+07:00"),
      ev("b", "2026-06-15T09:30:00+07:00", "2026-06-15T10:30:00+07:00"), // overlap high
    ]);
    assert(
      findings[0].severity === "high",
      "findings are severity-ranked (high first)",
    );
  }

  // --- 11. route: GET /api/calendar/health (stub fetcher) ---
  {
    const stubFetcher = async (): Promise<any[]> => [
      ev("a", "2026-06-15T09:00:00+07:00", "2026-06-15T10:00:00+07:00"),
      ev("b", "2026-06-15T09:30:00+07:00", "2026-06-15T10:30:00+07:00"),
    ];
    const app = buildServer({ calendarFetcher: stubFetcher });
    await app.listen({ host: HOST, port: PORT });
    try {
      const res = await fetch(`${BASE}/api/calendar/health`);
      const json: any = await res.json();
      assert(res.status === 200, "GET /api/calendar/health returns 200");
      assert(json.available === true, "route reports available: true");
      assert(
        json.findings.some((f: any) => f.kind === "overlap"),
        "route surfaces the overlap finding",
      );
    } finally {
      await app.close();
    }
  }

  // --- 12. route fails closed when fetch throws ---
  {
    const throwFetcher = async (): Promise<any[]> => {
      throw new Error("boom");
    };
    const app = buildServer({ calendarFetcher: throwFetcher });
    await app.listen({ host: HOST, port: PORT + 1 });
    try {
      const res = await fetch(`http://${HOST}:${PORT + 1}/api/calendar/health`);
      const json: any = await res.json();
      assert(
        res.status === 200 && json.available === false,
        "route fails closed (available: false) on fetch error",
      );
      assert(json.findings.length === 0, "failed-closed response has no findings");
    } finally {
      await app.close();
    }
  }

  fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });
  console.log("\nSTEP 23 SMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nSTEP 23 SMOKE FAILED:", message);
  try {
    fs.rmSync(TEST_MEMORY_DIR, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
