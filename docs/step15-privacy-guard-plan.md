# Step 15 — Privacy Guard & Owner Identity Verification (detailed implementation blueprint)

> Status: **PLANNED — not yet implemented.** Read this whole file before coding any task.
> Companion to `CLAUDE.md` (which gets only a short scope paragraph + a pointer here,
> mirroring how Step 13 references `docs/step13-voice-output-plan.md`).

---

## 0. One-paragraph summary

Today Jarvis answers anyone who types in the chat as if they were the owner ("Fan").
A different person ("Fa") could ask "what is Fan's schedule / where is he / who is he
meeting" and Jarvis would happily reveal Fan's private memory, schedule details,
locations, and other people's names. **Step 15 adds an owner-only privacy boundary:**
when the current requester is **not verified** as Fan, Jarvis only sees and shares
**coarse free/busy availability** — never private specifics — and politely offers an
identity check. Verification requires **both a PIN and a knowledge-challenge answer**,
checked deterministically in the backend; the secrets never enter the LLM prompt, the
`chat_message` table, or any log. Verified state is held **in-memory per dashboard
session** (a `sessionId` the browser generates in `sessionStorage`), so it resets when
the tab closes, a new tab opens, or the backend restarts.

**The security boundary is data redaction at context-build time, NOT the LLM.** If the
private data is never placed into the prompt, no amount of prompt-injection or
social-engineering of the model can leak it. The keyword classifier and the model's
`sensitivity` field only drive *UX* (when to show the "verify" panel) — they are not
the gate.

Everything is behind a new flag `CLAUDE_AGENT_PRIVACY_GUARD_ENABLED` (**default off**).
With the flag off, behavior is byte-for-byte identical to today.

---

## 1. Decisions already locked (do not re-litigate)

| Topic | Decision |
|---|---|
| Identity check | **Both** PIN **and** knowledge-challenge answer required (AND, not OR). |
| What counts as "private" | **Backend keyword prefilter + LLM `sensitivity` field**, combined. Either flags → treat as private for the *verify-prompt UX*. |
| Verified lifetime (TTL) | **Per dashboard session.** `sessionId` in `sessionStorage` (clears on tab close / new tab). In-memory map on backend → also resets on backend restart. No DB persistence. |
| Threat model | **Casual** (a friend picks up the unlocked PC), not a determined attacker. Soft model gating is acceptable *because* the hard gate is redaction. Do not oversell. |
| Default | Flag **off**. Off = current behavior exactly. |

---

## 2. The security model (read carefully — this is the part that must be correct)

### 2.1 Two layers

1. **HARD gate — redaction by verification state (the real boundary).**
   In `buildChatContext`, when `guardEnabled && !verified`, private fields are removed
   *before* the prompt string is built:
   - `memorySummaries` → `[]` (memory is the most sensitive; drop entirely)
   - `history` → `[]` (the single global thread can contain private content written
     during a *previous verified* session; an unverified requester must not receive it)
   - `openTasks` → titles replaced with a generic label; keep nothing identifying
   - `events` / `googleEvents` → keep `start`/`bucket`/`allDay` + a **busy** marker;
     replace `title` with a generic "busy" label; never emit location/notes
   - `reminders` → keep `due_at`/`bucket`; replace `title` with a generic label
   - `approvalOutcomes` → `[]` (summaries/errors can contain private detail)

   Result: an unverified prompt can answer "is Fan free this afternoon?" (free/busy) but
   physically **cannot** answer "what is the 2pm meeting / where / with whom" — that text
   is not in the prompt.

2. **SOFT layer — persona + classification (UX only).**
   - A `PRIVACY MODE` block in the prompt tells Jarvis it is talking to an *unverified*
     requester, to share only coarse availability, and to decline private specifics
     politely + offer verification.
   - `classifySensitivity(message)` (keyword) and the model's returned `sensitivity`
     field decide whether the dashboard shows the **verify panel**. They never decide
     what data the model can see — that already happened in layer 1.

### 2.2 Secrets handling (must all hold)

- PIN and challenge answer live in the gitignored `.env` (loaded by `config.ts`'s
  existing `loadEnvFile`). **Never** hard-coded, **never** committed.
