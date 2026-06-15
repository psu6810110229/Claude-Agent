import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Temp DB + memory + LINE export dir. LINE starts DISABLED (env unset) so we can
// assert fail-closed, then enable via DB config. No real LINE files/DB touched.
const TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-step20-"));
const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
const TEST_LINE_DIR = path.join(TEST_TMP, "line-exports");
fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
fs.mkdirSync(TEST_LINE_DIR, { recursive: true });
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_DB_PATH = path.join(TEST_TMP, "test.db");
process.env.LINE_EXPORT_DIR = TEST_LINE_DIR;
process.env.CLAUDE_AGENT_AI_ENABLED = "";
process.env.GOOGLE_CALENDAR_ENABLED = "";
process.env.LINE_ENABLED = ""; // disabled at import time

// A LINE export exercising every parser case: spaced display name, registry via
// a media suffix, a real text line, a "joined" system line, a multiline message,
// a sender-less system line, a README that must be ignored.
const SAMPLE = [
  "2026.06.05 Friday",
  "15:16 สมิตา ꕤ. Photos", // media → registry learns "สมิตา ꕤ."
  "15:17 สมิตา ꕤ. สวัสดีค่ะ", // spaced sender split via registry
  "15:18 Thanphisit 207 Thanphisit 207 joined the group.", // system, no registry hit
  "15:20 fran_patchara ข้อความแรก", // multiline message ↓",
  "ต่อบรรทัดสอง",
  "15:21 Message unsent.", // sender-less system line
  "15:22 fran_patchara Stickers", // media → registry learns "fran_patchara"
  "",
].join("\n");

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8822);
const BASE = `http://${HOST}:${PORT}`;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

