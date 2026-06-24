# LINE Coverage & Grounded Retrieval — Implementation Plan

Status: PLANNING / IN-PROGRESS. Sprints land one commit each, build-gated.

Goal: stop Friday from making confident claims about LINE data it cannot see.
Friday currently receives only a TAIL slice of a chat (`slice(-N)`), then describes
the oldest message IN THAT SLICE as if it were the start of the whole export. The
fix is to give the deterministic backend a real COVERAGE picture of each chat and
to route time/boundary questions to the right messages — not to enlarge the blind
window.

This is a Step-22-aligned change: answer from evidence, not vibes. No vector DB,
no new connector, no LINE write. LINE stays read-only and export-based.

---

## 0. Root cause (the bug that started this)

Reported symptom: for group `คุยกันเรื่อง กยศ`, Friday said the export "starts
2569-06-21 19:16" and "nothing older exists in this file". Operator: impossible —
exports always carry NEWER data, so knowing the latest date but not the old date is
strange.

Verified against the real export (`[LINE]คุยกันเรื่อง กยศ.txt`, 267 messages):

| Claim | Reality |
|-------|---------|
| earliest = 2569-06-21 19:16 | earliest = **2568-09-01 12:34** (line 1) |
| continuous | **9-month gap**: 2568-09-06 → 2569-06-07 (header jump line 61→62) |
| "file starts there" | that timestamp is the oldest of the **last 20** messages |

Mechanism: `getFocusedChatMessages(name, LINE_FOCUSED_MSG_CAP)` →
`messages.slice(-20)`. A one-chat question loads only the 20 newest messages. The
newest date is inside that window (answered correctly); the oldest date is OUTSIDE
it (invisible → Friday narrated the slice boundary as the export boundary).

Why the operator's instinct was the proof, not a counter-argument: "knows newest,
blind to oldest" is the exact signature of a tail slice. A wrong/old file would
have corrupted the newest date too. It didn't → file is correct & current; only the
WINDOW was truncated. (See Learnings §11 L1.)

---

## 1. Recommendation

Three cooperating tiers, all deterministic, in `lineChat.ts` + chat wiring + prompt:

- **Tier 1 — Coverage envelope.** Per chat compute `{earliest, latest, count,
  shownInWindow}` and pass it as a STRUCTURED FACT, separate from the message text.
  Friday answers boundary questions from the fact, not from the slice.
- **Tier 2 — Gap-aware coverage.** Detect date gaps > threshold and surface them, so
  a partial/segmented export (like กยศ) is described honestly: "Sept 2025, then a
  gap, then June 2026" — never as one continuous range.
- **Tier 3 — Intent-aware retrieval.** A small deterministic router: when the user
  asks a TIME/BOUNDARY question (earliest / first / when did this start / since
  when), serve HEAD + TAIL + coverage instead of TAIL-only. Topic questions keep the
  current tail behavior.