- They are compared **only** inside `identityVerifier.verify(...)`.
- They are **never**: put into any prompt, written to `chat_message`, passed to the LLM,
  or included in any `logActivity(...)` call (log the *event*, never the *value*).
- Failure responses are **generic** ("ยืนยันไม่สำเร็จ") — never reveal whether the PIN or
  the answer was the wrong one (no oracle).

### 2.3 Fail-closed semantics

- Flag **off** → guard inactive, `sessionId` ignored, no redaction, no verify path. (today)
- Flag **on** but PIN/answer **not configured** → log a clear **startup warning**; the
  verify endpoint returns `not-configured`; **redaction still applies** (private data
  stays hidden). This is the safe direction: misconfiguration hides data, it does not
  expose it. (Documented tradeoff: the real owner cannot unlock until secrets are set.)
- Any error inside the guard path → treat requester as **unverified** (redact). Never
  fail open.

### 2.4 Cross-session leak via global history (do not miss this)

`chat_message` is **one global thread**, not per-session. If Fan (verified) discussed
private details, those turns are in the thread. An unverified requester's prompt must
**not** include that history → unverified sets `history = []`. (Minor UX cost: no
multi-turn recall while unverified. Accepted.) The on-screen messages the unverified
requester sees are only the ones rendered in *their* browser session anyway; this rule
is specifically about what goes into the *prompt*.

---

## 3. Config & secrets (file: `packages/backend/src/config.ts`)

Add after the Step 14 block. **[SENSITIVE — Opus]** (semantics matter):

```ts
/**
 * Step 15 — Privacy guard & owner identity verification.
 *
 * When ON, an UNVERIFIED chat requester only receives coarse free/busy context
 * (private memory/schedule detail is redacted before the prompt is built) and is
 * offered an identity check. Verification needs BOTH the PIN and the challenge
 * answer. Secrets are read here, compared only in identityVerifier, and NEVER
 * logged or placed in any prompt. OFF by default: behavior identical to today.
 */
export const PRIVACY_GUARD_ENABLED = /^(1|true)$/i.test(
  process.env.CLAUDE_AGENT_PRIVACY_GUARD_ENABLED ?? "",
);

/** Owner PIN (secret). Empty string = not configured -> guard cannot be unlocked. */
export const OWNER_PIN = process.env.CLAUDE_AGENT_OWNER_PIN ?? "";

/** Knowledge-challenge question shown to the requester. NOT secret. */
export const OWNER_CHALLENGE_QUESTION =
  process.env.CLAUDE_AGENT_OWNER_CHALLENGE_QUESTION ??
  "คำถามยืนยันตัวตน (ยังไม่ได้ตั้งค่า)";

/** Expected challenge answer (secret). Compared trimmed + case-insensitive. */
export const OWNER_CHALLENGE_ANSWER =
  process.env.CLAUDE_AGENT_OWNER_CHALLENGE_ANSWER ?? "";

/** Max failed verify attempts per session before a temporary lockout. */
export const PRIVACY_VERIFY_MAX_ATTEMPTS = Number(
  process.env.CLAUDE_AGENT_PRIVACY_VERIFY_MAX_ATTEMPTS ?? 5,
);

/** Lockout duration after too many failed attempts (ms). Default 5 min. */
export const PRIVACY_VERIFY_LOCKOUT_MS = Number(
  process.env.CLAUDE_AGENT_PRIVACY_VERIFY_LOCKOUT_MS ?? 5 * 60_000,
);

/** True only when the guard is on AND both secrets are present. */
export const PRIVACY_GUARD_CONFIGURED =
  PRIVACY_GUARD_ENABLED && OWNER_PIN.length > 0 && OWNER_CHALLENGE_ANSWER.length > 0;
```

Add a one-line startup warning where the server boots (e.g. `index.ts main()`):
if `PRIVACY_GUARD_ENABLED && !PRIVACY_GUARD_CONFIGURED` → `logActivity` or console.warn
`"privacy guard ON but PIN/answer not configured — private data stays hidden, cannot unlock"`.

`.env` sample lines to document (do **not** commit real values):

