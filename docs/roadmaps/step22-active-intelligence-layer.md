# Step 22 — Active Intelligence Layer

> Implementation contract for Sonnet. Read `AGENTS.md` and `CLAUDE.md` first.
> This is a binding spec, not a proposal. Implement EXACTLY what is written.
> If any section is ambiguous or conflicts with the live code, STOP and report —
> do not invent architecture, do not expand scope.

---

## 1. Purpose

Today Jarvis answers each chat turn from a flat, per-turn context bundle. It has
no notion of "things the user is actively tracking", so it cannot reliably:

- resolve a short follow-up to what was just discussed,
- ground a "did anyone answer?" question in actual exported LINE evidence, or
- proactively tell the user when new evidence appears for something they care about.

Step 22 adds a deterministic **intelligence layer** between the user (or the
scheduler) and the existing prompt/notification machinery. It introduces durable
**active topics**, a deterministic **topic resolver** for short follow-ups, a
**LINE evidence builder** over the already-ingested exports, an **evidence
verifier** that constrains what Jarvis may claim, and an optional **deterministic
scheduler triage** that notifies on new evidence — with NO model call.

Concrete behavior changes (all grounded in EXPORTED LINE data, never live LINE):

- **"อังกฤษ 04 ถึงไหนแล้ว"** — resolver matches the active topic "อังกฤษ 04",
  evidence builder pulls matching exported messages newer than the topic baseline,
  Jarvis summarizes the latest state from evidence (or says nothing new matched).
- **"มีใครตอบเรื่องนี้ยัง"** — short follow-up → resolve to the current topic →
  evidence builder finds candidate question(s) and candidate later replies →
  verifier permits "มีคนตอบ (น่าจะ X)" ONLY if a candidate answer exists, else
  permits only "ยังไม่เห็นคำตอบใหม่ใน export ล่าสุด".
- **"ในกลุ่มครอบครัวมีคนส่งรูปไหม"** — evidence builder filters by chat + media
  marker (`Photos`/`Photo`) over exports; answer reflects what export shows.
- **"ถ้ามีคำตอบใหม่จาก LINE เรื่องนี้บอกผม"** — proposes `active_topic.create`
  (approval-gated). Once approved, scheduler triage (if subphase implemented)
  deterministically notifies on new matching exported evidence.
- **"เรื่องนั้นล่ะ"** — pure elliptical follow-up → resolve to the single strong
  active topic; if two are plausible, ask ONE clarification, propose nothing.

**The goal is evidence-grounded intelligence, not live LINE access.** Every claim
Jarvis makes about LINE must trace to a snippet actually present in the exported
files. No live LINE, no read/unread state, no model call in the scheduler.

---

## 2. Current State (inspected files — not guessed)

### LINE export parser/search — `packages/backend/src/services/lineChat.ts`
- Read-only `.txt` export ingest. `parseLineExport(text)` → `LineMessage[]`
  (`{ date, time, atUtc, sender, text, system }`). `atUtc` is approximate UTC
  (Bangkok − 7h, minute granularity).
- mtime-keyed parse cache per file (semi-live re-read on file change).
- `searchLineMessages(keywords, cap)` — case-insensitive substring OR-match over
  all exports, newest-first, skips `system`/empty, **fail-soft `[]`** on
  disabled/error. Message text is NEVER logged.
- `getLineChatSummariesSafe()`, `getRecentLineByChatSafe(perChat, maxChats)`,
  `getRecentLineMessages(limit)` — all fail-soft `[]`.
- `isLineEnabled()` — DB `line_enabled` overrides env `LINE_ENABLED`.
- Path-traversal guard in `getLineMessages` (filename must be a listed export).

### Chat context builder — `packages/backend/src/services/chat.ts`
- `buildChatContext(message, fetchGoogle, verified)` assembles `ChatContext`
  (tasks, memory summaries, recalled facts, local+Google events, reminders,
  approval outcomes, history, Gmail, contacts, Drive, LINE chats/messages/matches,
  auto-execute flags, `restricted`).
- `extractLineKeywords(message)` — deterministic, drops `LINE_STOPWORDS`, caps 6.
- **HARD redaction gate**: when `!verified` it returns an object with all private
  fields emptied/genericized and `restricted: true` BEFORE any private string
  reaches the prompt. This is the real security boundary.
- `runChat(...)` → build context → invoke provider → `unwrapJsonOutput` →
  `JSON.parse` → `chatOutputSchema` (strict) → dispatch each action via
  `dispatchProposedAction(type, payload, "chat")` → persist user+assistant turns
  → `buildActionReport(dispatched)` posts a truthful second assistant message.
  Fails closed on every error path. Dispatch SKIPPED entirely when unverified.

### Chat prompt — `packages/backend/src/services/chatPrompt.ts`
- `buildChatPrompt(ctx)` renders persona + execution policy + privacy block +
  many SOURCE sections (OPEN TASKS, GMAIL, CONTACTS, DRIVE, LINE CHATS, LINE
  MESSAGES, LINE SEARCH MATCHES, GOOGLE CALENDAR, LOCAL EVENTS, REMINDERS,
  APPROVAL OUTCOMES, KNOWN FACTS, MEMORY SUMMARIES, HISTORY).
- Already contains an "ACTIVE TOPIC TRACKING" persona block (prompt-only,
  conversation-scoped). Step 22 adds DATA-BACKED sections that this block will
  reference.
- Output contract: `{ reply, spoken, sensitivity, actions[], clarification?,
  clarification_choices?, notes? }`. `reply`/`spoken`/`sensitivity` required.
- Persona invariants: particle `นะ` banned; `ครับ` sparingly; "มั้ย" not "ไหม".

### `line_followup.create` — Step 21 (the closest existing pattern; MIRROR IT)
- Table `line_followup` (`schema.sql`): `topic, keywords (JSON string), chat_filter,
  due_at, baseline_at, status pending|fired|cancelled`.
- Schema `schemas/lineFollowup.ts`: `createLineFollowupPayloadSchema` (topic,
  keywords[1..10], chat_filter?, due_at; `baseline_at` NOT accepted — executor sets it).
- Repo `db/repositories/lineFollowupRepo.ts`: hydrate keywords safely (bad JSON → []).
- Executor case sets `baseline_at = nowIso()` (NOT trusted from model); writes a
  LOCAL row only.
- Registry entry: capability `line.followup`, policies `["approval-required",
  "local-only"]`, risk `low`, exposure `allowed`.
- Scheduler `runLineFollowupChecks(nowUtc, notifier)`: searches exports newer than
  `baseline_at`, fires ONE dedup'd `line.followup` notification, logs COUNTS ONLY.

### Scheduler notifications — `packages/backend/src/services/scheduler.ts`
- `runSchedulerTick(now, notifier, voice?, nag?)`: reminders due, events soon,
  `runLineFollowupChecks`, approval nag. **No Claude, no approval queue, no
  calendar writes.** Each LINE block wrapped in its own try/catch.
- Dedup via DB `UNIQUE(kind, source_id)` + `insertNotificationIfNew`.
- `isSchedulerEnabled()` — DB `scheduler_enabled` overrides env `SCHEDULER_ENABLED`.
- Activity logs carry counts/ids/timestamps only (Step 21 enforces this).

