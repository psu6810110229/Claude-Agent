import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

async function runGuardOff() {
  console.log("=== Running Stage: Guard OFF ===");
  const TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-step15-off-"));
  const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
  const TEST_DB_PATH = path.join(TEST_TMP, "test.db");
  fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
  process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
  process.env.CLAUDE_AGENT_DB_PATH = TEST_DB_PATH;
  // Hermetic: explicitly force the guard OFF for this stage so a local .env that
  // enables it cannot redact the secret task we are asserting on. (The guard-ON
  // stage sets it to "1"; set "" here, set BEFORE the config import.)
  process.env.CLAUDE_AGENT_PRIVACY_GUARD_ENABLED = "";
  process.env.CLAUDE_AGENT_OWNER_PIN = "";
  process.env.CLAUDE_AGENT_OWNER_SECRET_PHRASE = "";

  const serverPath = new URL("../src/server.js", import.meta.url).href;
  const initPath = new URL("../src/db/init.js", import.meta.url).href;
  const connPath = new URL("../src/db/connection.js", import.meta.url).href;
  const taskRepoPath = new URL("../src/db/repositories/taskRepo.js", import.meta.url).href;

  const { buildServer } = await import(serverPath);
  const { initDb } = await import(initPath);
  const { closeDb } = await import(connPath);
  const { createTask } = await import(taskRepoPath);

  initDb();
  createTask("Secret task of owner");

  let lastPrompt = "";
  const dynamicInvoker = async (prompt: string) => {
    lastPrompt = prompt;
    return JSON.stringify({ reply: "Hi", sensitivity: "normal", actions: [] });
  };

  const HOST = "127.0.0.1";
  const PORT = 8821;
  const app = buildServer({ aiInvoker: dynamicInvoker, calendarFetcher: async () => [] });
  await app.listen({ host: HOST, port: PORT });

  const res = await fetch(`http://${HOST}:${PORT}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Hello", sessionId: "session-1" }),
  });
  const body = await res.json();
  console.log("DEBUG RESPONSE BODY:", body);

  assert(body.verificationRequired === undefined, "no verificationRequired returned");
  assert(lastPrompt.includes("Secret task of owner"), "prompt contains secret task details");

  await app.close();
  closeDb();
  fs.rmSync(TEST_TMP, { recursive: true, force: true });
}

async function runGuardOn() {
  console.log("=== Running Stage: Guard ON ===");
  const TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-step15-on-"));
  const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
  const TEST_DB_PATH = path.join(TEST_TMP, "test.db");
  fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
  process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
  process.env.CLAUDE_AGENT_DB_PATH = TEST_DB_PATH;
  process.env.CLAUDE_AGENT_PRIVACY_GUARD_ENABLED = "1";
  process.env.CLAUDE_AGENT_OWNER_PIN = "123456";
  process.env.CLAUDE_AGENT_OWNER_SECRET_PHRASE = "กุญแจทอง7788";
  process.env.CLAUDE_AGENT_PRIVACY_VERIFY_MAX_ATTEMPTS = "3";
  process.env.CLAUDE_AGENT_PRIVACY_VERIFY_LOCKOUT_MS = "1000";

  const serverPath = new URL("../src/server.js", import.meta.url).href;
  const initPath = new URL("../src/db/init.js", import.meta.url).href;
  const connPath = new URL("../src/db/connection.js", import.meta.url).href;
  const taskRepoPath = new URL("../src/db/repositories/taskRepo.js", import.meta.url).href;
  const classifierPath = new URL("../src/services/privacyClassifier.js", import.meta.url).href;

  const { buildServer } = await import(serverPath);
  const { initDb } = await import(initPath);
  const { closeDb, getDb } = await import(connPath);
  const { createTask } = await import(taskRepoPath);
  const { classifySensitivity } = await import(classifierPath);

  initDb();
  createTask("Secret task of owner");

  let lastPrompt = "";
  const dynamicInvoker = async (prompt: string) => {
    lastPrompt = prompt;
    return JSON.stringify({ reply: "Hi", sensitivity: "normal", actions: [] });
  };

  const HOST = "127.0.0.1";
  const PORT = 8822;
  const app = buildServer({ aiInvoker: dynamicInvoker, calendarFetcher: async () => [] });
  await app.listen({ host: HOST, port: PORT });

  const BASE = `http://${HOST}:${PORT}`;

  // Assertion 9: Keyword Classifier
  const kw1 = classifySensitivity("ฟานไปไหนกับใคร");
  const kw2 = classifySensitivity("สวัสดีครับ");
  assert(kw1.private === true, "ฟานไปไหนกับใคร is private");
  assert(kw2.private === false, "สวัสดีครับ is normal");

  // Assertion 2: Guard ON + unverified (prompt redaction + verificationRequired)
  const r1 = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "ฟานไปไหนกับใคร", sessionId: "session-1" }),
  });
  const b1 = await r1.json();
  assert(b1.verificationRequired === true, "sensitivity triggers verificationRequired");
  assert(!lastPrompt.includes("Secret task of owner"), "unverified prompt does not contain private details");
  assert(lastPrompt.includes("PRIVACY MODE (CRITICAL"), "unverified prompt contains PRIVACY MODE block");

  // Assertion 3: Redaction completeness
  assert(!lastPrompt.includes("Secret task of owner"), "Redaction completeness check passed");

  // Assertion 4: Verify inputs
  const v1 = await fetch(`${BASE}/api/chat/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "session-1", input: "Wrong" }),
  });
  assert(v1.status === 401, "wrong PIN/phrase is 401");

  const v2 = await fetch(`${BASE}/api/chat/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "session-1", input: "กุญแจทอง7788" }),
  });
  assert(v2.status === 200, "correct Secret Phrase verifies successfully");

  // Reset verification state of session-1 so we can verify via PIN too
  const resetRes = await fetch(`${BASE}/api/chat/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "session-1" }),
  });
  assert(resetRes.status === 200, "reset session clears verification state");

  const v3 = await fetch(`${BASE}/api/chat/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "session-1", input: "123456" }),
  });
  assert(v3.status === 200, "correct PIN verifies successfully");

  // Assertion 5: After verify, same sessionId gets full context
  const r2 = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Hello", sessionId: "session-1" }),
  });
  await r2.json();
  assert(lastPrompt.includes("Secret task of owner"), "verified session gets full context");

  // Assertion 6: Per-session (different sessionId is still unverified)
  const r3 = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Hello", sessionId: "session-2" }),
  });
  await r3.json();
  assert(!lastPrompt.includes("Secret task of owner"), "different session ID remains unverified and redacted");

  // Assertion 7: No secret leakage (PIN/phrase never in prompt or logged activity)
  assert(!lastPrompt.includes("123456") && !lastPrompt.includes("กุญแจทอง7788"), "secrets never appear in prompt");
  const logs = getDb().prepare("SELECT detail FROM activity_log").all() as { detail: string | null }[];
  for (const l of logs) {
    if (l.detail) {
      assert(!l.detail.includes("123456") && !l.detail.includes("กุญแจทอง7788"), "secrets never appear in logs");
    }
  }
  console.log("  PASS: secrets never logged in activity_log");

  // Assertion 8: Rate limit lockout
  const rLock = await fetch(`${BASE}/api/chat/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "sess-lock", input: "Wrong" }),
  });
  const rLock2 = await fetch(`${BASE}/api/chat/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "sess-lock", input: "Wrong" }),
  });
  const rLock3 = await fetch(`${BASE}/api/chat/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "sess-lock", input: "Wrong" }),
  });
  assert(rLock3.status === 429, "lockout returns 429 after max attempts");

  await app.close();
  closeDb();
  fs.rmSync(TEST_TMP, { recursive: true, force: true });
}

async function runGuardUnconfigured() {
  console.log("=== Running Stage: Guard Unconfigured ===");
  const TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "claude-agent-step15-unconfigured-"));
  const TEST_MEMORY_DIR = path.join(TEST_TMP, "memory");
  const TEST_DB_PATH = path.join(TEST_TMP, "test.db");
  fs.mkdirSync(TEST_MEMORY_DIR, { recursive: true });
  process.env.CLAUDE_AGENT_MEMORY_DIR = TEST_MEMORY_DIR;
  process.env.CLAUDE_AGENT_DB_PATH = TEST_DB_PATH;
  process.env.CLAUDE_AGENT_PRIVACY_GUARD_ENABLED = "1";
  process.env.CLAUDE_AGENT_OWNER_PIN = ""; // missing
  process.env.CLAUDE_AGENT_OWNER_SECRET_PHRASE = ""; // missing

  const serverPath = new URL("../src/server.js", import.meta.url).href;
  const initPath = new URL("../src/db/init.js", import.meta.url).href;
  const connPath = new URL("../src/db/connection.js", import.meta.url).href;
  const taskRepoPath = new URL("../src/db/repositories/taskRepo.js", import.meta.url).href;

  const { buildServer } = await import(serverPath);
  const { initDb } = await import(initPath);
  const { closeDb } = await import(connPath);
  const { createTask } = await import(taskRepoPath);

  initDb();
  createTask("Secret task of owner");

  let lastPrompt = "";
  const dynamicInvoker = async (prompt: string) => {
    lastPrompt = prompt;
    return JSON.stringify({ reply: "Hi", sensitivity: "normal", actions: [] });
  };

  const HOST = "127.0.0.1";
  const PORT = 8823;
  const app = buildServer({ aiInvoker: dynamicInvoker, calendarFetcher: async () => [] });
  await app.listen({ host: HOST, port: PORT });

  const BASE = `http://${HOST}:${PORT}`;

  // Assertion 10: Misconfigured fail-closed
  const v = await fetch(`${BASE}/api/chat/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "sess-unc", input: "Wrong" }),
  });
  assert(v.status === 503, "unconfigured returns 503");
  const b = await v.json();
  assert(b.reason === "not-configured", "reason is not-configured");

  // Send chat -> should still redact
  await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Hello", sessionId: "sess-unc" }),
  });
  assert(!lastPrompt.includes("Secret task of owner"), "unconfigured chat still redacts private details");

  await app.close();
  closeDb();
  fs.rmSync(TEST_TMP, { recursive: true, force: true });
}

async function main() {
  const stage = process.env.TEST_STAGE;
  if (!stage) {
    // Controller process: run each stage in a separate process
    console.log("Starting Step 15 Smoke Tests controller...");
    const runStage = (s: string) => {
      console.log(`\nSpawning child process for stage: ${s}`);
      const res = spawnSync("npx", ["tsx", `"${__filename}"`], {
        env: { ...process.env, TEST_STAGE: s },
        stdio: "inherit",
        shell: true,
      });
      if (res.status !== 0) {
        console.error(`\nStage ${s} FAILED!`);
        process.exit(res.status ?? 1);
      }
    };

    runStage("guard-off");
    runStage("guard-on");
    runStage("guard-unconfigured");

    console.log("\nALL STEP 15 SMOKE TESTS PASSED!");
  } else if (stage === "guard-off") {
    await runGuardOff();
  } else if (stage === "guard-on") {
    await runGuardOn();
  } else if (stage === "guard-unconfigured") {
    await runGuardUnconfigured();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