```
CLAUDE_AGENT_PRIVACY_GUARD_ENABLED=1
CLAUDE_AGENT_OWNER_PIN=__set_me__
CLAUDE_AGENT_OWNER_CHALLENGE_QUESTION=ชื่อเล่นสมัยเด็กของฟานคืออะไร
CLAUDE_AGENT_OWNER_CHALLENGE_ANSWER=__set_me__
```

**Verify `.env` is gitignored** before writing real secrets (it already is — secrets like
`GEMINI_API_KEY` live there). Add nothing secret to the repo.

---

## 4. New service — `packages/backend/src/services/identityVerifier.ts`  **[SENSITIVE — Opus]**

In-memory verified set + rate limiter. No DB. Pure-ish (state is module-level maps,
resettable for tests via an exported `__resetForTest()`).

```ts
import {
  OWNER_PIN,
  OWNER_CHALLENGE_ANSWER,
  OWNER_CHALLENGE_QUESTION,
  PRIVACY_GUARD_ENABLED,
  PRIVACY_GUARD_CONFIGURED,
  PRIVACY_VERIFY_MAX_ATTEMPTS,
  PRIVACY_VERIFY_LOCKOUT_MS,
} from "../config.js";

type VerifyReason = "ok" | "bad-credentials" | "locked" | "not-configured" | "disabled";
export interface VerifyOutcome { ok: boolean; reason: VerifyReason }

const verified = new Map<string, number>();              // sessionId -> verifiedAt(ms)
const attempts = new Map<string, { count: number; lockedUntil: number }>();

/** Guard active = flag on. (Configured-ness checked inside verify.) */
export function isGuardEnabled(): boolean { return PRIVACY_GUARD_ENABLED; }

/** Question to display. Returns null when guard is off. */
export function getChallengeQuestion(): string | null {
  return PRIVACY_GUARD_ENABLED ? OWNER_CHALLENGE_QUESTION : null;
}

/** A session is verified only if guard is on and the session was unlocked. */
export function isVerified(sessionId: string | undefined): boolean {
  if (!PRIVACY_GUARD_ENABLED) return true;   // guard off => everyone "verified" (no redaction)
  if (!sessionId) return false;
  return verified.has(sessionId);
}

/** Constant-ish-time equality (local single-user; avoids trivial early-exit oracle). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verify(sessionId: string, pin: string, answer: string): VerifyOutcome {
  if (!PRIVACY_GUARD_ENABLED) return { ok: false, reason: "disabled" };
  if (!PRIVACY_GUARD_CONFIGURED) return { ok: false, reason: "not-configured" };

  const now = Date.now();
  const rec = attempts.get(sessionId);
  if (rec && rec.lockedUntil > now) return { ok: false, reason: "locked" };

  const pinOk = safeEqual(pin.trim(), OWNER_PIN.trim());
  const ansOk = safeEqual(
    answer.trim().toLowerCase(),
    OWNER_CHALLENGE_ANSWER.trim().toLowerCase(),
  );
  // Evaluate BOTH before branching so timing does not reveal which failed.
  if (pinOk && ansOk) {
    verified.set(sessionId, now);
    attempts.delete(sessionId);
    return { ok: true, reason: "ok" };
  }

  const count = (rec?.count ?? 0) + 1;
  const locked = count >= PRIVACY_VERIFY_MAX_ATTEMPTS;
  attempts.set(sessionId, {
    count: locked ? 0 : count,
    lockedUntil: locked ? now + PRIVACY_VERIFY_LOCKOUT_MS : 0,
  });
  return { ok: false, reason: locked ? "locked" : "bad-credentials" };
}

/** Drop a session's verified state (called on chat reset). */
export function clearVerified(sessionId: string | undefined): void {
  if (sessionId) verified.delete(sessionId);
}

/** Test-only: wipe all in-memory state. */
export function __resetForTest(): void { verified.clear(); attempts.clear(); }
```

Notes:
- `isVerified` returns **true when guard is off** so every downstream redaction check is
  simply `if (!isVerified(sessionId)) redact()`. Keep that single source of truth.
