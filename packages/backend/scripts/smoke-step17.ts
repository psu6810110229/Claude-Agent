import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Temp DB + memory dir, Gmail + AI disabled — no real credentials or API calls.
const TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-step17-"));
const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_DB_PATH = path.join(TEST_TMP, "test.db");
process.env.CLAUDE_AGENT_AI_ENABLED = "";
process.env.GOOGLE_CALENDAR_ENABLED = "";
process.env.GMAIL_ENABLED = "";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8820);
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

async function postJson(
  p: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent Step 17 (Gmail) smoke test...");

  const { buildServer } = await import("../src/server.js");
  const { initDb } = await import("../src/db/init.js");
  const { closeDb } = await import("../src/db/connection.js");

  // Init DB first — requiresConfirmation reads from config table.
  initDb();

  const { actionTypeSchema } = await import("../src/schemas/approval.js");
  const { actionRegistry } = await import("../src/services/actionRegistry.js");
  const { requiresConfirmation } = await import(
    "../src/services/actionDispatcher.js"
  );
  const { gmailDraftPayloadSchema, gmailSendPayloadSchema } = await import(
    "../src/schemas/gmail.js"
  );

  // --- 1. Action types include gmail.draft and gmail.send ---
  const types = (actionTypeSchema as { options: string[] }).options;
  assert(types.includes("gmail.draft"), "actionTypeSchema includes gmail.draft");
  assert(types.includes("gmail.send"), "actionTypeSchema includes gmail.send");

  // --- 2. Registry has entries ---
  assert(actionRegistry["gmail.draft"] !== undefined, "registry has gmail.draft");
  assert(actionRegistry["gmail.send"] !== undefined, "registry has gmail.send");
  assert(
    actionRegistry["gmail.draft"].riskLevel === "low",
    "gmail.draft risk is low",
  );
  assert(
    actionRegistry["gmail.send"].riskLevel === "high",
    "gmail.send risk is high",
  );
  assert(
    actionRegistry["gmail.send"].policies.includes("destructive"),
    "gmail.send is destructive",
  );

  // --- 3. Confirmation policy ---
  assert(
    requiresConfirmation("gmail.send", {}),
    "gmail.send always requires confirmation",
  );
  assert(
    !requiresConfirmation("gmail.draft", {}),
    "gmail.draft does NOT require confirmation (auto-executable)",
  );

  // --- 4. Schema validation ---
  const validDraft = {
    to: "test@example.com",
    subject: "Hello",
    body: "This is a test.",
  };
  assert(
    gmailDraftPayloadSchema.safeParse(validDraft).success,
    "valid draft payload passes schema",
  );
  assert(
    !gmailDraftPayloadSchema.safeParse({ subject: "missing to" }).success,
    "draft without 'to' fails schema",
  );

  const validSend = { to: "a@b.com", subject: "Test", body: "Body text" };
  assert(
    gmailSendPayloadSchema.safeParse(validSend).success,
    "valid send payload passes schema",
  );
  assert(
    !gmailSendPayloadSchema.safeParse({ to: "", subject: "x", body: "y" }).success,
    "send with empty 'to' fails schema",
  );

  // --- 5. HTTP routes (server running, Gmail disabled) ---
  const app = buildServer();
  await app.listen({ host: HOST, port: PORT });

  try {
    // GET /api/gmail/unread → fail closed when disabled
    const unread = await getJson("/api/gmail/unread");
    assert(unread.status === 200, "GET /api/gmail/unread returns 200");
    assert(
      (unread.json as { available: boolean }).available === false,
      "GET /api/gmail/unread returns available:false when disabled",
    );
    assert(
      Array.isArray((unread.json as { messages: unknown[] }).messages) &&
        (unread.json as { messages: unknown[] }).messages.length === 0,
      "GET /api/gmail/unread returns empty messages when disabled",
    );

    // Propose gmail.draft via approval endpoint
    const draft = await postJson("/api/approvals", {
      action_type: "gmail.draft",
      payload: validDraft,
    });
    assert(draft.status === 201, "POST /api/approvals gmail.draft returns 201");
    assert(
      (draft.json as { action_type: string }).action_type === "gmail.draft",
      "approval row has action_type gmail.draft",
    );

    // Propose gmail.send via approval endpoint
    const send = await postJson("/api/approvals", {
      action_type: "gmail.send",
      payload: validSend,
    });
    assert(send.status === 201, "POST /api/approvals gmail.send returns 201");

    console.log("\nAll Step 17 smoke assertions passed.");
  } finally {
    await app.close();
    closeDb();
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error("\nStep 17 smoke FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
