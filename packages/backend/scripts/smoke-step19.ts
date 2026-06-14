import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Temp DB + memory dir, all Google connectors disabled — no real API calls.
const TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-step19-"));
const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
process.env.CLAUDE_AGENT_DB_PATH = path.join(TEST_TMP, "test.db");
process.env.CLAUDE_AGENT_AI_ENABLED = "";
process.env.GOOGLE_CALENDAR_ENABLED = "";
process.env.GMAIL_ENABLED = "";
process.env.GOOGLE_CONTACTS_ENABLED = "";
process.env.GOOGLE_DRIVE_ENABLED = "";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAUDE_AGENT_SMOKE_PORT ?? 8822);
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
  console.log("Running Claude_Agent Step 19 (Google Drive) smoke test...");

  const { buildServer } = await import("../src/server.js");
  const { initDb } = await import("../src/db/init.js");
  const { closeDb } = await import("../src/db/connection.js");

  initDb();

  const { isDriveEnabled } = await import("../src/services/googleDrive.js");
  const {
    GOOGLE_DRIVE_SCOPES,
    GOOGLE_ALL_SCOPES,
    GOOGLE_DRIVE_CONTENT_MAX_CHARS,
  } = await import("../src/config.js");

  // --- 1. isDriveEnabled() returns false when disabled ---
  assert(!isDriveEnabled(), "isDriveEnabled() is false when env not set");

  // --- 2. Drive scopes in GOOGLE_ALL_SCOPES ---
  assert(
    GOOGLE_DRIVE_SCOPES.includes("https://www.googleapis.com/auth/drive.readonly"),
    "GOOGLE_DRIVE_SCOPES includes drive.readonly",
  );
  assert(
    GOOGLE_DRIVE_SCOPES.includes("https://www.googleapis.com/auth/drive.file"),
    "GOOGLE_DRIVE_SCOPES includes drive.file",
  );
  assert(
    GOOGLE_ALL_SCOPES.includes("https://www.googleapis.com/auth/drive.readonly"),
    "GOOGLE_ALL_SCOPES includes drive.readonly",
  );

  // --- 3. Content max chars is reasonable ---
  assert(
    GOOGLE_DRIVE_CONTENT_MAX_CHARS >= 5_000 && GOOGLE_DRIVE_CONTENT_MAX_CHARS <= 100_000,
    "GOOGLE_DRIVE_CONTENT_MAX_CHARS is in a sane range (5k–100k)",
  );

  // --- 4. HTTP routes (server running, Drive disabled) ---
  const app = buildServer();
  await app.listen({ host: HOST, port: PORT });

  try {
    // GET /api/drive/files → fail closed when disabled
    const list = await getJson("/api/drive/files");
    assert(list.status === 200, "GET /api/drive/files returns 200");
    assert(
      (list.json as { available: boolean }).available === false,
      "GET /api/drive/files returns available:false when disabled",
    );
    assert(
      Array.isArray((list.json as { files: unknown[] }).files) &&
        (list.json as { files: unknown[] }).files.length === 0,
      "GET /api/drive/files returns empty files when disabled",
    );

    // GET /api/drive/files?q=test → fail closed when disabled
    const search = await getJson("/api/drive/files?q=test");
    assert(search.status === 200, "GET /api/drive/files?q= returns 200 when disabled");
    assert(
      (search.json as { available: boolean }).available === false,
      "GET /api/drive/files?q= returns available:false when disabled",
    );

    // GET /api/drive/files/:id/content → 503 when disabled
    const content = await getJson("/api/drive/files/fake-id/content");
    assert(
      content.status === 503,
      "GET /api/drive/files/:id/content returns 503 when disabled",
    );

    // POST /api/drive/upload → 503 when disabled
    const upload = await postJson("/api/drive/upload", {
      name: "test.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("hello").toString("base64"),
    });
    assert(
      upload.status === 503,
      "POST /api/drive/upload returns 503 when disabled",
    );

    // POST /api/drive/upload with missing fields → 400 (validation runs before disabled check)
    // Actually the disabled check comes first, so this returns 503 too — correct behavior.
    assert(
      (upload.json as { available: boolean }).available === false,
      "POST /api/drive/upload returns available:false when disabled",
    );

    console.log("\nAll Step 19 smoke assertions passed.");
  } finally {
    await app.close();
    closeDb();
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(
    "\nStep 19 smoke FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