- Never log `pin`/`answer`. The route logs only the *reason*.

---

## 5. New service — `packages/backend/src/services/privacyClassifier.ts`  **[MECHANICAL — Sonnet; heuristic only]**

Keyword/regex prefilter. **UX trigger only — not the security boundary** (so a missed
keyword does not leak: redaction already hid the data). Conservative.

```ts
export interface SensitivityResult { private: boolean; matched: string[] }

// Thai + English cues that the requester is probing PRIVATE specifics.
const PRIVATE_PATTERNS: { re: RegExp; tag: string }[] = [
  { re: /ที่ไหน|สถานที่|ที่อยู่|address|location|where\b/i, tag: "location" },
  { re: /กับใคร|ใครบ้าง|with whom|who.*with|พบใคร|เจอใคร/i, tag: "people" },
  { re: /เบอร์|phone|email|อีเมล|ติดต่อ/i, tag: "contact" },
  { re: /ชอบ|ความชอบ|preference|รสนิยม/i, tag: "preference" },
  { re: /ความลับ|secret|ส่วนตัว|private|ความทรงจำ|จำอะไรเกี่ยวกับ|remember about/i, tag: "personal" },
  { re: /ตารางของ|กำหนดการของ|schedule of|นัดอะไร|มีอะไรบ้างวันนี้.*รายละเอียด/i, tag: "schedule-detail" },
];

export function classifySensitivity(message: string): SensitivityResult {
  const matched = PRIVATE_PATTERNS.filter((p) => p.re.test(message)).map((p) => p.tag);
  return { private: matched.length > 0, matched };
}
```

Document inline: brittle by design; redaction is the real gate; refine patterns over time.

---

## 6. Schema changes — `packages/backend/src/schemas/chat.ts`  **[MECHANICAL — Sonnet]**

```ts
// chatRequestSchema: add sessionId (opaque; optional so guard-off & old clients work)
export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  mode: aiProviderModeSchema.optional(),
  provider: aiProviderIdSchema.optional(),
  sessionId: z.string().trim().min(8).max(128).optional(),   // NEW
});

// chatOutputSchema: add optional sensitivity (UX signal; fail-soft default normal)
//   ...inside the .object({ ... }) before .strict():
  sensitivity: z
    .enum(["private", "normal"])
    .nullish()
    .transform((v) => v ?? "normal"),

// NEW: verify request
export const chatVerifyRequestSchema = z.object({
  sessionId: z.string().trim().min(8).max(128),
  pin: z.string().min(1).max(256),
  answer: z.string().min(1).max(512),
});
```

> Note on `sensitivity` default: defaulting to `"normal"` on omission is fail-**open** but
> only for the *verify-prompt UX*, never for data exposure (redaction already ran). The
> keyword classifier is the backstop for the UX. This is the intended tradeoff.

---

## 7. `buildChatContext` redaction — `packages/backend/src/services/chat.ts`  **[SENSITIVE — Opus]**

`buildChatContext` currently (lines ~142–241) always builds full context. Add a
`verified` parameter and redact when `!verified`. The redaction must happen **here**, at
the data layer, so private strings never reach `buildChatPrompt`.

Signature change:

```ts
export async function buildChatContext(
  message: string,
  fetchGoogle: GoogleEventsFetcher,
  verified: boolean = true,           // NEW; default true keeps existing callers safe
): Promise<ChatContext>
```

At the **end** of the function, before `return`, branch:

```ts
const GENERIC_BUSY = "ไม่ว่าง (รายละเอียดส่วนตัว)";
const GENERIC_TASK = "งานส่วนตัว";
const GENERIC_REMINDER = "เตือนความจำส่วนตัว";

if (!verified) {
  return {
    message,
    nowUtc: nowIso(),
    nowBangkok: bangkokWallClock(now),
    // HARD redaction: drop everything that can reveal who/what/where.
    openTasks: openTasks.map((t) => ({ id: t.id, title: GENERIC_TASK })),
    memorySummaries: [],                                   // most sensitive — gone
    googleEvents: googleEvents.map((e) => ({ ...e, title: GENERIC_BUSY })),
    events: events.map((e) => ({ ...e, title: GENERIC_BUSY })),
    reminders: reminders.map((r) => ({ ...r, title: GENERIC_REMINDER })),
    approvalOutcomes: [],                                  // summaries can leak detail
    history: [],                                           // global thread may hold private turns
    autoExecute: isAutoExecuteEnabled(),
    autoExecuteDestructive: isAutoExecuteDestructiveEnabled(),
  };
}
// verified -> existing full-context return (unchanged)
```