### Notification table/schema — `schema.sql` + `schemas/notification.ts`
- `notification(id, kind, source_id INTEGER NOT NULL, title, body, fire_at,
  status, created_at, updated_at)` with `UNIQUE(kind, source_id)`.
- `notificationKindSchema = ["reminder.due", "event.soon", "line.followup"]`.
- **CRITICAL CONSTRAINT (affects §5/§10):** `source_id` is an INTEGER and the
  unique key is `(kind, source_id)`, so a given source fires AT MOST ONCE EVER.
  Active topics must be able to fire AGAIN when NEW evidence appears. The plain
  `(kind, source_id)` dedup is therefore insufficient on its own — see §5 and §10
  for the required `dedup_key` column.

### Provider / Gemini routing — `packages/backend/src/services/aiProvider.ts`
- `selectProvider({ mode, requestedProvider, message })`. Manual: default =
  `DEFAULT_PROVIDER_ID = "claude"`; explicit Gemini fails closed when not
  configured. Auto: Gemini ONLY for low-risk summarize/rewrite patterns, else Claude.
- `classifyTaskComplexity` — `LOW_RISK_PATTERNS` gate.
- `geminiProvider.isAvailable = isGeminiConfigured`. `GEMINI_MODEL` default
  `gemini-3.1-flash-lite` (`config.ts`).
- Route `routes/chat.ts` uses `selectProvider`, honors per-turn `geminiModel`,
  surfaces visible Auto fallback. Idle follow-up uses Gemini-first.

### Privacy redaction — `chat.ts` (hard gate) + `services/identityVerifier.ts`
- `identityVerifier`: in-memory verified set + DB-persisted `verified_sessions`.
  `verify(sessionId, input)` compares lowercased-trimmed input vs `OWNER_PIN` and
  `OWNER_SECRET_PHRASE` (default `"โอเค"`, `config.ts`). Secrets never logged.
- Inline unlock in `routes/chat.ts` `handleChat` (PIN, phrase, "จาวิส "+phrase).

### TTS / spoken — output `spoken` field, capped 4000, persona-matched.
  (No change required for Step 22 except keeping new sections consistent.)

---

## 3. Non-goals (Step 22 must NOT do)

- **No live LINE.** No reading the encrypted `.edb`, no LINE UI automation from
  the backend.
- **No LINE write.** No send/reply/update/delete action types. LINE stays read-only.
- **No vector DB / embeddings / external retrieval service.** Deterministic
  substring + scoring only.
- **No model call in the scheduler.** Triage is pure date/string math.
- **No contacts expansion** and no new external connectors.
- **No broad orchestrator / multi-agent rewrite.** One repo, existing pipeline.
- **No dashboard management UI** for active topics unless separately approved.
  (Topics are created via approval and visible on the existing Approvals board;
  notifications appear in the existing Notification Center.)
- **No real external API calls in tests** (no live `claude`/Gemini/Google/LINE).
- **No auto-execute of `active_topic.create`'s side effects beyond writing a local
  row.** Creating the topic is the only action; it is local-only, non-destructive.
- **No auto-resolve of topics** by the scheduler.

---

## 4. High-level Architecture

Seven layers; (7) is explicitly out of scope for Step 22.

1. **Active Topic Store** — durable `active_topic` table + repo. System of record
   for "things the user is tracking".
2. **Topic Resolver** (`activeTopicIntelligence.ts`, pure) — maps a message to
   zero/one/ambiguous active topic deterministically.
3. **LINE Evidence Builder** (`lineEvidence.ts`) — builds a capped, snippet-safe
   evidence bundle for a topic from EXPORTED LINE only.
4. **Evidence Verifier** (`evidenceVerifier.ts`, pure) — turns an evidence bundle
   into allowed/blocked claims + guidance BEFORE prompt generation.
5. **Chat Context Integration** (`chat.ts` + `chatPrompt.ts`) — a conservative
   router decides when to build evidence; new prompt sections render it; verifier
   guidance constrains claims. Unverified → everything redacted.
6. **Deterministic Scheduler Triage** (`scheduler.ts`, optional subphase) — on
   tick, builds evidence for due active topics, fires dedup'd notifications when
   new evidence + cooldown + verifier confidence allow. No model call.
7. **Future model escalation path** — OUT OF SCOPE. (A later step might let a
   model summarize evidence; Step 22 does not.)

```
User question  /  scheduler tick
        │
        ▼
   topic resolver        (deterministic; 0 | 1 | ambiguous)
        │
        ▼
  evidence builder       (EXPORTED LINE only; capped; snippet-safe)
        │
        ▼
     verifier            (allowed/blocked claims + confidence + guidance)
        │
        ├───────────────► chat prompt section  (Jarvis answers from evidence)
        │
        └───────────────► notification         (scheduler triage; cooldown/dedup)
                                │
                                ▼
                  approval gate if an ACTION is proposed
                  (active_topic.create — local-only, approval-gated)
```

---

## 5. Data Model Contract

### Table `active_topic` (9th... count current: task, memory_index, approval,
activity_log, event, reminder, notification, config, chat_message, memory_fact,
line_followup → `active_topic` is the next table). Add to `schema.sql`.

```sql
CREATE TABLE IF NOT EXISTS active_topic (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT NOT NULL,
  source           TEXT NOT NULL,              -- 'line' | 'calendar' | 'mixed' | 'general'
  keywords         TEXT NOT NULL,              -- JSON string array, hydrated to string[] in code
  chat_filter      TEXT,                       -- optional LINE chat-name substring filter; null = all
  status           TEXT NOT NULL DEFAULT 'active', -- 'active' | 'paused' | 'resolved'
  priority         INTEGER NOT NULL DEFAULT 50,
  baseline_at      TEXT NOT NULL,              -- ISO 8601 UTC; only evidence newer than this counts
  last_checked_at  TEXT,                       -- ISO 8601 UTC; last scheduler/evidence pass
  last_evidence_at TEXT,                       -- ISO 8601 UTC; atUtc of newest evidence surfaced
  last_summary     TEXT,                       -- capped, user-safe one-liner; NO raw bodies
  cooldown_minutes INTEGER NOT NULL DEFAULT 30,
  created_from     TEXT NOT NULL,              -- 'chat' | 'manual' | 'scheduler'
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_active_topic_status_source ON active_topic (status, source);
CREATE INDEX IF NOT EXISTS idx_active_topic_baseline ON active_topic (baseline_at);
CREATE INDEX IF NOT EXISTS idx_active_topic_updated ON active_topic (updated_at);
```

Add a schema comment block (mirror the `line_followup` comment) stating:
read-only LINE safety — an active topic only ever *reads* exported LINE files via
the existing keyword search; it never sends/replies/mutates LINE and never
triggers live LINE automation. `updated_at` app-maintained. Rows soft-archived
via `status='resolved'`/`'paused'`, never hard-deleted.

Allowed values (enforced by Zod, §5 schemas):
- `source`: `"line" | "calendar" | "mixed" | "general"`
- `status`: `"active" | "paused" | "resolved"`
- `created_from`: `"chat" | "manual" | "scheduler"`

Field semantics:
- `keywords` — JSON string array in DB; hydrated to `string[]` in code; bad JSON
  hydrates to `[]` (never throws), mirroring `lineFollowupRepo.hydrate`.
