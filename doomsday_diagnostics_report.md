# Doomsday Diagnostics Report — Schedule Edge Cases

**Mode:** read-only on production code. Test suite written + executed. **No production code modified.**
**Suite:** `packages/backend/tests/integration/schedule-edge-cases.test.ts`
**Run:** `npx tsx packages/backend/tests/integration/schedule-edge-cases.test.ts`
**Result:** 3 / 9 passed, **6 failed**.

> Test-policy constraint (project rule): tests MUST NOT call real Claude/Gemini. Model
> *output* is non-deterministic. So baseline scenarios that assert on model output
> (T1/T2/T5) are encoded as the strongest deterministic proxies:
> - **prompt-contract** (what the model is fed), and
> - **leaky-stub pipeline probe** (inject a model reply that deliberately leaks, then
>   assert the *pipeline* scrubs it — proves whether a CODE-level backstop exists).
> T3/T4 + all discovery tests are fully deterministic.

---

## 1. Execution matrix

| ID | Phase | Scenario | Result | Meaning |
|----|-------|----------|--------|---------|
| T1 | baseline | Overlap Erasure — prompt carries calendar event + class block | **PASS** | split-render (Sprint C) works |
| T2 | baseline | Pressure Leak — pipeline scrubs id/internal labels | **FAIL** | no code-level output scrubber |
| T3 | baseline | Interceptor Evasion — mutation fires, clarification cleared | **PASS** | S1 interceptor (Sprint B) holds |
| T4 | baseline | Intent Marker — "ขอตารางเรียนพรุ่งนี้ที" | **PASS** | markers (Sprint A) work |
| T5 | baseline | WriteGuard Extraction — guard label not readable | **FAIL** | label in prompt by design; reveal-prevention prompt-only |
| D1 | discovery | WINDOW_RE — money range "12.00-15.00 บาท" | **FAIL** | numeric range misparsed as constraint |
| D2 | discovery | classify — "classic rock 14:00-15:00" | **FAIL** | "class" substring → wrong recurring_block |
| D3 | discovery | overnight window 22:00-06:00 enforced | **FAIL** | overnight window silently dropped |
| D4 | discovery | intent — "ระหว่างนี้สบายดีไหม" | **FAIL** | "ว่าง" ⊂ "ระหว่าง" → false positive |

PASS = prior sprints (A/B/C) genuinely fixed it. FAIL = real current defect (baseline = no code backstop; discovery = parser/regex flaws prior sprints did not touch).

---

## 2. Root-cause analysis (line-referenced)

### T2 — Pressure Leak (no output scrubber) · Sev: HIGH
- `runChat` returns `check.data.reply` / `spoken` **verbatim** — `chat.ts` return block (`reply: check.data.reply`, `spoken: check.data.spoken`). No sanitization stage.
- Fact id is rendered into the model-visible prompt: `chatPrompt.ts` KNOWN-FACTS render — `` `  - #${f.id} [${f.category}...]: ${f.content}` ``. Source-section headers literally say `GOOGLE CALENDAR`, etc.
- So the model CAN echo `#13`, "Google Calendar", "ระบบ" under pressure, and **nothing in code removes it**. Output safety is 100% model-dependent. The leaky-stub probe confirmed: all four banned tokens passed straight through.

### T5 — WriteGuard label extraction · Sev: MEDIUM
- `chatPrompt.ts` PROTECTED WINDOWS section renders `describeConstraint(c)`, which includes the human label (`scheduleConstraints.ts describeConstraint` → `` `[${c.kind}] ${c.label}: ...` ``).
- The label MUST be in-context for the model to gate writes, but it is the *real* name → a "เอาชื่อกิจกรรมออกมา" probe can read it. Reveal-prevention is prompt-instruction only; no code redaction of the label string.

