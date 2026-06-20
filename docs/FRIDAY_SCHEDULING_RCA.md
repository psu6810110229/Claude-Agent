# Friday Scheduling Reliability — Root Cause Analysis & Implementation Plan

Status: IMPLEMENTED (Sprints 0–5). This document maps the abnormal behavior seen
in the 2026-06-20 fish-tank scheduling chat to concrete root causes in the
backend, then proposes a sprint-by-sprint fix plan. All sprints are shipped on
`main` (commits `3d1947c` Sprints 0–3, `badf3e5` Sprint 4, `12bffae` Sprint 5);
see §6 for the verified Definition of Done.

---

## 1. Observed failures (from the real transcript)

| # | Symptom in chat | What Friday did wrong |
|---|-----------------|------------------------|
| F1 | Weekday/date math wrong, 3× | Said 22 = Sunday, 23 = Monday. Real: 21 = Sun, 22 = Mon, 23 = Tue. Only fixed after user corrected. |
| F2 | Hallucinated reminder times | Claimed water-change at 01:00 / 02:00, then retracted ("system didn't specify time clearly"), then invented 10:00. |
| F3 | Forgot tank constraints mid-thread, 2× | Proposed 16:30 Monday — inside the light window (15:00–22:30) the user had declared off-limits. Re-forgot one turn later. |
| F4 | Missed same-day commitments | Did not surface Sunday club-room 09:00 / Central Hatyai 10:00 until the user prompted "วันอาทิตย์มีงานไม่ใช่หรอ". |
| F5 | Execute-then-correct loop | Posted "✅ เรียบร้อยค่ะ จัดการให้แล้ว" on reminder updates that were re-proven wrong the next turn. |
| F6 | Apology spam, no learning | Same error class repeated every turn; apology never became a verification step. |

Core pattern: **Friday answers scheduling questions from raw context by
eyeballing, not from a deterministic computation.** This directly violates the
project's own rule ("answer from evidence, not vibes" — `CLAUDE.md`).

---

## 2. Root causes (code-level)

### RC1 — No deterministic conflict/availability check on the chat read path
The conflict engine `analyzeSchedule` (`scheduleHealth.ts`) and the create-time
checker `findCreateConflicts` (`eventConflicts.ts`) exist and are solid. But the
callers are **only**: `actionDispatcher.ts` (at create), `routes/calendar.ts`
(health endpoint), `routes/approvals.ts` (preloader). They are **never** invoked
from `chat.ts` / `chatPrompt.ts`.

When the user asks "does the water change clash with class?", `buildChatContext`
(`chat.ts:307`) assembles raw lists of events/reminders/facts and hands them to
the model. No clash is computed. The model free-hand reasons over timestamps →
F1, F4.

### RC2 — Per-item weekday and Bangkok local time are not pre-computed
`bangkokWallClock` (`agenda.ts:46`) spells out the weekday **only for "now"**.
Every event line (`chatPrompt.ts:302`) and reminder line (`chatPrompt.ts:317`)
is rendered as a **raw UTC ISO string** with no weekday and no Bangkok
conversion. The model must (a) add +7h and (b) derive day-of-week itself for
each item. That is exactly the arithmetic it got wrong → F1 (21/22/23) and F2
(UTC 00:00Z → fabricated "01:00/02:00"). Memory note `reminder-tz-bug` shows this
TZ class of error has bitten before.

