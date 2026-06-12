// Ensure the real-binary path is never reachable from this test.
process.env.CLAUDE_AGENT_AI_ENABLED = "";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running Roadmap 11 Phase 1 (provider abstraction) smoke test...");

  const {
    selectProvider,
    getProvider,
    claudeProvider,
    ProviderError,
    DEFAULT_PROVIDER_ID,
    defaultInvoker,
  } = await import("../src/services/aiProvider.js");
  const { realClaudeInvoker } = await import("../src/services/claudeClient.js");
  const { CLAUDE_MODEL } = await import("../src/config.js");

  // --- 1. Default selection is Claude, with a recorded reason ---
  const def = selectProvider();
  assert(def.selection.selectedProvider === "claude", "default selects claude");
  assert(def.selection.mode === "manual", "default mode is manual");
  assert(
    def.selection.selectedModel === CLAUDE_MODEL,
    "default selection records the Claude model",
  );
  assert(
    typeof def.selection.reason === "string" && def.selection.reason.length > 0,
    "default selection records a non-empty reason",
  );
  assert(def.provider === claudeProvider, "resolved provider is claudeProvider");
  assert(DEFAULT_PROVIDER_ID === "claude", "default provider id is claude");

  // --- 2. Explicit Claude manual selection ---
  const manualClaude = selectProvider({
    mode: "manual",
    requestedProvider: "claude",
  });
  assert(
    manualClaude.selection.selectedProvider === "claude" &&
      manualClaude.selection.requestedProvider === "claude",
    "manual claude selection records requested + selected claude",
  );

  // --- 3. Explicit Gemini fails closed when not configured (Phase 3: registered
  //        but unavailable — reason is "unavailable", not "unknown-provider") ---
  let geminiThrew = false;
  try {
    selectProvider({ mode: "manual", requestedProvider: "gemini" });
  } catch (err) {
    geminiThrew = true;
    assert(
      err instanceof ProviderError && err.reason === "unavailable",
      "manual gemini (no key/env) throws ProviderError('unavailable')",
    );
  }
  assert(geminiThrew, "manual gemini without config fails closed instead of downgrading");

  // --- 4. Gemini IS registered (Phase 3) but unavailable when not configured ---
  const geminiProv = getProvider("gemini");
  assert(
    geminiProv !== undefined,
    "gemini provider is registered in Phase 3",
  );
  assert(
    geminiProv !== undefined && !geminiProv.isAvailable(),
    "geminiProvider.isAvailable() false when GEMINI_ENABLED/GEMINI_API_KEY absent",
  );
  assert(
    getProvider("claude") === claudeProvider,
    "claude provider is registered",
  );

  // --- 5. Auto mode resolves to the default (single provider in Phase 1) ---
  const auto = selectProvider({ mode: "auto" });
  assert(
    auto.selection.selectedProvider === "claude" &&
      auto.selection.mode === "auto",
    "auto mode resolves to claude and records mode=auto",
  );

  // --- 6. Default invoker resolves to the real Claude invoker (identity check
  //        only — NEVER call it, so no live binary is spawned in this test) ---
  assert(
    claudeProvider.invoke === realClaudeInvoker,
    "claudeProvider wraps the existing realClaudeInvoker",
  );
  assert(
    defaultInvoker() === realClaudeInvoker,
    "defaultInvoker resolves to realClaudeInvoker via provider selection",
  );

  console.log("\nPROVIDER SMOKE OK");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nPROVIDER SMOKE FAILED:", message);
  process.exit(1);
});