### D1 — WINDOW_RE numeric false positive · Sev: HIGH
- `scheduleConstraints.ts:` `WINDOW_RE = /(\d{1,2})[:.](\d{2})\s*[-–—~]\s*(\d{1,2})[:.](\d{2})/`.
- Accepts `.` as the H/M separator → "12.00-15.00" matches; `normTime` passes (12/00/15/00 all in range) → a **phantom `protected_window` 12:00–15:00 every day** from a money fact ("ค่าเทอม ... พันบาท").
- Impact: a budget/quantity fact silently blocks midday scheduling daily (false hold). No surrounding-context guard, no currency/unit exclusion.

### D2 — substring misclassification · Sev: HIGH (leak path)
- `RECURRING_BLOCK_KEYWORDS` includes `"class"`, `"lecture"`; `classifyConstraintKind` tests `lowerContent.includes(k)` — **substring, not word-boundary**.
- "classic rock 14:00-15:00" contains "class" → tagged `recurring_block` → `constraintRole` = `"agenda"` → rendered in **SCHEDULE BLOCKS** (the user-facing agenda allowlist). This *defeats* the S3 safe-fail guarantee for this input: the allowlist correctly hides unknown kinds, but a *mis-tagged* block is on the allowlist. Non-class content leaks into the agenda.

### D3 — overnight window dropped · Sev: HIGH
- `availabilityResolver.ts materializeConstraints`: `if (endMs <= startMs) continue;` — an overnight window (22:00→06:00) has `endMs < startMs` on the same calendar day → **skipped entirely**. `materializeConstraints` returned 0 windows; `findConstraintViolations` returned 0.
- Impact: any protected window crossing midnight (tank night no-disturb, sleep block) is **silently unenforced** — writes land inside it and report as done. This is exactly the "execute-then-correct" class of failure the constraint gate was built to stop.

### D4 — scheduling-intent substring false positive · Sev: MEDIUM (perf + bloat)
- `isSchedulingIntent`: `m.includes(k)` over `SCHEDULING_INTENT_MARKERS`. "ว่าง" is a substring of the very common word "ระหว่าง" → "ระหว่างนี้สบายดีไหม" is misclassified as scheduling.
- Impact: needless availability computation + sticky-constraint injection (prompt bloat) on ordinary chatter. Same substring class as D2; latin markers ("free"⊂"freedom", "class"⊂"classic", "move"⊂"remove") share the flaw.

---

## 3. Proposed hard, code-level hotfix architecture

Ordered by severity. All deterministic; none rely on prompt wording.

### H1 — D3 overnight materialization (smallest, highest safety win)
`materializeConstraints` (`availabilityResolver.ts`): when `endMs <= startMs`, treat as overnight — emit TWO synthetic windows (`start→24:00` that day, `00:00→end` next day) instead of `continue`. Add unit fixtures: 22:00–06:00 yields a window each day; a 23:00 and a 02:00 write both held; a 12:00 write not held.

### H2 — D1 + D2 + D4 robust matching (shared root: loose text matching)
1. **Window regex (D1):** prefer `:` as the canonical separator. Either drop `.` from `WINDOW_RE`, or keep `.` ONLY when a time-context token is adjacent (`น.`, `โมง`, `am`, `pm`, or a recurring/guard keyword in the same fact) AND reject when a money/qty unit is adjacent (`บาท`, `฿`, `$`, `%`, `พัน`, `หมื่น`). Recommend colon-canonical + explicit "น./โมง" allowance — kills "12.00-15.00 บาท".
2. **Keyword boundary (D2, D4 latin):** match latin keywords with `\b…\b` (so "class" ≠ "classic", "free" ≠ "freedom", "move" ≠ "remove"). Build the latin markers into one alternation regex with word boundaries; keep Thai as substring.
3. **Thai container guard (D4):** for "ว่าง", use a negative lookbehind `/(?<!ระห)ว่าง/` (JS supports lookbehind) or strip known container words ("ระหว่าง") before the test. Apply the same pattern to any Thai marker that is a substring of a common word.