- `baseline_at` — UTC ISO; set by backend at execution time, NOT trusted from the
  model (mirror `line_followup`).
- `last_summary` — capped (≤ 200 chars) and user-safe. NO raw message body beyond
  this capped summary is ever stored.
- `priority` — 0..100, default 50. Higher = more important (affects ordering only).
- `cooldown_minutes` — minimum minutes between two triage notifications for the
  same topic.

### Notification kind + dedup column (REQUIRED for §10 scheduler triage)

Add a new notification kind: **`"line.active_topic"`**.

Add it to `notificationKindSchema` in `schemas/notification.ts`.

**Dedup problem + required fix.** The existing `UNIQUE(kind, source_id)` fires a
source at most once forever. An active topic must re-fire when NEW evidence
appears. Therefore add a nullable text dedup column to `notification`:

```sql
ALTER-equivalent (edit CREATE TABLE notification in schema.sql to add):
  dedup_key TEXT
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_dedup ON notification (dedup_key)
  WHERE dedup_key IS NOT NULL;
```

(Implement by editing the `CREATE TABLE notification` statement + adding the
partial unique index in `schema.sql`. `schema.sql` uses `CREATE TABLE IF NOT
EXISTS`; for a fresh temp DB in smoke tests this is sufficient. Existing reminder/
event/line.followup rows keep `dedup_key = NULL` and rely on `(kind, source_id)`
as today — do NOT change their behavior.)

For active-topic triage the dedup key is a STRING:
`active_topic:<id>:<lastEvidenceAtUtc>` — so the SAME topic re-fires only when its
newest evidence instant changes. `source_id` for these rows = the topic id
(integer), `dedup_key` carries the evidence instant.

`schemas/notification.ts`: add `dedup_key: z.string().nullable()` to
`notificationSchema` (nullable; existing rows have null).

`db/repositories/notificationRepo.ts`: add a new function (do NOT break the
existing `insertNotificationIfNew`):

```
insertNotificationWithDedupKey(
  kind, sourceId, title, body, fireAt, dedupKey
): boolean   // true if a new row was inserted (INSERT OR IGNORE on dedup_key)
```

If editing the existing `notification` `CREATE TABLE` is judged risky against a
pre-existing real DB, STOP and report — do not silently migrate a real DB. (Tests
use a fresh temp DB so they are unaffected.)

---

## 6. File-by-file Implementation Plan

### `packages/backend/src/db/schema.sql`
- Add the `active_topic` table + 3 indexes exactly as in §5.
- Add the read-only-LINE-safety comment block above the table.
- Edit the `notification` `CREATE TABLE` to add `dedup_key TEXT` and add the
  partial unique index `idx_notification_dedup` (§5).

### `packages/backend/src/schemas/activeTopic.ts` (NEW)
- Enums: `activeTopicSourceSchema = z.enum(["line","calendar","mixed","general"])`,
  `activeTopicStatusSchema = z.enum(["active","paused","resolved"])`,
  `activeTopicCreatedFromSchema = z.enum(["chat","manual","scheduler"])`.
- `activeTopicSchema` (persisted row, keywords hydrated to `string[]`): all 14
  columns typed; `chat_filter/last_checked_at/last_evidence_at/last_summary`
  nullable.
- `ActiveTopic` type = `z.infer<...>`.
- Caps:
  - `title`: `z.string().trim().min(1).max(200)`
  - `keywords`: `z.array(z.string().trim().min(1).max(100)).min(1).max(10)`
  - `chat_filter`: `z.string().trim().min(1).max(200).optional()`
  - `last_summary` (when stored): ≤ 200 chars
  - `priority`: `z.number().int().min(0).max(100)` (default 50)
  - `cooldown_minutes`: `z.number().int().min(1).max(1440)` (default 30)
- `createActiveTopicPayloadSchema` (approval payload — `baseline_at`,
  `created_from`, status, timestamps NOT accepted; backend sets them):
  ```
  { title, source, keywords, chat_filter?, priority?, cooldown_minutes? }
  ```
- `CreateActiveTopicPayload` type.
- Internal repo input type may be separate (`CreateActiveTopicInput`) carrying
  `baseline_at` + `created_from`.

### `packages/backend/src/db/repositories/activeTopicRepo.ts` (NEW)
Mirror `lineFollowupRepo.ts` conventions (COLS const, `LineFollowupRow`-style row
interface, `hydrate`, `nowIso()` for timestamps, `updated_at` app-maintained).
Required functions:
- `createActiveTopic(input: CreateActiveTopicInput): ActiveTopic` — inserts with
  `status='active'`, `JSON.stringify(keywords)`, app timestamps.
- `getActiveTopicById(id): ActiveTopic | undefined`.
- `listActiveTopics(options?: { status?; source?; limit? }): ActiveTopic[]` —
  default order `priority DESC, updated_at DESC`; default excludes nothing unless
  `status` given; cap with `limit` if provided.
- `listDueActiveTopicsForLineCheck(nowUtc): ActiveTopic[]` — `status='active'` AND
  `source IN ('line','mixed')` AND (`last_checked_at IS NULL` OR
  `last_checked_at <= now − cooldown_minutes`). Order `priority DESC`.
- `findRelevantActiveTopics(message, limit): ActiveTopic[]` — cheap candidate
  prefilter for the resolver: active topics whose title or any keyword appears as
  a case-insensitive substring of `message` (or vice-versa for short titles).
  Returns capped list; scoring/decision happens in `activeTopicIntelligence`.
- `updateActiveTopicCheck(id, patch: { last_checked_at?; last_evidence_at?;
  last_summary?; baseline_at? }): ActiveTopic | undefined` — partial update +
  `updated_at`.
- `pauseActiveTopic(id)` → `status='paused'`.
- `resolveActiveTopic(id)` → `status='resolved'`.
- `hydrate` MUST NOT throw on bad keyword JSON → `keywords = []` (copy
  `lineFollowupRepo.hydrate`).

### `packages/backend/src/services/activeTopicIntelligence.ts` (NEW — PURE)
No DB, no IO, no model. Deterministic functions:

- `extractTopicKeywords(message): string[]` — like `extractLineKeywords` but tuned
  for topic matching (lowercase, drop stopwords, dedupe, cap ~6). MAY import and
  reuse `extractLineKeywords` from `chat.ts` if exported, OR duplicate the small
  stopword logic here to keep this module pure (preferred: export
  `extractLineKeywords` and reuse).
- `isShortFollowupQuestion(message): boolean` — true when the message is short
  (≤ ~6 tokens after trim) AND matches a follow-up pattern (below) OR is purely
  elliptical ("เรื่องนั้นล่ะ", "อันนั้น", "แล้วล่ะ").
- `scoreActiveTopic(message, topic, history?): number` — deterministic score:
  - title substring match (message⊇title or title⊇message token) → strong (+3)
  - keyword overlap: +1 per overlapping keyword (cap +3)
  - `chat_filter` name mentioned in message → +2
  - recency tiebreak: more-recently-updated topic gets a tiny epsilon (does NOT
    by itself create a "strong" match)
  - returns a numeric score; caller compares to a STRONG threshold (define
    `STRONG_SCORE = 3`).
