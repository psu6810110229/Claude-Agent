# Feature A — Auto Morning Brief

> Phase 2 (medium risk). See master doc: `docs/feature-jarvis-master.md`.

## Purpose

The Step 11 scheduler is **pure date-math** — it fires reminder/event notifications but never
calls Claude. The daily brief exists (`services/brief.ts` + `routes/briefs.ts`) but is
**request-driven only** (HTTP POST). This feature makes the scheduler call Claude each morning,
delivering a brief proactively — the single change that most makes the agent feel "Jarvis-like".

> ⚠️ This crosses the current `CLAUDE.md` "Out of scope" entry for the auto-morning-brief
> scheduler. `CLAUDE.md` must be updated in **Phase 0** before implementation begins.

## Delivery (locked): store + notify

When the morning brief runs:

1. Persist the brief **summary** as an `assistant` `chat_message` (surfaces in Chat page + dashboard).
2. Create **approvals** for each proposed action (same as existing brief route).
3. **Desktop-notify** that a brief is ready (short toast; full text lives in Chat).
4. Log `brief.daily.generated` with count only — never the summary text (matching current privacy
   convention in `routes/briefs.ts handleBrief`).

## Shared persist helper (refactor — zero behavior change to existing route)

Extract approval-create + activity-log logic from `routes/briefs.ts handleBrief` into
`services/brief.ts`:

```
persistBriefResult(type: BriefType, result: BriefResult): { approvals: number[] }
  - appendMessage("assistant", result.summary)          ← NEW, used by route too
  - createApproval(action_type, payload) per action
  - logActivity(`brief.${type}.generated`, String(count))
```

`routes/briefs.ts` calls `persistBriefResult` (keeps its HTTP error-mapping); the scheduler calls
it too. **`brief-smoke` must stay green** after this refactor — no behavior change to the route.

## Scheduler changes

### `services/scheduler.ts`

- Keep existing sync reminder/event firing **untouched**.
- Add `async function runAutoBriefCheck(now: Date, invoke: ClaudeInvoker, notifier: DesktopNotifier): Promise<void>`:
  1. Gate on `AUTO_BRIEF_ENABLED` (and `CLAUDE_AI_ENABLED` — real invoker throws `"disabled"` if off; catch, log soft, return).
  2. Compute Bangkok wall clock via `bangkokWallClock(now)` (`services/agenda.ts`); proceed only when local hour ≥ `AUTO_BRIEF_HOUR`.
  3. **Dedup once-per-day** via `insertNotificationIfNew("auto_brief", dateInt, ...)` where `dateInt` = Bangkok `YYYYMMDD` as integer (reuses existing `UNIQUE(kind, source_id)` on the `notification` table). Returns `true` only on first tick of that day.
  4. On net-new day: `await runBrief("daily", invoke)`. On `kind:"generated"` → `persistBriefResult("daily", res)` + `notifier.notify("Morning brief ready", <short>)`. On any Claude failure → `logActivity("scheduler.brief_error", detail)`, no throw.
- `startScheduler(notifier, invoke = realClaudeInvoker)` — add the `invoke` param with real-default.
  Make `tick()` async; `await runAutoBriefCheck(...)` inside the existing try/catch (Claude failure
  logs `scheduler.tick_error` and **never stops the interval**).
- Export `runAutoBriefCheck` for smoke tests (same pattern as existing `runSchedulerTick`).

### `index.ts`

Pass `realClaudeInvoker` to `startScheduler(realDesktopNotifier, realClaudeInvoker)`.
Only meaningful when gates are on; graceful when off.

## Config (`config.ts`)

```ts
export const AUTO_BRIEF_ENABLED = /^(1|true)$/i.test(
  process.env.CLAUDE_AGENT_AUTO_BRIEF_ENABLED ?? ""
);
export const AUTO_BRIEF_HOUR = Number(
  process.env.CLAUDE_AGENT_AUTO_BRIEF_HOUR ?? 7
);
```

## Smoke — `scripts/smoke-step13a.ts`

1. Temp DB + memory dir; stub invoker returning a valid brief JSON; stub notifier.
2. Call `runAutoBriefCheck(now, stub, notifier)` **twice** for the same Bangkok day.
3. Assert:
   - brief persisted **once** (chat_message row)
   - approval(s) created **once**
   - notifier called **once** (dedup via notification UNIQUE)
4. Claude-disabled path → fails soft (no throw, `scheduler.brief_error` logged).
5. Hour-gate: `now` set to hour < `AUTO_BRIEF_HOUR` → nothing fires.

## Files touched

**New:** `scripts/smoke-step13a.ts`

**Edit:** `services/scheduler.ts`, `services/brief.ts` (add `persistBriefResult`),
`routes/briefs.ts` (call helper instead of inline logic), `index.ts`, `config.ts`,
both `package.json` (add `smoke:step13a`)
