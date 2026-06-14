import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Temp DB + memory dir, all Google connectors disabled — no real API calls.
const TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-step18-"));
const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_DB_PATH = path.join(TEST_TMP, "test.db");
process.env.CLAUDE_AGENT_AI_ENABLED = "";
process.env.GOOGLE_CALENDAR_ENABLED = "";
process.env.GMAIL_ENABLED = "";
process.env.GOOGLE_CONTACTS_ENABLED = "";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8821);
const BASE = `http://${HOST}:${PORT}`;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

async function getJson(p: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE}${p}`);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 18 (Google Contacts) smoke test...");

  const { buildServer } = await import("../src/server.js");
  const { initDb } = await import("../src/db/init.js");
  const { closeDb } = await import("../src/db/connection.js");

  initDb();

  const { isContactsEnabled } = await import(
    "../src/services/googleContacts.js"
  );
  const { GOOGLE_CONTACTS_SCOPES, GOOGLE_ALL_SCOPES } = await import(
    "../src/config.js"
  );

  // --- 1. isContactsEnabled() returns false when disabled ---
  assert(!isContactsEnabled(), "isContactsEnabled() is false when env not set");

  // --- 2. Contacts scope is included in GOOGLE_ALL_SCOPES ---
  assert(
    GOOGLE_CONTACTS_SCOPES.includes(
      "https://www.googleapis.com/auth/contacts.readonly",
    ),
    "GOOGLE_CONTACTS_SCOPES includes contacts.readonly",
  );
  assert(
    GOOGLE_ALL_SCOPES.includes(
      "https://www.googleapis.com/auth/contacts.readonly",
    ),
    "GOOGLE_ALL_SCOPES includes contacts.readonly",
  );

  // --- 3. HTTP routes (server running, Contacts disabled) ---
  const app = buildServer();
  await app.listen({ host: HOST, port: PORT });

  try {
    // GET /api/contacts → fail closed when disabled
    const list = await getJson("/api/contacts");
    assert(list.status === 200, "GET /api/contacts returns 200");
    assert(
      (list.json as { available: boolean }).available === false,
      "GET /api/contacts returns available:false when disabled",
    );
    assert(
      Array.isArray((list.json as { contacts: unknown[] }).contacts) &&
        (list.json as { contacts: unknown[] }).contacts.length === 0,
      "GET /api/contacts returns empty contacts when disabled",
    );

    // GET /api/contacts/search → fail closed when disabled
    const search = await getJson("/api/contacts/search?q=test");
    assert(search.status === 200, "GET /api/contacts/search returns 200");
    assert(
      (search.json as { available: boolean }).available === false,
      "GET /api/contacts/search returns available:false when disabled",
    );

    console.log("\nAll Step 18 smoke assertions passed.");
  } finally {
    await app.close();
    closeDb();
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error("\nStep 18 smoke FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