- `resolveActiveTopicForMessage(message, topics, history): ActiveTopicResolution`
  where:
  ```ts
  type ActiveTopicResolution =
    | { kind: "none" }
    | { kind: "resolved"; topic: ActiveTopic; reason: string }
    | { kind: "ambiguous"; candidates: ActiveTopic[]; reason: string };
  ```
  Rules (deterministic, NO guessing):
  - Score all `topics`. Let strong = topics with score ≥ `STRONG_SCORE`.
  - If exactly ONE strong → `resolved`.
  - If ≥ 2 strong → `ambiguous` (return up to top 3 by score then priority).
  - If ZERO strong AND `isShortFollowupQuestion(message)`:
    - if exactly ONE active topic exists overall → `resolved` (the elliptical
      "เรื่องนั้น" attaches to the single live topic),
    - if ≥ 2 active topics → `ambiguous`,
    - else `none`.
  - Otherwise `none`. **Ambiguity returns `ambiguous`, never a guess.**

Pattern lists (case-insensitive; substring match):
- **Thai follow-up:** `"ถึงไหนแล้ว"`, `"มีใครตอบยัง"`, `"ตอบยัง"`, `"เรื่องนั้น"`,
  `"อันนั้น"`, `"แล้วล่ะ"`, `"ล่าสุดล่ะ"`, `"อัปเดตไหม"`, `"อัพเดทไหม"`,
  `"ต่อจากเมื่อกี้"`, `"เป็นไงบ้าง"`, `"ยังไงต่อ"`.
- **English follow-up:** `"any update"`, `"did anyone answer"`, `"what about that"`,
  `"follow up on that"`, `"what's the status"`, `"any reply"`.

### `packages/backend/src/services/lineEvidence.ts` (NEW)
Builds evidence ONLY from EXPORTED LINE via the existing `searchLineMessages`
(read-only, fail-soft). No new file IO. No logging of text.

Functions:
- `buildLineEvidenceForTopic(topic, options?): LineEvidence` — orchestrates the
  below; respects caps; filters to messages `atUtc > topic.baseline_at` and (when
  `topic.chat_filter`) chat-name substring; fail-soft → empty evidence with
  `available:false` on disabled/error.
- `findLineMessagesSince({ keywords, chatFilter, sinceUtc, cap }):
  (LineMessage & { chat })[]` — wraps `searchLineMessages(keywords, cap)`, then
  filters by `atUtc > sinceUtc` and chat filter. (Mirror the exact filtering
  `runLineFollowupChecks` already does.)
- `findCandidateQuestions(messages): EvidenceMessage[]` — messages whose text hits
  a question marker (below). Non-system only.
- `findCandidateAnswers(messages, questions): EvidenceMessage[]` — for each
  question, later messages in the SAME chat, non-system, preferably a DIFFERENT
  sender, within a reasonable window (cap N messages after, and/or ≤ 72h after).
  Label as **candidate**, never certainty.
- `inferLineMessageKind(text): "question" | "media" | "statement"` — media when a
  `MEDIA_SUFFIXES`-style marker is present; question when a question marker is
  present; else statement. (Keep local; do not depend on parser internals beyond
  the public `LineMessage`.)
- `summarizeEvidenceStats(evidence): EvidenceStats` — counts only (total, per-kind,
  candidateQuestions, candidateAnswers, chats touched, newestAtUtc). NO text.

Evidence shape (EXACT — see §8 for the canonical interface). Caps (constants in
this file; see §8): snippet ≤ **200 chars**; total evidence lines ≤ **24**; max
chats **6**; max messages scanned per topic **60**; max candidate questions **8**;
max candidate answers **8**.

Candidate **question** markers:
- Thai: `"ไหม"`, `"มั้ย"`, `"หรอ"`, `"หรือ"`, `"กี่"`, `"เมื่อไหร่"`, `"ยังไง"`,
  `"ทำไม"`, and trailing `"?"`.
- English: `"?"`, `"when"`, `"where"`, `"how"`, `"did"`, `"does"`, `"can"`.

Candidate **answer** heuristic: a later message in the same chat, non-system,
preferably a different sender than the question's sender, within the window. It is
ALWAYS labeled a *candidate* — never asserted as "the answer".

SAFETY: this module NEVER logs message text. Only `summarizeEvidenceStats` output
(counts) may be logged by callers.

### `packages/backend/src/services/evidenceVerifier.ts` (NEW — PURE)
No IO, no model. Turns evidence into claim guardrails BEFORE prompt generation
(post-hoc NL verification is brittle, so we constrain UPFRONT).

```ts
export interface EvidenceVerdict {
  confidence: "high" | "medium" | "low";
  guidance: string[];      // short imperative lines injected into the prompt
  allowedClaims: string[]; // e.g. "may say a candidate answer exists"
  blockedClaims: string[]; // claims Jarvis must NOT make
}
export function verifyLineEvidenceAnswerIntent(input: {
  userMessage: string;
  evidence: LineEvidence;
}): EvidenceVerdict;
```

Deterministic rules:
- `evidence.available === false` (LINE disabled/error) → `confidence: "low"`;
  block all specific claims; guidance: "บอกตรงๆ ว่าตอนนี้ดู LINE export ไม่ได้".
- `evidence.messages.length === 0` → `confidence: "medium"`; allow ONLY the
  no-match caveat ("ยังไม่เห็นข้อความใหม่เรื่องนี้ใน export ล่าสุด"); BLOCK
  "ไม่มีใครตอบ" as an absolute (export is not the full inbox).
- `candidateAnswers.length > 0` → `confidence: "medium"` (or `"high"` if a
  candidate answer is from a different sender AND within window); allow
  "มีคนตอบแล้ว (น่าจะ ...)"; BLOCK "ไม่มีใครตอบ".
- ALWAYS block, regardless of evidence:
  - `"ไม่มีใครตอบ"` / `"no one answered"` unless `candidateAnswers.length === 0`
    AND `candidateQuestions.length > 0` — and even then phrase as "ยังไม่เห็น
    คำตอบใน export ล่าสุด", not an absolute.
  - `"ไม่มีอัปเดต"` as an absolute (only "ไม่เห็นอัปเดตใหม่ใน export ล่าสุด").
  - any specific sender/time/chat claim NOT present in `evidence`.
  - any read/unread claim (LINE has none).
  - any live-LINE claim ("เห็นใน LINE ตอนนี้", "real-time").
- ALWAYS include guidance: prefer the framing "จาก export LINE ล่าสุดที่ระบบเห็น"
  and mention the export-staleness caveat when evidence is old or empty.

### `packages/backend/src/services/chat.ts` (EDIT)
Extend `ChatContext` (in `chatPrompt.ts`, see below) and `buildChatContext`:
- Add fields: `activeTopics`, `resolvedActiveTopic`, `activeTopicAmbiguity`,
  `lineEvidence`, `verifierGuidance` (types in `chatPrompt.ts`).