async function getJson(p: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${p}`);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 20 (LINE read-only) smoke test...");

  // Drop the sample export + a README that must be skipped.
  fs.writeFileSync(path.join(TEST_LINE_DIR, "[LINE]TestChat.txt"), SAMPLE, "utf8");
  fs.writeFileSync(path.join(TEST_LINE_DIR, "README.txt"), "ignore me", "utf8");

  const { buildServer } = await import("../src/server.js");
  const { initDb } = await import("../src/db/init.js");
  const { closeDb } = await import("../src/db/connection.js");
  const { setConfigBool } = await import(
    "../src/db/repositories/configRepo.js"
  );
  const line = await import("../src/services/lineChat.js");

  initDb();

  // --- 1. Disabled by default ---
  assert(!line.isLineEnabled(), "isLineEnabled() false when env unset & no DB config");

  const app = buildServer();
  await app.listen({ host: HOST, port: PORT });

  try {
    // --- 2. Routes fail closed when disabled ---
    const offChats = await getJson("/api/line/chats");
    assert(offChats.status === 200, "GET /api/line/chats returns 200 when disabled");
    assert(offChats.json.available === false, "chats available:false when disabled");
    assert(
      Array.isArray(offChats.json.chats) && offChats.json.chats.length === 0,
      "chats empty when disabled",
    );
    const offMsgs = await getJson("/api/line/messages?chat=[LINE]TestChat.txt");
    assert(offMsgs.json.available === false, "messages available:false when disabled");

    // searchLineMessages fails closed (returns []) while LINE is disabled.
    assert(
      line.searchLineMessages(["สวัสดี"], 12).length === 0,
      "searchLineMessages returns [] when disabled",
    );

    // --- 3. Enable via DB config override ---
    setConfigBool("line_enabled", true);
    assert(line.isLineEnabled(), "isLineEnabled() true after DB config enable");

    // --- 4. Pure parser correctness ---
    const parsed = line.parseLineExport(SAMPLE);
    assert(parsed.length === 6, `parseLineExport yields 6 messages (got ${parsed.length})`);

    const m0 = parsed[0];
    assert(m0.sender === "สมิตา ꕤ." && m0.text === "Photos", "media line: spaced sender + media text");
    assert(m0.date === "2026-06-05" && m0.time === "15:16", "date/time parsed");
    assert(m0.atUtc === "2026-06-05T08:16:00.000Z", `15:16 Bangkok → 08:16Z (got ${m0.atUtc})`);

    const m1 = parsed[1];
    assert(
      m1.sender === "สมิตา ꕤ." && m1.text === "สวัสดีค่ะ",
      "registry splits spaced display name on a text line",
    );

    const m2 = parsed[2];
    assert(m2.system === true, "'joined the group.' flagged as system");

    const m3 = parsed[3];
    assert(
      m3.sender === "fran_patchara" && m3.text === "ข้อความแรก\nต่อบรรทัดสอง",
      "multiline message keeps continuation line",
    );

    const m4 = parsed[4];
    assert(
      m4.sender === null && m4.system === true && m4.text === "Message unsent.",
      "sender-less system line has null sender + system flag",
    );

    // --- 5. listLineChats (README skipped) ---
    const chats = line.listLineChats();
    assert(chats.length === 1, "listLineChats returns 1 chat (README.txt skipped)");
    assert(chats[0].id === "[LINE]TestChat.txt", "chat id is the filename");
    assert(chats[0].name === "TestChat", "chat name derived from filename");
    assert(chats[0].messageCount === 6, "chat messageCount = 6");

    // --- 6. getLineMessages slice + traversal guard ---
    const last2 = line.getLineMessages("[LINE]TestChat.txt", 2);
    assert(last2.length === 2, "getLineMessages respects limit");
    assert(last2[1].text === "Stickers", "getLineMessages returns the most recent messages");
    let threw = false;
    try {
      line.getLineMessages("../../../etc/passwd", 5);
    } catch {
      threw = true;
    }
    assert(threw, "getLineMessages rejects unknown/traversal chat id");

    // --- 7. getRecentLineMessages newest-first + chat tag ---
    const recent = line.getRecentLineMessages(3);
    assert(recent.length === 3, "getRecentLineMessages caps to limit");
    assert(recent[0].chat === "TestChat", "recent messages tagged with chat name");
    assert(
      recent[0].atUtc >= recent[1].atUtc && recent[1].atUtc >= recent[2].atUtc,
      "getRecentLineMessages sorted newest-first",
    );

    // --- 7b. Part 1: chat summaries + per-chat recent (fail-soft) ---
    const summaries = line.getLineChatSummariesSafe();
    assert(summaries.length === 1, "getLineChatSummariesSafe returns the chat list");
    const byChat = line.getRecentLineByChatSafe(3, 6);
    assert(byChat.length === 1, "getRecentLineByChatSafe groups by chat");
    assert(byChat[0].chat === "TestChat", "per-chat group tagged with chat name");
    assert(byChat[0].messages.length === 3, "per-chat group respects perChat limit");

    // --- 7c. Keyword retrieval (read-only) — assert on counts/flags only,
    //          NEVER print message bodies. ---
    const hit = line.searchLineMessages(["สวัสดี"], 12);
    assert(hit.length >= 1, "searchLineMessages finds a matching message");
    assert(hit[0].chat === "TestChat", "search result tagged with chat name");
    assert(
      hit.every((m) => m.sender !== undefined),
      "search results carry a sender field",
    );
    assert(
      line.searchLineMessages([], 12).length === 0,
      "searchLineMessages returns [] for no keywords",
    );
    assert(
      line.searchLineMessages(["สวัสดี"], 0).length === 0,
      "searchLineMessages returns [] when cap<=0",
    );
    assert(
      line.searchLineMessages(["zzznomatch"], 12).length === 0,
      "searchLineMessages returns [] when nothing matches",
    );
    // System lines (e.g. "...joined the group.") must be excluded from matches.
    assert(
      line.searchLineMessages(["joined the group"], 12).length === 0,
      "searchLineMessages excludes system lines",
    );

    // Keyword extraction strips broad stopwords, keeps the topic term.
    const { extractLineKeywords } = await import("../src/services/chat.js");
    const kw = extractLineKeywords("who asked latest in LINE about กยศ");
    assert(kw.includes("กยศ"), "extractLineKeywords keeps the topic keyword");
    assert(
      !kw.some((k) => ["who", "asked", "latest", "in", "line", "about"].includes(k)),
      "extractLineKeywords removes English stopwords",
    );
    assert(kw.length <= 6, "extractLineKeywords caps to ~6 keywords");

    // --- 8. Routes serve data when enabled ---
    const onChats = await getJson("/api/line/chats");
    assert(onChats.json.available === true, "chats available:true when enabled");
    assert(onChats.json.chats.length === 1, "route returns the one chat");
    const onMsgs = await getJson(
      "/api/line/messages?chat=" + encodeURIComponent("[LINE]TestChat.txt") + "&limit=2",
    );
    assert(onMsgs.json.available === true, "messages available:true when enabled");
    assert(onMsgs.json.messages.length === 2, "route honours limit");

    // --- 9. No LINE write action types exist (read-only invariant) ---
    const { ACTION_TYPES } = await import("../src/services/actionRegistry.js");
    assert(
      !ACTION_TYPES.some((t) => t.startsWith("line")),
      "no line.* action types in the executor allowlist (read-only)",
    );

    console.log("\nAll Step 20 smoke assertions passed.");
  } finally {
    await app.close();
    closeDb();
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error("\nStep 20 smoke FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
