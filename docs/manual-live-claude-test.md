# Manual live-Claude verification (Step 7)

This is a **manual** check that AI mode proposes — but never executes — actions.
It is intentionally **not** part of any smoke test: the real `claude` binary is
never invoked automatically. Run this by hand when you want end-to-end
confidence in the live AI path.

> Prerequisite: the `claude` CLI must be installed, on `PATH`, and authenticated
> on this machine. If it is not, AI mode will report a Claude failure (502) —
> which is itself a valid "fails closed" result.

## 1. Enable AI mode (backend env)

AI mode is gated by `CLAUDE_AGENT_AI_ENABLED` (default off). In the PowerShell
session that will run the backend:

```powershell
$env:CLAUDE_AGENT_AI_ENABLED = "1"
```

The variable only affects that session. Leaving it unset (or `"0"`) keeps Claude
disabled, and AI commands return **503 / "Claude is disabled."**

### Windows: point the backend at a real `claude.exe`

On Windows the `claude` on `PATH` is usually a **`.cmd` shim** (e.g.
`...\nodejs\claude.cmd`). The backend invokes the binary with Node's `execFile`
**without a shell** (a deliberate command-injection safeguard), and Node refuses
to run `.cmd`/`.bat` files that way — so the bare name resolves but fails with
**502 / "Claude binary not found"**.

Fix: override the binary with the full path to a real `.exe` via
`CLAUDE_AGENT_CLAUDE_BIN`, in the **same** backend session:

```powershell
$env:CLAUDE_AGENT_CLAUDE_BIN = "C:\Users\<you>\.local\bin\claude.exe"
```

Find your `.exe` if unsure:

```powershell
# native install (preferred):
Get-ChildItem "$env:USERPROFILE\.local\bin\claude.exe"
# or the .exe the npm shim itself calls:
(Get-Content (Get-Command claude).Source | Select-String '\.exe').Matches.Value
```

Verify it runs: `& $env:CLAUDE_AGENT_CLAUDE_BIN --version`. macOS/Linux users can
skip this — `claude` on `PATH` is a real executable there.

## 2. Run the backend and dashboard

In the backend session (with the env var set):

```powershell
npm run dev            # backend on 127.0.0.1:8787
```

In a second session:

```powershell
npm run dev:dashboard  # dashboard on http://127.0.0.1:3000
```

## 3. Submit a safe test command

1. Open the dashboard (Today page).
2. In the command bar, select the **AI** radio.
3. Enter a safe, allowlisted request, e.g.:

   ```
   add a task to buy milk tomorrow
   ```

4. Click **Run**.

Expected: a **proposal** result listing one or more approval IDs, each linking
to the Approvals page.

## 4. Verify it was proposed, not executed

- **Approvals page** — the new approval is present with status `pending`.
- **Tasks page** — no new task exists yet (the action has not run).
- **Activity page** — entries `ai.command.received` then `ai.command.proposed`
  (with the approval id). There is **no** execution/applied event.
- Only after you click **Approve** does the task actually get created (executed
  by the backend's single execution gate, exactly as the deterministic path).

## 5. Spot-check the other result states (optional)

- **No action suggested** — phrase an off-topic request the model can't map to an
  allowlisted action; expect a `none` result, nothing queued (HTTP 200).
- **Rejected invalid output** — surfaces as a 400 if Claude returns output that
  fails schema validation.
- **Claude disabled** — restart the backend **without** `CLAUDE_AGENT_AI_ENABLED`
  and resubmit; expect "Claude is disabled." (503).
- **Claude timeout** — surfaces as a 504 if the call exceeds the backend's hard
  timeout.

## Allowlist (unchanged)

AI mode can only ever propose: `task.create`, `task.update`, `task.archive`,
`memory.write`. Anything else is rejected before reaching the approval queue.