### RC3 — Class schedule and tank rules live as free-text facts, invisible to the engine
`analyzeSchedule` ingests `GoogleEvent[]` only. The Monday class block ("Fact
#44") and the tank windows (CO2 12:00–20:30, light 15:00–22:30, no-disturb) are
stored as **unstructured fact text**. There is no machine model of:
- recurring weekly class blocks, or
- protected "do-not-disturb" windows for the tank.

So even if the engine ran on the read path, it could not see class times or tank
windows. The model is the only thing interpreting them → F3, F4.

### RC4 — Durable constraints are recalled per-message by keyword, then drop out
`recallFacts` (`factRecall.ts:39`) selects facts by keyword overlap with the
**current** message (plus pinned). The tank/class facts are not pinned. When a
follow-up has no matching keyword — e.g. "เลื่อนไปอังคาร 7:00" — the tank
constraint is **not recalled** and silently leaves the prompt. Friday literally
loses the rule mid-conversation → F3. There is no concept of an *active
scheduling constraint set* held for the duration of a topic.

### RC5 — Reminders and local events are excluded from conflict analysis
The conflict engine only consumes Google events. The water-change item is a
**Reminder**; the class is a **fact**. A cross-source conflict (reminder vs class
vs tank window vs calendar event) is never computed in a single pass anywhere in
the codebase → F4, F5.

### RC6 — No verifier gate for scheduling claims
For LINE, the project already has a deterministic `evidenceVerifier` that blocks
unsupported claims before the model speaks (`chat.ts:572`). **No equivalent
exists for scheduling.** The model emits "free / clashes / moved to X" with no
deterministic recheck. Every wrong verdict is caught only reactively by the user
→ F1–F4, F6.

### RC7 — Auto-execute fires before constraints are validated (execute-then-correct)
`buildActionReport` (`chat.ts:118`) posts "✅ เรียบร้อยค่ะ จัดการให้แล้ว" the moment
an eligible action executes. Create-time conflict gating exists for **Google
event create** only (`actionDispatcher.ts`), not for **reminder create/update**
and not against tank/class constraints. So a reminder.update onto a bad time
auto-executes and is reported done, then re-corrected next turn → F5.

### Summary map

| Root cause | Drives |
|------------|--------|
| RC1 no read-path conflict check | F1, F4 |
| RC2 weekday/TZ not pre-computed | F1, F2 |
| RC3 class/tank unstructured | F3, F4 |
| RC4 keyword-only fact recall | F3 |
| RC5 reminders/local excluded | F4, F5 |
| RC6 no schedule verifier | F1–F4, F6 |
| RC7 execute-before-validate | F5 |

---

## 3. Design principles for the fix

1. **Deterministic first, model second.** The backend computes
   availability/conflicts; the model only narrates the computed result. Same
   philosophy already used for LINE evidence and create-time conflicts.
2. **One unified availability pass** over all sources: Google events + local
   events + reminders + structured constraints (class, tank windows).
3. **Constraints are structured and sticky** — held for the whole scheduling
   topic, not re-fetched by keyword each turn.
4. **Verify before assert, validate before execute.** No "free/clash" claim and
   no reminder/event write at time T without passing the deterministic check.
5. **Reuse existing patterns** (`analyzeSchedule`, `evidenceVerifier`,
   create-time gate). Avoid new abstractions where an extension fits.

Non-goals: no AI call added to the scheduler, no vector DB, no new external
connector, no LINE write. Keep every change small, reversible, behind the same
approval/auto-execute policy.

---

## 4. Implementation plan (sprints)

Each sprint is independently shippable and independently testable.

### Sprint 0 — Repro harness & fixtures
- **Goal:** lock the failure down with a deterministic, AI-free reproduction.
- **Scope:** new smoke `smoke-step27` that seeds the transcript scenario — a
  Monday class fact, tank CO2/light/no-disturb facts, the water-change
  reminder(s), Sunday club-room + Central Hatyai events — and asserts current
  (wrong) behavior so later sprints flip the assertions green.
- **Files:** `packages/backend/scripts/smoke-step27.ts` (new); `package.json`
  script entry; small fixture builder.
- **Tests:** `npm run build`, `npm run smoke:step27` (red baseline).
- **Risk:** none (test-only).
- **Exit:** harness reproduces F1–F5 deterministically without calling any model.

### Sprint 1 — Pre-computed temporal rendering (fixes RC2)
- **Goal:** the model never does weekday or UTC→Bangkok math.
- **Scope:** add a per-instant helper (weekday + Bangkok wall-clock + date) and
  render every event/reminder/local-event line with Bangkok time **and** weekday
  inline. Keep raw UTC id/anchor where needed for action targeting.
- **Files:** `agenda.ts` (export a per-item formatter beside `bangkokWallClock`),
  `chatPrompt.ts` (event/reminder/event render blocks ~lines 296–319),
  `chat.ts` (pass formatted fields if computed there).
- **Tests:** `npm run build`, `npm run smoke:step12`, `npm run smoke:persona`,
  unit test for the formatter (weekday correctness across a week + DST-free TZ).
- **Risk:** low; pure presentation. Watch prompt size.
- **Exit:** F1/F2 weekday & time strings are correct in the rendered prompt; the
  smoke-step27 weekday/time assertions can flip green.

### Sprint 2 — Structured schedule-constraint model (fixes RC3, RC4)
- **Goal:** class blocks and tank windows become first-class structured data that
  stays in context for the whole scheduling topic.
- **Scope:**
  - Define a `ScheduleConstraint` schema: `kind` = `protected_window` (tank
    CO2/light/no-disturb) | `recurring_block` (weekly class); fields for
    weekday(s), local start/end, label, source.
  - Provide a deterministic source: either (a) parse the existing tank/class
    facts into constraints, or (b) a small constraint store seeded from those
    facts. Prefer a thin store fed from facts to avoid brittle NLP.
  - Mark these constraints **sticky**: always injected into chat context for any
    scheduling-intent message (not gated by keyword recall).
- **Files:** `schemas/scheduleConstraint.ts` (new),
  `services/scheduleConstraints.ts` (new resolver/loader),
  `chat.ts` (inject into `ChatContext`), `chatPrompt.ts` (new CONSTRAINTS block).
- **Tests:** `npm run build`, `npm run smoke:step27`, unit tests for
  fact→constraint parsing and sticky injection.
- **Risk:** medium — parsing free-text tank/class facts. Mitigate by keeping the
  parser conservative and falling back to raw fact text when unsure.
- **Exit:** tank windows + Monday class appear as structured constraints in
  context on every scheduling turn, including keyword-free follow-ups (F3).

### Sprint 3 — Unified availability/conflict resolver on the read path (fixes RC1, RC5)
- **Goal:** one deterministic pass answers "is time T free, and what clashes?"
  across all sources.
- **Scope:**
  - New `services/availabilityResolver.ts` that normalizes Google events + local
    events + reminders + Sprint-2 constraints into intervals and reuses
    `analyzeSchedule`'s interval logic (extend it to accept non-Google sources,
    or wrap it).
  - Compute, for the scheduling turn, a compact **availability findings** block
    (clashes, protected-window violations, free windows) and inject it into
    `ChatContext`.