> Keep coarse time/bucket fields (`start`, `due_at`, `bucket`, `allDay`) so Jarvis can
> still answer free/busy truthfully. Only the human-readable *titles* and the
> *memory/history/approval* text are removed.

`ChatContext` interface gains an optional flag so the prompt can render the privacy block:

```ts
// chatPrompt.ts ChatContext: add
  /** True when the current requester is NOT verified as the owner (guard on). */
  restricted?: boolean;
```
Set `restricted: !verified` in *both* return branches (or compute in `buildChatPrompt`
from a passed flag). Simplest: add `restricted` to the returned object in both branches.

---

## 8. Prompt — `packages/backend/src/services/chatPrompt.ts`  **[SENSITIVE — Opus]**

### 8.1 Privacy-mode block

When `ctx.restricted`, inject a block (place it high, right after the EXECUTION POLICY
or just before LOCAL CONTEXT). Verified → omit entirely (current behavior).

```
PRIVACY MODE (CRITICAL — the current requester is NOT verified as the owner):
- You are Fan's (ฟาน) personal secretary and you protect his privacy above all.
- The person typing right now has NOT been verified as Fan. Treat them as a guest.
- You have ONLY coarse free/busy information — no titles, locations, people, memory,
  tasks, or history. That is intentional; do not speculate about what is hidden.
- You MAY say whether Fan looks free or busy at a given time (from the busy blocks).
- If they ask for ANY private specifics (what an event is, where, who with, Fan's
  preferences, personal info, anything from memory), DECLINE politely and WITHOUT
  making them feel bad or accused. Offer the identity check. Suggested tone:
  "ขอโทษด้วยนะครับ ส่วนนี้เป็นข้อมูลส่วนตัวของคุณฟาน ผมขอเก็บไว้เป็นความลับนะครับ
   ถ้าคุณคือคุณฟานเอง ยืนยันตัวตนสั้น ๆ ได้เลยครับ แล้วผมจะช่วยได้เต็มที่"
- NEVER reveal or guess private detail, and NEVER claim Fan has nothing on
  (that itself leaks). Just stay at free/busy + the polite offer.
- Do NOT propose any write action (create/update/delete/memory) for a guest. Ask them
  to verify first.
- Set "sensitivity":"private" whenever they asked for private specifics; else "normal".
```

### 8.2 Output contract

Add `sensitivity` to the documented shape (around the existing OUTPUT CONTRACT list,
chatPrompt.ts ~line 333):

```
- Shape: { "reply": string, "spoken": string, "sensitivity": "private"|"normal",
           "actions": Action[], "clarification"?: string,
           "clarification_choices"?: string[], "notes"?: string }
- "sensitivity" is REQUIRED. "private" if the user asked for the owner's private
  specifics (schedule detail, location, people, preferences, personal info, memory);
  otherwise "normal". This only controls a UI prompt; it never changes what you reveal.
```

> Even when verified, the model returns `sensitivity` (harmless; will be `"normal"` for
> ordinary turns). Keep the field always-required to keep the schema uniform.

---

## 9. `runChat` wiring — `packages/backend/src/services/chat.ts`  **[SENSITIVE — Opus]**

Thread `verified` through and compute the UX signal. Extend the result type.

```ts
export async function runChat(
  message: string,
  invoke: ClaudeInvoker,
  fetchGoogle: GoogleEventsFetcher = realGoogleEventsFetcher,
  opts: { verified?: boolean; sessionId?: string } = {},
): Promise<ChatResult>
```