- **Conservative context router** (new helper, deterministic):
  - For VERIFIED users ALWAYS include a compact `activeTopics` list
    (`listActiveTopics({ status:"active", limit })`, mapped to `{ id, title,
    source, priority }`).
  - Run `resolveActiveTopicForMessage(message, activeTopics, history)`.
  - Build LINE evidence ONLY when AT LEAST ONE of:
    1. message mentions LINE/chat/group/ไลน์/กลุ่ม (reuse a small marker list),
    2. resolver returned `resolved` (a topic matched),
    3. `isShortFollowupQuestion(message)` is true, OR
    4. `extractTopicKeywords(message)` overlaps a resolved/active topic's keywords.
  - When building: `buildLineEvidenceForTopic(resolvedTopic)` if resolved; if only
    a follow-up with a single active line/mixed topic, use that topic; otherwise
    skip evidence (set `lineEvidence` to an empty/`available` bundle reflecting
    reality).
  - When evidence built, run `verifyLineEvidenceAnswerIntent` → `verifierGuidance`.
  - **Do NOT build heavy evidence for unrelated general chat** (none of 1–4) — keep
    `lineEvidence` empty to avoid prompt bloat.
  - **Keep existing `lineChats`, `lineMessages`, `lineMatches`** exactly as today
    (compatibility — do not remove them).
  - **Router-unsure fallback:** if the router cannot decide, prefer INCLUDING the
    existing LINE context (today's behavior) over breaking answers. New
    active-topic/evidence fields simply stay empty in that case.
- **Unverified user:** in the existing `if (!verified)` redaction return, set ALL
  new fields to empty/redacted: `activeTopics: []`, `resolvedActiveTopic: null`,
  `activeTopicAmbiguity: null`, `lineEvidence: { available:false, ... empty }`,
  `verifierGuidance: null`. (Defense in depth — the prompt also must not leak.)
- **Do NOT alter the approval dispatch architecture.** `active_topic.create` flows
  through the SAME `dispatchProposedAction(type, payload, "chat")` path.

### `packages/backend/src/services/chatPrompt.ts` (EDIT)
- Extend `ChatContext` interface with the 5 new fields (typed). Optional fields so
  existing callers/tests that build a context literal still compile — default
  unset → render as "(none)".
- Add prompt sections (render compactly; "(none)" when empty), placed in the
  LOCAL CONTEXT area near the LINE sections:
  - **ACTIVE TOPICS** — `- #id [source, prio] "title"` for each active topic.
  - **RESOLVED ACTIVE TOPIC** — the resolver's single match (id + title) or
    "(none)".
  - **ACTIVE TOPIC AMBIGUITY** — the candidate titles when ambiguous, with the
    instruction to ask ONE clarification and propose nothing.
  - **LINE EVIDENCE BUNDLE** — capped snippets from `lineEvidence` with chat,
    sender (best-effort), Bangkok date/time, and a `[question]`/`[answer?]` tag.
    Reuse the LINE caveat language (export-based, no read/unread, not live).
  - **VERIFIER GUIDANCE** — the `guidance` + `blockedClaims` lines, framed as hard
    rules.
- Rules text to add (concise, persona-consistent):
  - Use the RESOLVED ACTIVE TOPIC for short follow-ups; do not drift.
  - If ACTIVE TOPIC AMBIGUITY is non-empty, ask ONE clarification, propose nothing.
  - If LINE EVIDENCE BUNDLE has items, answer from evidence first.
  - NEVER say "ไม่มีใครตอบ" / "ไม่มีอัปเดต" unless VERIFIER GUIDANCE allows it.
  - When answering from evidence, say "จาก export LINE ล่าสุดที่ระบบเห็น" where natural.
  - NEVER claim live LINE or read/unread.
  - If evidence is stale/limited, say so.
  - NEVER invent sender/time/chat not in the bundle.
- KEEP all existing persona rules intact (particle ban, ครับ sparingly, มั้ย, etc.).
- Restricted/unverified render: new sections show "(withheld)" / "(none)" and the
  privacy block continues to govern — never leak topic titles or evidence.

### `packages/backend/src/schemas/aiCommand.ts` (EDIT)
Add a discriminated-union member:
```ts
z.object({
  action_type: z.literal("active_topic.create"),
  payload: actionPayloadSchemas["active_topic.create"],
}),
```

### `packages/backend/src/schemas/approval.ts` (EDIT)
- Add `"active_topic.create"` to `actionTypeSchema` enum.
- Import `createActiveTopicPayloadSchema` from `./activeTopic.js`.
- Add `"active_topic.create": createActiveTopicPayloadSchema` to
  `actionPayloadSchemas`.

### `packages/backend/src/services/actionRegistry.ts` (EDIT)
- Add capability `"active_topic"` to `CapabilityId` and `capabilityRegistry`
  (humanLabel "Active topic", policies `["approval-required","local-only"]`).
- Add domain `"active_topic"` (or reuse a generic domain) to `ActionDomain`.
- Add `actionRegistry["active_topic.create"]`:
  - capability `"active_topic"`, domain `"active_topic"`,
  - humanLabel "Track an active topic",
  - payloadShape describing `{ title, source, keywords[1..10], chat_filter?,
    priority?, cooldown_minutes? }`,
  - riskLevel `"low"`, policies `["approval-required","local-only"]`,
  - promptExposure `"allowed"`.
  - Description must state it creates a LOCAL watch/topic only — it never reads
    live LINE and never sends/replies.
- The registry-vs-enum-vs-payload invariant (`registry-smoke.ts`) must stay green.

### `packages/backend/src/services/executor.ts` (EDIT)
Add a `case "active_topic.create"`:
- Validate via `actionPayloadSchemas` (already done generically at top).
- Set `baseline_at = nowIso()` (NOT trusted from model), `created_from = "chat"`.
- Call `createActiveTopic({ title, source, keywords, chat_filter: ?? null,
  priority: ?? 50, cooldown_minutes: ?? 30, baseline_at, created_from })`.
- Return `{ summary: \`created active topic #${topic.id}\` }`.
- No external side effect.

### `packages/backend/src/schemas/notification.ts` (EDIT)
- Add `"line.active_topic"` to `notificationKindSchema`.
- Add `dedup_key: z.string().nullable()` to `notificationSchema`.

### `packages/backend/src/services/scheduler.ts` (EDIT — OPTIONAL SUBPHASE E)
Add a deterministic active-topic check, **only if implemented safely**. No model
call. Add `runActiveTopicChecks(nowUtc, notifier)` wrapped in its own try/catch in
`runSchedulerTick` (mirror `runLineFollowupChecks` placement + isolation):

- Gate behind a NEW flag `isActiveTopicTriageEnabled()` (DB
  `active_topic_triage_enabled` overrides env
  `CLAUDE_AGENT_ACTIVE_TOPIC_TRIAGE_ENABLED`, default off). If off → return.
- `const lineOn = isLineEnabled();` if `!lineOn` → return (no spam when disabled).
- `const due = listDueActiveTopicsForLineCheck(nowUtc);`
- For each topic:
  - `evidence = buildLineEvidenceForTopic(topic)` filtering `atUtc >
    max(topic.baseline_at, topic.last_checked_at ?? topic.baseline_at)`.
  - `updateActiveTopicCheck(topic.id, { last_checked_at: nowUtc })` ALWAYS.
  - `verdict = verifyLineEvidenceAnswerIntent({ userMessage: "", evidence })`.
  - If evidence has new messages AND cooldown elapsed (handled by
    `listDueActiveTopicsForLineCheck`) AND `verdict.confidence !== "low"`:
    - `newestAt = evidence.newestAtUtc`,
    - `dedupKey = \`active_topic:${topic.id}:${newestAt}\``,
    - title = `LINE: ${topic.title}`, body = a templated, capped, snippet-safe
      line (see §10 wording),
    - `insertNotificationWithDedupKey("line.active_topic", topic.id, title, body,
      nowUtc, dedupKey)` (returns false if already fired for this evidence
      instant → no re-notify),
    - if inserted: `notifier.notify(title, body)`, then
      `updateActiveTopicCheck(topic.id, { last_evidence_at: newestAt,
      last_summary: <capped summary> })`.
  - **No auto-resolve.** Topic stays active.
- Activity log: `logActivity("active_topic.checked", \`id=${id} matches=${n}
  fired=${0|1}\`)` — COUNTS/IDS/TIMESTAMPS ONLY. NEVER keywords/snippets/title-text
  beyond... actually do NOT log the title either (titles can be private) — log id +
  counts only.

If wiring this into the scheduler is too large for one pass, split it into
**subphase E** and ship A–D first; but the EXACT contract above is still binding
for whoever implements E.

### `packages/backend/scripts/smoke-step22.ts` (NEW)
Mirror `smoke-step21.ts` bootstrap exactly:
- `mkdtempSync` temp dir; set `CLAUDE_AGENT_MEMORY_DIR`, `CLAUDE_AGENT_DB_PATH`,
  `LINE_EXPORT_DIR` to temp paths; neutralize `CLAUDE_AGENT_AI_ENABLED`,
  `GOOGLE_CALENDAR_ENABLED`, `CLAUDE_AGENT_AUTO_EXECUTE_ENABLED`, and set
  `LINE_ENABLED=""` (enable later via `setConfigBool`). **Neutralize env before any
  config import** (see [[smoke-env-hermeticity]]).
- Dynamic-import modules AFTER env is set (mirror step21).
- No real files/API/AI/network. `StubDesktopNotifier`.
- Implements the §13 assertions.

### `package.json` (root) and `packages/backend/package.json`
- Backend: add `"smoke:step22": "tsx scripts/smoke-step22.ts"`.
- Root: add `"smoke:step22": "npm run smoke:step22 -w @claude-agent/backend"`.

---

## 7. Context Router Contract

Deterministic, in `chat.ts` (pure helper preferred):

- **Source detection (lightweight, substring, case-insensitive):**
  - LINE markers: `line`, `ไลน์`, `แชท`, `chat`, `กลุ่ม`, `group`, plus any
    `chat_filter` of an active topic appearing in the message.
  - Calendar markers (already handled by existing Google/event context): NOT
    expanded here. Calendar topics (`source:"calendar"`) are surfaced in ACTIVE
    TOPICS but Step 22 builds evidence only for LINE (`source` line/mixed).
  - Contacts/Gmail/Drive: **not part of this step's router** — leave existing
    behavior untouched.
- **Build LINE evidence** iff any of: LINE marker present, resolver `resolved`,
  `isShortFollowupQuestion`, or topic-keyword overlap (§6 chat.ts rules 1–4).
- **Fallback when unsure:** include the EXISTING LINE context
  (`lineChats`/`lineMessages`/`lineMatches`) — never remove it — and leave the new
  evidence fields empty. The router only ADDS evidence; it never subtracts the
  proven Step 20 context.
- **Avoid prompt bloat:** evidence is built only when warranted, capped per §8,
  and the ACTIVE TOPICS list is a compact `id/title/source/priority` line each.
- **Avoid false "disabled" claims:** mirror the contacts-state pattern. Distinguish
  `available:false` (LINE disabled/error) from "available but zero evidence". The
  prompt section text must say "ดู LINE export ไม่ได้ตอนนี้" for the former and
  "ไม่พบข้อความใหม่เรื่องนี้ใน export ล่าสุด" for the latter — never conflate.

---

## 8. Evidence Bundle Contract

Exact interface (in `lineEvidence.ts`; types may be re-exported for `chatPrompt.ts`):

```ts
export interface EvidenceMessage {
  chat: string;
  sender: string | null;       // best-effort from space-delimited export
  text: string;                // already capped to SNIPPET_MAX_CHARS
  date: string;                // Asia/Bangkok YYYY-MM-DD
  time: string;                // Asia/Bangkok HH:mm
  atUtc: string;               // ISO 8601 UTC (approximate, minute granularity)
  kind: "question" | "media" | "statement";
  isCandidateAnswer?: boolean; // true when selected as a candidate answer
}

export interface EvidenceStats {
  total: number;
  questions: number;
  candidateAnswers: number;
  chats: number;
  newestAtUtc: string | null;
}

export interface LineEvidence {
  available: boolean;          // false = LINE disabled / error (NOT "no matches")
  topicId: number | null;
  messages: EvidenceMessage[]; // capped, newest-first
  candidateQuestions: EvidenceMessage[];
  candidateAnswers: EvidenceMessage[];
  stats: EvidenceStats;
  newestAtUtc: string | null;
  staleCaveat: boolean;        // true when newest evidence is old, or list capped
}
```

Caps (constants in `lineEvidence.ts`):
- `SNIPPET_MAX_CHARS = 200`
- `EVIDENCE_MAX_LINES = 24` (total `messages` rendered)
- `EVIDENCE_MAX_CHATS = 6`
- `EVIDENCE_SCAN_CAP = 60` (max messages pulled from `searchLineMessages` before filtering)
- `MAX_CANDIDATE_QUESTIONS = 8`
- `MAX_CANDIDATE_ANSWERS = 8`

`available` is `false` ONLY when LINE is disabled or the underlying search throws
(it is fail-soft, so wrap and detect). Zero matches with LINE enabled =
`available:true, messages:[]`.

---

## 9. Verifier Contract

Deterministic, pre-prompt (see §6 `evidenceVerifier.ts`). Worked examples:

- **Candidate answer present** → `confidence` medium/high; `allowedClaims` includes
  "may state a candidate reply exists (hedged)"; `blockedClaims` includes
  "ไม่มีใครตอบ". Jarvis must NOT say no one answered.
- **Evidence empty (LINE enabled)** → `confidence` medium; allow the no-match
  caveat ("ยังไม่เห็นข้อความใหม่เรื่องนี้ใน export ล่าสุด"); block absolute
  "ไม่มีใครตอบ"/"ไม่มีอัปเดต".
- **Stale export** (`staleCaveat` true) → guidance: "เตือนผู้ใช้ว่าเห็นแค่ถึง
  export ล่าสุด"; Jarvis must mention the export limitation.
- **Sender/time claims** → allowed ONLY when the exact value appears in
  `evidence.messages`; otherwise blocked.
- **LINE disabled (`available:false`)** → `confidence` low; block all specific
  claims; guidance: say it can't read LINE export right now.

---

## 10. Proactive Scheduler/Triage Contract (subphase E)

If implemented:
- **Deterministic only. No Gemini/Claude. No live LINE. No LINE export trigger**
  (the scheduler never *creates* exports; it only reads what exists).
- Uses existing exported files via `searchLineMessages` / `buildLineEvidenceForTopic`.
- **Cooldown** via `listDueActiveTopicsForLineCheck` (`last_checked_at` +
  `cooldown_minutes`). **Dedup** via `dedup_key = active_topic:<id>:<newestAtUtc>`
  → same evidence instant never re-notifies.
- Gated by `CLAUDE_AGENT_ACTIVE_TOPIC_TRIAGE_ENABLED` (default off) with DB
  override `active_topic_triage_enabled`.
- Notification wording (templated, capped, Thai), examples:
  - `"จากเรื่องที่คุณให้ผมตามไว้ ตอนนี้ใน LINE export ล่าสุดมีข้อความใหม่เกี่ยวกับ \"<title>\""`
  - When nothing new: **do not notify at all** ("ยังไม่แจ้งถ้าไม่มีหลักฐานใหม่").
- Body MAY include up to a couple of capped snippets (≤ 200 chars each), same as
  `line.followup`. Snippets live ONLY in the user-facing notification body, never
  in activity logs.
- **No generic spam:** one notification per new evidence instant per topic; silent
  when no new evidence; respects cooldown.
- Activity log: id + counts + fired flag + timestamps ONLY. No title text, no
  keywords, no snippets.

---

## 11. Gemini Default Policy Contract

Step 22 SHOULD align provider policy so Gemini 3.1 Flash Lite is the default
worker, matching the dashboard default. This is a SMALL, optional policy change —
keep it isolated and test-gated.

Target behavior:
- Gemini 3.1 Flash Lite is the default worker WHEN AVAILABLE.
- An explicit provider choice is still honored (manual Gemini fails closed when
  unconfigured — keep `selectProvider`'s current fail-closed behavior).
- If explicit Gemini is unavailable → fail closed (unchanged).
- If NO provider specified and Gemini available → Gemini.
- If NO provider specified and Gemini unavailable → fall back to Claude with a
  transparent `reason` (e.g. `"default: gemini unavailable → claude"`).
- Auto mode should PREFER Gemini by default (not only low-risk tasks), still
  recording a transparent reason; Claude remains the always-available safe default
  so Auto never throws.
- Escalation to Claude/larger models for "complex" tasks is FUTURE / out of scope
  unless separately approved.

Exact files/tests affected:
- `services/aiProvider.ts`:
  - Change `DEFAULT_PROVIDER_ID` resolution so the manual no-request path prefers
    Gemini when `isGeminiConfigured()`, else Claude (transparent reason). Do NOT
    change explicit-request fail-closed semantics.
  - In Auto mode, prefer Gemini when available regardless of complexity (still
    record reason); keep Claude fallback.
- `scripts/smoke-phase4.ts` — update Auto-mode assertions to expect Gemini-first
  when configured, Claude fallback when not.
- `scripts/smoke-step12.ts` — only if it asserts a specific default provider;
  otherwise leave untouched.

**If this policy change risks destabilizing existing provider smokes, ship §11 as a
clearly separated commit (Phase F) and report test results explicitly.**

---

## 12. Secret Phrase Alias Contract

Small identity change so case variants of the existing phrase work.

- Existing default `OWNER_SECRET_PHRASE = "โอเค"` (`config.ts`).
- Accept aliases: `"ok"`, `"OK"`, `"Ok"`.
- **Implementation:** verification already lowercases (`identityVerifier.verify`
  does `input.trim().toLowerCase()` and compares to
  `OWNER_SECRET_PHRASE.trim().toLowerCase()`). The inline unlock in
  `routes/chat.ts` also lowercases. So the cleanest change is to accept a SET of
  acceptable phrases (the configured phrase PLUS `"ok"`), compared in lowercase —
  `"ok"` then covers `"OK"`/`"Ok"` automatically.
- Add an accepted-phrase helper (e.g. `acceptedSecretPhrases(): string[]`) used by
  BOTH:
  - `identityVerifier.verify` (the `phraseOk` block, including the `"จาวิส " +
    phrase` / `"จาวิส" + phrase` prefixes for each accepted phrase), and
  - the inline unlock matcher in `routes/chat.ts` `handleChat`.
- Do NOT change the env default value; aliases are ADDITIVE. (If the operator sets
  a custom `CLAUDE_AGENT_OWNER_SECRET_PHRASE`, the `"ok"` alias should still be
  accepted unless that introduces a security concern — if unsure, STOP and ask;
  default plan: always also accept `"ok"`.)
- MUST work in `/api/chat/verify` and inline unlock in `/api/chat`.
- MUST NOT log secrets (unchanged — only outcome `reason` is logged).
- `scripts/smoke-step15.ts` — add assertions: `"ok"`, `"OK"`, `"Ok"` all verify;
  a wrong phrase still fails. Do NOT print `.env` or secret values.

---

## 13. Test Plan

Focused commands (run only what the changed surface needs):
- `npm run build`
- `npm run smoke:step22`  (new)
- `npm run smoke:step15`  (secret alias — §12)
- `npm run smoke:phase4`  (provider default — §11)
- `npm run smoke:step20`  (LINE search regression)
- `npm run smoke:step21`  (LINE one-shot followup regression)
- `npm run smoke:persona` (prompt invariants — new sections must not break persona)

Skip rules:
- Skip `npm run build:dashboard` UNLESS the dashboard is changed (Step 22 default:
  no dashboard change → skip).
- Skip the broad `npm run smoke` unless a cross-system risk appears (e.g. the
  `notification` table edit) — if the `notification` change lands, run
  `npm run smoke:step11` too.

`smoke-step22.ts` cases (each an `assert`, mirror step21 style):
1. Active-topic repo: `createActiveTopic` → `getActiveTopicById` → `listActiveTopics`
   round-trips; keywords hydrate to `string[]`; bad keyword JSON hydrates to `[]`.
2. `active_topic.create` proposal stays PENDING until approval (auto-execute off).
3. Approving/executing `active_topic.create` writes a row with backend-set
   `baseline_at` and `created_from="chat"`.
4. Unverified chat context redacts active topics + evidence (all new fields empty).
5. `extractTopicKeywords` Thai + English drops stopwords, caps.
6. Short follow-up with exactly one active topic → `resolved`.
7. Ambiguous follow-up (≥2 strong / ≥2 active) → `ambiguous`, no guess.
8. Evidence includes ONLY messages with `atUtc > baseline_at`.
9. Stale messages (≤ baseline) excluded.
10. Candidate question detected (Thai marker + `?`).
11. Candidate answer detected (later, same chat, different sender, in window).
12. Verifier BLOCKS unsupported "ไม่มีใครตอบ" when a candidate answer exists.
13. Verifier PERMITS the no-match caveat when evidence empty (LINE enabled).
14. Scheduler active-topic notification fires once for a new evidence instant
    (triage flag ON; LINE enabled via `setConfigBool`).
15. Scheduler cooldown / dedup prevents a repeat notification for the same
    `dedup_key`.
16. Scheduler with LINE disabled → fail-soft, no throw, no notification.
17. Activity logs contain NO snippets/keywords/message text/title text (scan the
    `activity_log` rows written during the run; assert none contain the secret
    sample text or keyword).
18. Step 20 keyword search (`searchLineMessages`) still returns the sample match.
19. Step 21 one-shot followup still fires (sanity that the shared scheduler path is
    intact) — OR rely on `smoke:step21` separately and note it.
20. `buildChatPrompt` renders the new sections without leaking when empty/redacted
    (no "undefined", no raw object, restricted render shows withheld/none).

---

## 14. Implementation Order for Sonnet

Each phase: edit listed files, run listed tests, STOP if a test fails (fix before
proceeding; do not push past a red test).

**Phase A — schema/table/repo/schemas**
- Files: `db/schema.sql` (active_topic + notification dedup), `schemas/activeTopic.ts`,
  `db/repositories/activeTopicRepo.ts`, `schemas/notification.ts` (kind + dedup),
  `db/repositories/notificationRepo.ts` (`insertNotificationWithDedupKey`).
- Tests: `npm run build`.
- Stop condition: build red, or repo round-trip can't be exercised.

**Phase B — pure intelligence services**
- Files: `services/activeTopicIntelligence.ts`, `services/lineEvidence.ts`,
  `services/evidenceVerifier.ts`.
- Tests: `npm run build`; begin `smoke-step22.ts` cases 5–13 (pure-fn cases).
- Stop: any pure-fn assertion fails.

**Phase C — chat context + prompt integration**
- Files: `services/chat.ts` (router + new context fields + unverified redaction),
  `services/chatPrompt.ts` (interface + sections + rules).
- Tests: `npm run build`, `npm run smoke:step12`, `npm run smoke:persona`,
  smoke-step22 case 4 + 20.
- Stop: persona smoke red, or redaction leaks.

**Phase D — action approval + executor**
- Files: `schemas/aiCommand.ts`, `schemas/approval.ts`, `services/actionRegistry.ts`,
  `services/executor.ts`.
- Tests: `npm run build`, registry smoke (via `npm run smoke` registry portion or
  the dedicated registry smoke if present), smoke-step22 cases 1–3.
- Stop: registry/enum/payload invariant red.

**Phase E — scheduler deterministic triage (OPTIONAL; ship A–D first if large)**
- Files: `services/scheduler.ts` (+ new flag in `config.ts`), wire
  `runActiveTopicChecks`.
- Tests: `npm run build`, `npm run smoke:step11`, smoke-step22 cases 14–17.
- Stop: any double-fire, any model call, any log leak.

**Phase F — provider default + secret alias**
- Files: `services/aiProvider.ts`, `scripts/smoke-phase4.ts`;
  `services/identityVerifier.ts`, `routes/chat.ts`, `scripts/smoke-step15.ts`.
- Tests: `npm run build`, `npm run smoke:phase4`, `npm run smoke:step15`.
- Stop: provider fail-closed semantics changed, or any secret printed.

**Phase G — final focused checks**
- Tests: `npm run build`, `npm run smoke:step22`, `npm run smoke:step20`,
  `npm run smoke:step21`, `npm run smoke:persona` (+ `smoke:step15`/`smoke:phase4`
  if F landed).
- Stop: any red. Report all results, including skips and why.

---

## 15. Risk Register

| Risk | Mitigation |
|---|---|
| False-positive topic match (wrong topic resolved) | Require `STRONG_SCORE`; ambiguity returns `ambiguous` (ask), never a guess; elliptical follow-up resolves only when exactly ONE active topic exists. |
| False-negative answer detection (real reply missed) | Candidate answers are HEDGED, never asserted; verifier still permits the no-match caveat; never claim "ไม่มีใครตอบ" absolutely. |
| Prompt bloat | Router builds evidence only when warranted (§7 rules 1–4); strict caps (§8); compact ACTIVE TOPICS lines. |
| Scheduler spam | Cooldown (`cooldown_minutes`) + `dedup_key` per evidence instant + silent-when-no-evidence + triage flag default off. |
| Stale export data | `staleCaveat` + verifier guidance forces "เห็นแค่ถึง export ล่าสุด"; never claim live. |
| Latency increase per turn | Evidence reuses the cached `searchLineMessages`; built only when warranted; pure verifier/resolver are O(n) over capped lists. |
| Privacy / log leakage | Activity logs carry ids/counts/timestamps only; no titles/keywords/snippets/text; `lineEvidence`/verifier never log; unverified path redacts all new fields. |
| Model overclaiming despite verifier | Verifier constrains UPFRONT via blockedClaims injected as hard prompt rules; persona "no phantom/absolute" rules already exist; smoke case 12 guards. |
| Test fragility | Temp DB + temp export dir; neutralize env before config import ([[smoke-env-hermeticity]]); stub notifier; no real LINE/AI/Google/network. |
| Notification table edit breaks Step 11 | `dedup_key` is nullable; existing kinds keep `(kind, source_id)` behavior; run `smoke:step11` when the table changes. |

---

## 16. Definition of Done

- All focused tests in §13 pass (or are explicitly reported as skipped with reason).
- No live LINE; no real AI/Google/LINE/network in any test.
- No secrets touched/printed; `.env`/`data/`/credentials/tokens/real exports/DB
  untouched.
- No message bodies, keywords, snippets, or topic titles in activity logs.
- Existing Step 20 (keyword search) and Step 21 (one-shot followup) behavior
  preserved (regression smokes green).
- Jarvis resolves short follow-ups to the correct active topic and answers from
  LINE evidence, hedged per the verifier — never "ไม่มีใครตอบ" without support.
- Scheduler can deterministically notify on new evidence with cooldown/dedup IF
  subphase E is implemented (no model call); otherwise A–D shipped and E's contract
  documented.
- Gemini-default (§11) and secret-phrase aliases (§12) implemented in Phase F with
  their smokes green — OR explicitly deferred and reported.
- LINE remains read-only; no LINE write actions; no vector DB; no orchestrator
  rewrite; no dashboard management UI.

---

## 17. Handoff Notes for Sonnet (copy/paste block)

```
You are implementing Step 22 — Active Intelligence Layer — from
docs/roadmaps/step22-active-intelligence-layer.md.

RULES:
- Implement EXACTLY this plan. Do not broaden scope. Do not add connectors,
  vector DB, orchestrators, dashboard management UI, or LINE write actions.
- LINE stays READ-ONLY. The scheduler makes NO model calls. Activity logs carry
  ids/counts/timestamps ONLY — never message text, keywords, snippets, or topic
  titles.
- Do NOT read or modify .env, data/, credentials, tokens, Google auth files, real
  LINE exports, or DB contents. Do NOT install packages.
- Follow the existing patterns: mirror line_followup (schema/repo/executor/
  registry) and the scheduler's isolated try/catch + dedup conventions. Keep the
  approval-gated architecture; active_topic.create flows through
  dispatchProposedAction like every other action. The executor is the only gate.
- Prefer fail-soft over guessing everywhere: ambiguity → ask one clarification and
  propose nothing; evidence absent → say nothing new matched; LINE disabled →
  say you can't read the export, never fabricate.
- Implement in the phase order in §14. Run the listed tests after each phase and
  STOP on any red test — fix before continuing.
- If ANY section is ambiguous, conflicts with the live code, or would require
  migrating a pre-existing real DB (the notification dedup column), STOP and
  report instead of improvising.
- Do NOT commit or push unless explicitly asked.
- When done, report: files changed, tests run (with pass/fail), and anything
  deferred (e.g. subphase E or §11/§12).
```