- **Files:** `services/availabilityResolver.ts` (new), small refactor of
  `scheduleHealth.ts` to accept a generic interval source, `chat.ts`
  (`buildChatContext` calls the resolver for scheduling-intent messages),
  `chatPrompt.ts` (render AVAILABILITY / CONFLICTS block).
- **Tests:** `npm run build`, `npm run smoke:step27`, reuse step23/24/26 schedule
  smokes to ensure no regression, unit tests for cross-source clash cases.
- **Risk:** medium — interval normalization across sources and TZ. Heavy unit
  coverage required.
- **Exit:** for the transcript scenario the resolver outputs the correct clash
  set (class vs proposed time, tank-window violation, Sunday commitments) with no
  model involvement (F1, F4, F5 inputs now deterministic).

### Sprint 4 — Schedule verifier + constraint-aware action gate (fixes RC6, RC7)
- **Goal:** block unsupported claims before they're spoken, and block bad writes
  before they execute.
- **Scope:**
  - `services/scheduleVerifier.ts` mirroring `evidenceVerifier`: given the
    proposed answer intent + availability findings, emit ALLOWED/BLOCKED guidance
    injected into the prompt (e.g. "BLOCKED: do not claim 16:30 Mon is free — it
    violates light window").
  - Extend the create-time gate so **reminder.create / reminder.update / event
    create+update at a specific time** run through the resolver and are held for
    confirm (not auto-executed) when they violate a protected window or clash —
    same mechanism as the existing Google-event conflict hold
    (`actionDispatcher.ts`, `eventConflicts.ts`).
- **Files:** `services/scheduleVerifier.ts` (new), `actionDispatcher.ts`
  (extend conflict gate to reminders + constraints), `chat.ts` (wire verifier),
  `chatPrompt.ts` (render verifier guidance, forbid eyeballing).
- **Tests:** `npm run build`, `npm run smoke:step27`, `npm run smoke:step11`
  (scheduler/notifications), `npm run smoke:persona`.
- **Risk:** medium-high — touches the execute path. Keep fail-closed: any
  resolver/verifier error → no new claim, fall back to current behavior, never
  block a legitimate action silently.
- **Exit:** F5 gone — a constraint-violating reminder update is held for confirm
  with a clear warning instead of auto-reported done; F6 reduced — contradictions
  are caught deterministically, not via apology.

### Sprint 5 — Prompt/persona hardening + full regression
- **Goal:** make the model consume the computed blocks and stop free-handing.
- **Scope:** rewrite the PLANNING & ADVICE / scheduling section of `chatPrompt.ts`
  to require using the AVAILABILITY + CONSTRAINTS + VERIFIER blocks and to forbid
  deriving weekday/time or judging clashes by eye. Add persona invariants.
- **Files:** `chatPrompt.ts`, `smoke-persona.ts` (new scheduling invariants),
  `smoke-step27.ts` (flip all assertions green).
- **Tests:** `npm run build`, `npm run smoke:step27`, `npm run smoke:step12`,
  `npm run smoke:persona`, `npm run smoke:phase3`/`phase4`.
- **Risk:** low-medium — prompt drift. Guard with persona mirror tests.
- **Exit:** the full transcript scenario produces correct, constraint-respecting,
  non-hallucinated answers end to end.

---

## 5. Sprint dependency order

```
Sprint 0 (repro)
   └─> Sprint 1 (temporal render)      ── independent, ship first, high value
   └─> Sprint 2 (constraint model)
            └─> Sprint 3 (availability resolver)
                     └─> Sprint 4 (verifier + action gate)
                              └─> Sprint 5 (prompt + regression)
```

Sprint 1 is independent and the cheapest large win (kills the weekday/TZ class of
error). Sprints 2→4 are the structural fix and must land in order. Sprint 5 seals
it at the prompt layer.

## 6. Definition of done (whole effort) — VERIFIED

Status per item (`smoke:step27` = 38 PASS; also build, `smoke:persona`,
`smoke:step12` green):

- [x] F1–F5 reproduced by `smoke-step27` and flipped green (RC1–RC7 asserted).
      F6 (apology→verification) is addressed structurally by the verifier + gate
      but has no dedicated assertion — functionally covered, not directly tested.
- [x] No model call added to the scheduler; no new connector; LINE untouched.
- [x] Reminders, local events, Google events, class blocks, and tank windows are
      all considered in one deterministic availability pass (`availabilityResolver`).
- [x] Constraint-violating writes are held for confirm, never auto-reported as
      done (`actionDispatcher` constraint gate, Sprint 4).
- [x] UTC ISO storage, app-maintained `updated_at`, and the approval/auto-execute
      policy are all preserved.

### Sprint-to-code map
| Sprint | Delivers | Key files |
|--------|----------|-----------|
| 0 | repro harness | `scripts/smoke-step27.ts` |
| 1 | pre-computed temporal render (RC2) | `agenda.ts`, `chatPrompt.ts` |
| 2 | structured sticky constraints (RC3, RC4) | `schemas/scheduleConstraint.ts`, `services/scheduleConstraints.ts` |
| 3 | unified availability resolver (RC1, RC5) | `services/availabilityResolver.ts` |
| 4 | schedule verifier + action gate (RC6, RC7) | `services/scheduleVerifier.ts`, `actionDispatcher.ts` |
| 5 | prompt/persona hardening + regression | `chatPrompt.ts`, `scripts/smoke-persona.ts` |