- `const verified = opts.verified ?? true;` (default true → guard-off path unaffected).
- `const ctx = await buildChatContext(message, fetchGoogle, verified);`
- Keyword classify: `const kw = classifySensitivity(message);`
- After successful validation, compute:
  ```ts
  const modelPrivate = check.data.sensitivity === "private";
  const verificationRequired =
    isGuardEnabled() && !verified && (kw.private || modelPrivate);
  ```
- Add to the `replied` result: `verificationRequired`, and
  `challengeQuestion: verificationRequired ? getChallengeQuestion() : undefined`.
- **Important — do not auto-execute / queue writes for a guest.** When `!verified`, skip
  dispatching actions: set `dispatched = []`, `approvals = []`. (The prompt already tells
  the model not to propose writes, but enforce it in code too — defense in depth.) Still
  persist the exchange? Decision: when `!verified`, **do persist** the user+assistant
  turns is risky (a guest's turns then sit in the global thread and would be redacted out
  of future prompts anyway, but they would show on Fan's screen). Simplest + safe:
  **persist as normal** (so the on-screen thread is coherent) but with `actions_json =
  null`. The redaction in §7 already prevents these guest turns from re-entering an
  unverified prompt; for a *verified* prompt they are harmless (they contain no private
  data — the guest never received any).

`ChatResult.replied` gains:
```ts
  verificationRequired?: boolean;
  challengeQuestion?: string | null;
  sensitivity?: "private" | "normal";
```

---

## 10. Routes — `packages/backend/src/routes/chat.ts`  **[SENSITIVE — Opus for verify; MECHANICAL for wiring]**

### 10.1 `POST /api/chat` — pass session through

In `handleChat`:
```ts
const { message, provider, mode, sessionId } = body.data;
const verified = isVerified(sessionId);            // guard off => true
const result = await runChat(message, invoke, fetchGoogle, { verified, sessionId });
```
Add to the 201 response body: `verificationRequired`, `challengeQuestion`, `sensitivity`.

### 10.2 `POST /api/chat/verify` — NEW  **[SENSITIVE]**

```ts
app.post("/api/chat/verify", async (req, reply) => {
  if (!isGuardEnabled()) return reply.code(200).send({ kind: "disabled" });
  const body = chatVerifyRequestSchema.safeParse(req.body);
  if (!body.success) {
    return reply.code(400).send({ kind: "error", error: "คำขอไม่ถูกต้อง" });
  }
  const { sessionId, pin, answer } = body.data;
  const out = verify(sessionId, pin, answer);          // NEVER log pin/answer
  if (out.ok) {
    logActivity("chat.identity.verified", "owner verified for a chat session");
    return reply.code(200).send({ kind: "verified" });
  }
  logActivity("chat.identity.denied", `reason=${out.reason}`);  // reason only, no values
  const code = out.reason === "locked" ? 429
    : out.reason === "not-configured" ? 503 : 401;
  return reply.code(code).send({ kind: "denied", reason: out.reason, error: denyMessage(out.reason) });
});
```
`denyMessage`: generic Thai per reason ("ยืนยันไม่สำเร็จครับ", lockout → "ลองใหม่อีกครั้งในภายหลังครับ",
not-configured → "ระบบยังไม่ได้ตั้งค่ารหัสยืนยัน"). **Never** say which field was wrong.

### 10.3 `GET /api/chat/challenge` — NEW (lets the UI show the verify button/question anytime)
```ts
app.get("/api/chat/challenge", async (_req, reply) =>
  reply.code(200).send({ guardEnabled: isGuardEnabled(), question: getChallengeQuestion() }),
);
```

### 10.4 `POST /api/chat/reset` — also clear verified
Add `sessionId` to the reset body (optional) and call `clearVerified(sessionId)` so a
"new session" also drops the owner unlock.

---

## 11. Dashboard changes  **[MECHANICAL — Sonnet]**

Files: `src/app/page.tsx`, `src/lib/api.ts`, `src/lib/types.ts`,
`src/app/api/chat/verify/route.ts` (new proxy), maybe a small `VerifyPanel` component.

### 11.1 sessionId (per tab)
In `page.tsx` (client component), once:
```ts
function getSessionId(): string {
  let id = sessionStorage.getItem("chatSessionId");
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem("chatSessionId", id); }
  return id;
}
```
`sessionStorage` clears on tab close / is unique per tab → matches the "per dashboard
session" decision. Keep it in a `useRef` after first mount (avoid SSR access: read inside
`useEffect`).