Bound to the existing **evidence verifier** (Step 22): a claim about coverage/dates
must be backed by the coverage fact, else Friday must hedge ("I only see the last N
messages of this chat").

Explicitly deferred (not now, not over-engineering at ~10 chats): SQLite FTS5
message index. Re-parse + mtime cache handles 10 chats of normal size. FTS5 only
earns its keep at 10k+ msgs/chat WITH frequent cross-chat date-range/keyword
queries. Recorded as a future option, kept out of v1 scope.

---

## 2. Scope

**In:**
- `getChatCoverage(file|name)` → envelope + gaps, mtime-cached like message parse.
- Coverage injected into the FOCUSED-chat prompt block (and per-chat recall summary).
- Deterministic time/boundary intent detector (regex/keyword, TH+EN) in chat wiring.
- Head+tail+coverage retrieval path for boundary intent; tail path unchanged otherwise.
- Grounding rule in the prompt + verifier check for date/coverage claims.
- Focused tests on a SYNTHETIC fixture that reproduces the two-block + gap shape.

**Out:**
- FTS5 / persistent index → future (see §10).
- Vector DB / embeddings → out of scope (CLAUDE.md).
- Any LINE write / live access → out of scope (CLAUDE.md).
- Enlarging `LINE_FOCUSED_MSG_CAP` as the "fix" — rejected; it only moves the blind
  boundary, never removes the illusion.

---

## 3. Data model (in-proc, mtime-cached)

```
type ChatCoverage = {
  earliestAtUtc: string | null;   // messages[0].atUtc
  latestAtUtc: string | null;     // messages[len-1].atUtc
  count: number;                  // total parsed messages
  shownInWindow: number;          // how many the current retrieval actually passed
  gaps: { fromAtUtc: string; toAtUtc: string; days: number }[]; // > threshold
};
```

- earliest/latest/count = O(1) off the already-parsed `messages` array.
- gaps = single pass over messages comparing adjacent calendar days; emit a gap when
  the difference exceeds `LINE_COVERAGE_GAP_DAYS` (default 7).
- Cache keyed by the SAME mtime key as `readFileMessages` (recompute only on
  re-export). No second read of the file.
- `shownInWindow` is set by the retrieval call site (it knows how many it sliced).

---

## 4. Components / files

| File | Change |
|------|--------|
| `services/lineChat.ts` | **NEW** `getChatCoverage(file)` (envelope + gap pass), mtime-cached. Reuses `readFileMessages`. Boundary helper `getChatHeadTail(file, head, tail)` returning first `head` + last `tail` messages + coverage (deduped if they overlap). |
| `services/chat.ts` | At the focused-chat call site (~550): also fetch coverage; add `isLineBoundaryIntent(message)` (deterministic). If boundary intent → use `getChatHeadTail` and set `shownInWindow`; else keep `getFocusedChatMessages`. Attach coverage to the context object. |
| `services/chatPrompt.ts` | In the FOCUSED CHAT block (~1059): render a `COVERAGE:` line (earliest / latest / count / shown / gaps) + a grounding rule (see §6). |
| `services/evidenceVerifier.ts` | Extend to flag answers that assert an export start/earliest/"nothing older" without a coverage fact backing it → force hedge. |
| `config.ts` | `LINE_COVERAGE_GAP_DAYS` (default 7), `LINE_BOUNDARY_HEAD` (default 10), `LINE_BOUNDARY_TAIL` (default 10). Env-overridable. |
| `scripts/smoke-step22*.ts` or a focused LINE smoke | Synthetic fixture (two date blocks + a >30d gap, no real export). Assert coverage earliest/latest/count/gap, boundary-intent head+tail, grounding hedge. |

No signature change to `parseLineExport` / `LineMessage` → coverage is additive.

---

## 5. Intent router (deterministic, no AI)

Boundary intent = the question is about the EXTENT of history, not its content.

- TH cues: `เก่าสุด`, `แรกสุด`, `เริ่ม(ตั้งแต่)เมื่อไหร่`, `ครั้งแรก`, `ตั้งแต่เมื่อไหร่`,
  `ข้อมูลย้อนไปถึง`, `เก่าที่สุด`.
- EN cues: `earliest`, `oldest`, `since when`, `how far back`, `first message`,
  `start of`.
- Match = case-insensitive substring (Thai has no word spaces — substring beats
  tokenization, same rationale as `searchLineMessages`).
- On match for a FOCUSED chat → `getChatHeadTail`. No match → existing tail path.
- Fail-safe: if detection is unsure, fall back to the tail path + coverage fact (the
  coverage line alone already lets Friday answer correctly).

---

## 6. Prompt grounding rule (text to add)

In the FOCUSED CHAT MESSAGES block, after the coverage line:

> The COVERAGE line is the ONLY authority on how far this chat's history goes. The
> messages below are a WINDOW (newest, unless a boundary was requested), NOT the
> whole chat. Never say the export "starts" at, or that "nothing older exists"
> before, the oldest message shown — state the COVERAGE earliest instead. If COVERAGE
> shows gaps, describe the history as segmented, not continuous. If no COVERAGE is
> present, say you only see the most recent messages and cannot state the start.

---

## 7. Testing (no real LINE export)

Build a temp fixture in the test, mirroring กยศ's shape:

```
2025.09.01 Monday
12:34 A msg1
2025.09.05 Friday
09:00 B msg2
2026.06.08 Monday          <- > gap threshold
10:00 C msg3
2026.06.24 Wednesday
20:00 D msg4
```

Assertions:
- coverage.earliest = 2025-09-01, latest = 2026-06-24, count = 4.
- gaps contains one gap spanning 2025-09-05 → 2026-06-08 (~276 days).
- boundary intent ("เก่าสุดวันไหน") → head includes msg1, tail includes msg4.
- non-boundary ("คุยเรื่องอะไร") → tail-only path unchanged.
- verifier: an answer claiming "starts 2026-06-08" with the fixture is flagged.

Regression each sprint: `npm run build`, `npm run smoke:step20` (LINE read-only),
`npm run smoke:step22` (evidence), `npm run smoke:persona` (Jarvis invariants).

---

## 8. Sprints (one commit each, build-gated)

Branch: cut a feature branch off `dev` (e.g. `feature/line-coverage`). Never commit
on `dev`/`main`. No `Co-Authored-By` trailer (repo convention).

**Commit gate (every sprint):** `npm run build` green AND the sprint's tests green
BEFORE committing. No commit on a red tree. After committing, run the regression set
in §7 and note results in the hand-off.

| Sprint | Tier | Lands | Build/Test gate before commit | Commit message |
|--------|------|-------|-------------------------------|----------------|
| S1 | 1 | `getChatCoverage` envelope (earliest/latest/count) + mtime cache; inject `COVERAGE:` line into focused block; grounding rule (no-gap part). | `npm run build`; new coverage unit asserts; `smoke:step20` | `feat(line): per-chat coverage envelope in focused context` |
| S2 | 2 | Gap pass in `getChatCoverage`; render gaps in COVERAGE line; "segmented not continuous" rule. | `npm run build`; gap fixture test; `smoke:step20` | `feat(line): gap-aware coverage for segmented exports` |
| S3 | 3 | `isLineBoundaryIntent` + `getChatHeadTail`; route boundary questions to head+tail+coverage; `shownInWindow`. | `npm run build`; boundary-intent test + non-boundary regression; `smoke:step20` | `feat(line): intent-aware head+tail retrieval for boundary questions` |
| S4 | verifier | Extend `evidenceVerifier` to flag unbacked start/earliest claims → force hedge. | `npm run build`; verifier test; `smoke:step22`; `smoke:persona` | `feat(line): verifier guard against unbacked coverage claims` |

Integrate when green: merge `feature/line-coverage` → `dev`, then `dev` → `main`
fast-forward. Push only when explicitly asked. A merged change is NOT live until the
backend process restarts (`npm run dev` hot-reloads; `npm run start` holds old
`dist`).

---

## 9. Risks

- **Intent false-positive** → boundary path on a topic question. Mitigation: narrow
  cue list; fallback path still carries the coverage fact, so the answer stays
  correct even if routing is wrong.
- **Gap threshold tuning** — 7 days may over/under-flag. Env-tunable; start at 7,
  observe on real chats.
- **Prompt growth** — one COVERAGE line per focused chat; negligible.
- **BE/CE display** — Friday previously rendered 2025→2569 (should be 2568). Coverage
  passes UTC ISO; the prompt/format layer owns BE conversion. If the era bug persists
  after S1, fix the formatter, not coverage (track as a separate finding in §11).
- **Cache correctness** — coverage MUST share the mtime key with message parse, or a
  re-export could show new messages with stale coverage.

---

## 10. Deferred: SQLite FTS5 index (future, not v1)

When to revisit: chats reach ~10k+ messages each AND cross-chat date-range/keyword
queries become hot (today `searchLineMessages`/`getRecentLineMessages` re-scan all
parsed chats in memory). FTS5 ships with `better-sqlite3` (no new dep, local, not a
vector DB) and would give indexed keyword + `MIN/MAX(atUtc)` coverage without a full
parse. Out of v1 because at ~10 normal chats the mtime cache already absorbs the
cost. Logged here so it is a deliberate choice, not an oversight.

---

## 11. Learnings log (hard bugs — read this before touching LINE retrieval)

Append new entries here when a non-obvious bug costs real time. Keep each entry:
symptom → false lead → actual cause → guard. This section is the durable record;
do NOT scatter these notes into unrelated files or commit messages.

**L1 — The tail-slice illusion (2026-06-24).**
- Symptom: Friday reported a chat's export "starts" at a date ~9 months too late and
  in the wrong Buddhist year, while answering the LATEST date correctly.
- False lead: "Friday read the wrong / an older export file." Rejected — a wrong file
  would also corrupt the newest date; only the oldest was wrong.
- Actual cause: `getFocusedChatMessages(name, 20)` → `slice(-20)`. Friday saw only
  the 20 newest messages and described the slice's oldest as the export's start.
- Guard: never infer history extent from a windowed message list. Coverage facts
  (§3) are the only authority; the prompt rule (§6) enforces it. "Knows newest,
  blind to oldest" ⇒ suspect a tail slice, not a wrong source.