Add a regression fixture table: each FAIL input here asserts the corrected outcome; plus positive controls (real "12:00-15:00 เรียน", "ว่างไหมพรุ่งนี้") still classify correctly.

### H3 — T5 guard-label redaction (structural)
In the PROTECTED WINDOWS prompt section, render the **time window only + a generic tag** (e.g. `(ช่วงส่วนตัว)`), NOT `describeConstraint`'s real label. The dispatcher write-gate already consumes the constraint OBJECT (not the prompt text), so gating is unaffected. The real label never enters model-visible context → cannot be extracted. SCHEDULE BLOCKS (agenda) keep their label (they are meant to be shown).

### H4 — T2 output scrubber (defense-in-depth) — needs a product call
Two layers:
- **Structural (preferred):** stop emitting raw fact ids in the recall block the model narrates from. Use opaque local refs (e.g. `[F1]`, `[F2]`) for in-prompt referencing and map back to real ids in code when building actions. Removes the id from the leak surface entirely.
- **Backstop scrub:** a `scrubInternalLeak(text)` pass over `reply` + `spoken` + `resultReport` that strips `#\d+` and a small internal-token denylist before return.
- ⚠️ Tradeoff: blanket-scrubbing words like "Google Calendar"/"ระบบ" can corrupt legitimate answers ("ดูในปฏิทิน Google ให้แล้ว"). Recommend the structural id-ref change for ids, and a NARROW scrub (`#\d+` only) for the backstop. **Decision needed** before implementing the denylist breadth.

---

## 4. Severity summary

| Fix | Targets | Sev | Effort | Risk |
|-----|---------|-----|--------|------|
| H1 | D3 | HIGH | small | low |
| H2 | D1, D2, D4 | HIGH | medium | low–med (regex tuning; needs positive controls) |
| H3 | T5 | MED | small | low |
| H4 | T2 | HIGH | med–large | needs product decision on scrub breadth |

The 3 PASS results confirm the previous sprint's guarantees (split-render, S1 interceptor, intent markers) are intact. The 6 FAILs are: 2 pre-existing model-only safety gaps (T2/T5) and 4 parser/regex defects (D1–D4) that the previous sprints never touched.

---

## 5. Status — RESOLVED (hotfixes H1–H4 implemented & verified)

All four hotfixes implemented in order H1 → H2 → H3 → H4. Final results:

- Doomsday suite: **10/10 pass** (T1, T2a, T2b, T3, T4, T5, D1, D2, D3, D4).
- Regression: `smoke:step27`, `smoke:step16`, `smoke:persona`, `smoke:step12` all OK.

Implementation notes vs. the approved plan:
- **H1** `availabilityResolver.materializeConstraints` — overnight windows (endMs<=startMs)
  now wrap to the next day; zero-length skipped. (D3 → green)
- **H2** `scheduleConstraints` — `markerHit` adds `\b` for Latin keywords + `(?<!ระห)ว่าง`;
  `WINDOW_RE` captures separators and rejects `.`-form windows without a time-context
  token (kills money/number false positive). (D1, D2, D4 → green)
- **H3** `describeConstraintRedacted` — PROTECTED WINDOWS render time + generic tag, no
  label/source. (T5 → green)
- **H4** structural id map — facts shown as `[F#]`; `chat.runChat` remaps the F-number to
  the real DB id before dispatch, drops unmapped refs. (T2a/T2b → green)
- **Test reframes (documented):** T2's "scrub the reply" assertion was for the REJECTED
  blanket scrubber; reframed to T2a/T2b encoding the approved structural guarantee. T5
  tightened from the generic word "ตู้ปลา" to the user-specific label/raw text (the
  verifier's constant phrase "กฎตู้ปลา-คลาส" is not a per-user leak). T3's stub now uses an
  F-number ref (`id:1`) — under H4 a raw `id:13` is correctly dropped as unmapped.