### 11.2 api.ts
```ts
export function sendChat(message, choice?, sessionId?): Promise<ChatResult> {
  const base = choice === "auto" ? { message, mode: "auto" }
    : choice ? { message, provider: choice } : { message };
  return request<ChatResult>("/api/chat", {
    method: "POST", body: JSON.stringify({ ...base, sessionId }),
  });
}
export function verifyIdentity(sessionId: string, pin: string, answer: string) {
  return request<VerifyResult>("/api/chat/verify", {
    method: "POST", body: JSON.stringify({ sessionId, pin, answer }),
  });
}
export function getChallenge(): Promise<{ guardEnabled: boolean; question: string | null }> {
  return request("/api/chat/challenge");
}
```

### 11.3 types.ts
Extend `ChatResult` (replied/chat variant) with `verificationRequired?: boolean`,
`challengeQuestion?: string | null`, `sensitivity?: "private" | "normal"`.
Add `VerifyResult = { kind: "verified" } | { kind: "denied"; reason: string; error: string } | { kind: "disabled" }`.

### 11.4 Verify panel UX
- When a chat response has `verificationRequired`, render an inline **VerifyPanel** under
  the reply: show `challengeQuestion`, a PIN input (`type="password"`), an answer input,
  and a "ยืนยันตัวตน" button → `verifyIdentity(sessionId, pin, answer)`.
- On `kind:"verified"` → set local `verified=true`, clear the panel, optionally
  auto-resend the last message so Jarvis now answers fully. Show a subtle "ยืนยันแล้ว" lock-open chip.
- On `kind:"denied"` → show the generic error; on `locked` show the wait message.
- Also expose a manual "ยืนยันตัวตน" affordance (small lock icon) so Fan can pre-verify
  using `getChallenge()` without first hitting a refusal.
- Never store PIN/answer in state longer than the submit; clear inputs after.

### 11.5 New proxy route `src/app/api/chat/verify/route.ts`
Clone `src/app/api/chat/route.ts` but POST to `${BACKEND_ORIGIN}/api/chat/verify` with a
short timeout (verify is instant; ~10s is plenty). sessionId rides in the JSON body, so
the existing `/api/chat` proxy already forwards it — only the *verify* path needs a new
proxy file (challenge can use the generic rewrite, or add a tiny GET proxy if needed).

---

## 12. Smoke test — `packages/backend/scripts/smoke-step15.ts` + `npm run smoke:step15`  **[SENSITIVE assertions — Opus designs; Sonnet can scaffold]**

Pattern: copy an existing `smoke-step14*.ts`. Use a **temp DB** (`CLAUDE_AGENT_DB_PATH`),
set guard env vars **in-process before importing config** (or via child env), inject a
**stub invoker** that (a) records the exact prompt string it received and (b) returns a
canned valid JSON. Real Edge/Google/Claude never called. Use `__resetForTest()` between
cases.

Assertions:

1. **Guard OFF (default):** prompt contains memory summaries + history; response has no
   `verificationRequired`; a `sessionId` in the body is ignored (still full context).
2. **Guard ON + unverified:** captured prompt contains **none** of: a real memory
   summary string, a real event title, any history line; it **does** contain the
   `PRIVACY MODE` block. `verificationRequired===true` for a private-keyword message.
3. **Redaction completeness:** seed a memory summary + an event titled "secret thing";
   assert neither string appears anywhere in the unverified prompt. *(This is the core
   security assertion.)*
4. **Verify needs BOTH:** wrong pin + right answer → denied & still unverified; right pin
   + wrong answer → denied & still unverified; right + right → verified.
5. **After verify:** same `sessionId` chat → full context restored (memory/history back).
6. **Per-session:** a *different* `sessionId` is still unverified after another session
   verified.
7. **No secret leakage:** the PIN and answer strings never appear in the captured prompt
   nor in any captured `logActivity` argument. *(Stub `logActivity` or read activity_log.)*
