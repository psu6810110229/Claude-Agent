# Feature C — Memory Reasoning (Auto-learn Patterns)

> Phase 3 (highest risk, shipped last, gated). See master doc: `docs/feature-jarvis-master.md`.

## Purpose

Memory today = 4 fixed markdown targets (`preferences`, `routines`, `projects`, `decisions`),
written only via the **approval-gated** `memory.write` action. Prompts see **summaries only**.
This feature lets the agent **auto-learn stable user patterns** without a manual approval step,
so it accumulates a behavioural model of the user over time.

## ⚠️ Tradeoff (accepted by user)

Auto-learn **bypasses the approval queue**, breaking the invariant *"backend executes only
approved actions."* The violation is kept **surgically narrow**:

| Guard | Implementation |
|---|---|
| Target restriction | only the new `patterns` target — asserted in code |
| Mode restriction | **append-only** (never replace/delete) |
| Per-entry cap | ≤ 500 chars; empty rejected |
| Daily volume cap | count today's `memory.auto_learned` activity rows; stop after N (e.g. 10) |
| Audit trail | **every write logged** `memory.auto_learned` |
| User control | clearable from dashboard |
| All other actions | remain **100% approval-gated** (unchanged) |

## New `patterns` memory target

- `schemas/memory.ts` — add `"patterns"` to `memoryTargetSchema` enum.
- `services/memoryStore.ts` — add `"patterns"` to `TARGET_FILES` (→ `patterns.md`) and a seed
  template to `TEMPLATES`. Existing path-traversal guard already covers it.
- The existing approval-gated `memory.write` action works for all 5 targets **unchanged**.

## No-approval auto-learn path

### `services/patternLearner.ts` (new)

`autoLearnPattern(text: string): void`

1. Validate: reject empty; enforce ≤ 500 char cap; reject if daily count cap reached
   (query `activity_log` for today's `memory.auto_learned` rows).
2. Assert target is `"patterns"` (belt-and-suspenders in code).
3. `writeMemory("patterns", "append", text)` — writes the markdown file.
4. `upsertMemoryEntry("patterns", relPath, <short summary>)` — updates the index.
5. `logActivity("memory.auto_learned", <short summary>)` — **always**, even on cap rejection.

This function bypasses `createApproval`; it is the **only** place in the codebase that writes
memory without approval.

### Chat wiring (`services/chat.ts`)

After successful validation + message persist in `runChat`:
```ts
if (check.data.learned_pattern) {
  autoLearnPattern(check.data.learned_pattern);
}
```

No change to the approval-routing path; `learned_pattern` is an orthogonal output field.

### Schema extension (`schemas/chat.ts`)

Add to `chatOutputSchema` (keep `.strict()`):
```ts
learned_pattern: z.string().trim().min(1).max(500).nullish()
```

### Prompt instruction (`services/chatPrompt.ts`)

Instruct Claude to emit `learned_pattern` **only** when it observes a **stable, durable**
user habit or preference that would help future interactions — not one-off facts, not ephemeral
context. Omit the field when in doubt.

### Recall (unchanged)

`listMemoryEntries()` returns the `patterns` summary alongside the other 4 targets; chat and
brief prompts already consume summaries — no prompt-builder changes needed for recall.

## Dashboard

- Memory view: show `patterns` entry (summary) + `activity_log` rows for `memory.auto_learned`.
- "Clear patterns" control:
  - Option A (preferred — keeps no-approval surface minimal): trigger a normal approval-gated
    `memory.write` (replace, empty or reset template). User approves in Approvals page.
  - Option B: small dedicated `DELETE /api/memory/patterns/auto` route that `writeMemory`+`upsertMemoryEntry` directly (same bypass as auto-learn). Only if option A feels too clunky.
  - **Decide at implementation time.** Prefer option A.

## Smoke — `scripts/smoke-step13c.ts`

1. Temp DB + memory dir; stub chat returning `learned_pattern`.
2. Assert: `patterns.md` appended + `memory.auto_learned` logged.
3. Daily cap: call auto-learn N+1 times → assert N+1th rejected (logged, no throw, no file write).
4. Non-`patterns` target: assert the no-approval path **cannot** write to any other target
   (call `autoLearnPattern` and verify only `patterns.md` touched).
5. Approval queue: assert no approval rows created by the auto-learn path.

## Files touched

**New:** `services/patternLearner.ts`, `scripts/smoke-step13c.ts`

**Edit:** `schemas/memory.ts`, `services/memoryStore.ts`, `schemas/chat.ts`, `services/chat.ts`,
`services/chatPrompt.ts`, dashboard memory view, both `package.json` (add `smoke:step13c`)
