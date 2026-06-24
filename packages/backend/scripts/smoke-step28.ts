import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Tiny TTLs BEFORE importing config so the env-backed consts pick them up — lets
// the test cross the freshness boundary with a few ms of sleep, no real waiting.
process.env.GCAL_CACHE_TTL_TODAY_MS = "20";
process.env.GCAL_CACHE_TTL_UPCOMING_MS = "20";
process.env.GCAL_CACHE_MIN_FRESH_MS = "15";
const TEST_MEMORY_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "claude-agent-step28-"),
);
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_DB_PATH = path.join(TEST_MEMORY_DIR, "test.db");
process.env.CLAUDE_AGENT_AI_ENABLED = "";

/**
 * Step 28 — Google Calendar cache (S2) smoke test.
 *
 * Exercises the L1 SWR / L2 force-fresh / L3 invalidate behaviors of
 * `createGoogleCache` against a counting stub fetcher. No real Google call.
 *
 * Cases: cold miss fetches once; warm hit = 0 fetches; stale serves old + bg
 * refetch; concurrent revalidate deduped to one in-flight; L2 primeFresh forces
 * fresh but burst-reuses within MIN_FRESH; invalidate forces next-read refetch;
 * refetch throw keeps old cache (fail-soft); cold miss + throw propagates.
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 28 (Google Calendar cache) smoke test...");

  const { createGoogleCache } = await import(
    "../src/services/googleCalendarCache.js"
  );
  const { GCAL_CACHE_ENABLED } = await import("../src/config.js");
  const { agendaBounds } = await import("../src/services/agenda.js");
  const type = await import("../src/schemas/googleCalendar.js");
  type GoogleEvent = import("../src/schemas/googleCalendar.js").GoogleEvent;

  // Today-window bounds drive the "today" TTL classification path.
  const { todayStartUtc, todayEndUtc } = agendaBounds(new Date());

  const mkEvent = (id: string): GoogleEvent => ({
    id,
    title: id,
    start: todayStartUtc,
    end: todayEndUtc,
    allDay: false,
    location: null,
    description: null,
    htmlLink: null,
    source: "google",
  });

  // Counting stub fetcher with controllable return + throw.
  let calls = 0;
  let throwNext = false;
  let ret: GoogleEvent[] = [mkEvent("A")];
  const stub = async (): Promise<GoogleEvent[]> => {
    calls += 1;
    if (throwNext) throw new Error("boom");
    return ret;
  };

  assert(GCAL_CACHE_ENABLED === true, "kill-switch defaults ON");

  // 1. Cold miss → one real fetch.
  let cache = createGoogleCache(stub);
  let out = await cache.fetch(todayStartUtc, todayEndUtc);
  assert(calls === 1 && out[0].id === "A", "cold miss fetches once");

  // 2. Warm hit (age < TTL) → no fetch.
  out = await cache.fetch(todayStartUtc, todayEndUtc);
  assert(calls === 1 && out[0].id === "A", "warm hit = 0 fetches");

  // 3. Stale → serves OLD cache immediately + background revalidate to NEW.
  ret = [mkEvent("B")];
  await sleep(30); // cross the 20ms today-TTL
  out = await cache.fetch(todayStartUtc, todayEndUtc);
  assert(out[0].id === "A", "stale serves old cache synchronously");
  await sleep(5); // let the detached bg revalidate settle
  assert(calls === 2, "stale triggered one bg refetch");
  out = await cache.fetch(todayStartUtc, todayEndUtc);
  assert(out[0].id === "B" && calls === 2, "post-revalidate hit serves new");

  // 4. Concurrent revalidate deduped to a single in-flight fetch.
  ret = [mkEvent("C")];
  await sleep(30); // make it stale again so primeFresh refetches
  const before = calls;
  const [d1, d2] = await Promise.all([
    cache.primeFresh(todayStartUtc, todayEndUtc),
    cache.primeFresh(todayStartUtc, todayEndUtc),
  ]);
  assert(
    calls === before + 1 && d1[0].id === "C" && d2[0].id === "C",
    "concurrent revalidate deduped to one fetch",
  );

  // 5. L2 burst protection: primeFresh within MIN_FRESH reuses cache (no fetch).
  const burst = calls;
  await cache.primeFresh(todayStartUtc, todayEndUtc);
  assert(calls === burst, "primeFresh within MIN_FRESH reuses cache");

  // 6. L3 invalidate → next read is a miss → refetch.
  ret = [mkEvent("D")];
  cache.invalidate();
  out = await cache.fetch(todayStartUtc, todayEndUtc);
  assert(out[0].id === "D" && calls === burst + 1, "invalidate forces refetch");

  // 7. Fail-soft: a forced refetch that throws keeps the last good cache.
  throwNext = true;
  await sleep(30); // stale so primeFresh actually attempts a refetch
  out = await cache.primeFresh(todayStartUtc, todayEndUtc);
  assert(out[0].id === "D", "refetch throw keeps old cache (fail-soft)");

  // 8. Cold miss + throw → propagates (caller treats as []).
  throwNext = true;
  cache = createGoogleCache(stub);
  let threw = false;
  try {
    await cache.fetch(todayStartUtc, todayEndUtc);
  } catch {
    threw = true;
  }
  assert(threw, "cold miss + failure propagates");

  console.log("Step 28 smoke test PASSED.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