8. **Rate limit:** `PRIVACY_VERIFY_MAX_ATTEMPTS` failures → next attempt `reason:"locked"`.
9. **Keyword classifier:** `classifySensitivity("ฟานไปไหนกับใคร")` → `private:true`;
   `classifySensitivity("สวัสดีครับ")` → `private:false`.
10. **Misconfigured fail-closed:** guard on, answer unset → `verify()` →
    `reason:"not-configured"`, and an unverified chat still redacts.

Add to root/package scripts: `"smoke:step15": "tsx packages/backend/scripts/smoke-step15.ts"`
(match the existing step scripts' runner).

---

## 13. Build / verify checklist (run all, must pass)

- `npm run build`
- `npm run smoke` (table count unchanged — **no new tables**; verified state is in-memory)
- `npm run smoke:step12` (chat regression — guard off path unchanged)
- `npm run smoke:step14b` (auto-execute regression)
- `npm run smoke:step15` (new)
- `npm run build:dashboard`

No new SQLite table, no new npm dependency. (`crypto.randomUUID` is built-in in the
browser and Node.)

---

## 14. CLAUDE.md update (last step, small)

Add a short **Step 15** scope paragraph to `CLAUDE.md` (not the full blueprint) plus a
pointer: *"Detailed blueprint: `docs/step15-privacy-guard-plan.md`."* Add to the
**Out of scope** list that the privacy guard is **casual-grade** (redaction-based; not an
auth system) and that secrets live only in gitignored `.env`. Mirror the Step 13 pattern.

---

## 15. Implementation order (suggested; each step independently buildable)

1. **config.ts** secrets/flags (§3) + `.env` sample doc. *(Opus — semantics)*
2. **identityVerifier.ts** (§4) + a tiny unit exercise. *(Opus)*
3. **privacyClassifier.ts** (§5). *(Sonnet)*
4. **schemas/chat.ts** (§6). *(Sonnet)*
5. **chat.ts redaction + runChat wiring** (§7, §9). *(Opus — the gate)*
6. **chatPrompt.ts** privacy block + output contract (§8). *(Opus — wording is the persona boundary)*
7. **routes/chat.ts** verify/challenge/session wiring (§10). *(Opus for verify, Sonnet for plumbing)*
8. **dashboard** sessionId + VerifyPanel + api/types + proxy (§11). *(Sonnet)*
9. **smoke-step15.ts** + script (§12). *(Opus designs assertions 2/3/4/7/10; Sonnet scaffolds)*
10. **CLAUDE.md** scope note (§14). *(either)*

## 16. Sensitive vs mechanical — quick map for model routing

| Part | Why | Model |
|---|---|---|
| config secrets + fail-closed semantics | wrong default = leak/lockout | **Opus** |
| identityVerifier (compare, no-oracle, rate limit, no secret logging) | the lock | **Opus** |
| buildChatContext redaction (§7) | **the actual security boundary** | **Opus** |
| chatPrompt privacy block + sensitivity contract | persona boundary + leak phrasing | **Opus** |
| runChat verified wiring + guest write-block | enforces gate in code | **Opus** |
| verify route (generic errors, no secret logging) | oracle/secret risk | **Opus** |
| smoke assertions 2,3,4,7,10 | prove the boundary holds | **Opus** |
| privacyClassifier keyword list | UX only, brittle-by-design | Sonnet |
| schema field additions | mechanical | Sonnet |
| dashboard sessionId/VerifyPanel/api/types/proxy | UI plumbing | Sonnet |
| smoke scaffolding, script wiring, CLAUDE.md note | boilerplate | Sonnet |

---

## 17. Known limitations (state honestly; do not oversell)

- **Casual-grade only.** No real authentication exists; this protects against a friend
  on an unlocked PC, not a determined attacker with file access (who could read `.env`
  or the SQLite file directly).
- Keyword classifier misses phrasings → but redaction still hides data; only the
  *verify-prompt* may not appear. Not a leak.
- Verified state lost on backend restart and per-tab (by design).
- Global single chat thread means unverified turns are not recalled in later prompts
  (history dropped while unverified) — minor UX cost, deliberate.
