# Complete Step 15 Privacy Guard — Remaining Work

The previous Claude Code session completed **blueprint items 1–9** (config, identityVerifier, privacyClassifier, schemas, chat.ts redaction + runChat wiring, chatPrompt privacy block) and partially started **item 8** (dashboard). The session hit its limit after adding the lock icon button to the session bar in `page.tsx` but before completing the rest of the dashboard work and all verification.

## What's Already Done (committed + uncommitted diffs)

| Blueprint § | File | Status |
|---|---|---|
| §3 config.ts | `config.ts` | ✅ committed |
| §4 identityVerifier.ts | `identityVerifier.ts` | ✅ committed |
| §5 privacyClassifier.ts | `privacyClassifier.ts` | ✅ committed |
| §6 schemas/chat.ts | `schemas/chat.ts` | ✅ committed |
| §7 buildChatContext redaction | `chat.ts` | ✅ uncommitted diff |
| §8 chatPrompt privacy block | `chatPrompt.ts` | ✅ uncommitted diff |
| §9 runChat wiring | `chat.ts` | ✅ uncommitted diff |
| §10.1 POST /api/chat session pass-through | `routes/chat.ts` | ❌ NOT done |
| §10.2 POST /api/chat/verify route | `routes/chat.ts` | ❌ NOT done |
| §10.3 GET /api/chat/challenge route | `routes/chat.ts` | ❌ NOT done |
| §10.4 POST /api/chat/reset session clear | `routes/chat.ts` | ❌ NOT done |
| §11.1 sessionId (page.tsx) | `page.tsx` | ✅ uncommitted diff |
| §11.2 api.ts client functions | `api.ts` | ✅ uncommitted diff |
| §11.3 types.ts | `types.ts` | ✅ uncommitted diff |
| §11.4 VerifyPanel UI | `page.tsx` | ❌ NOT done — lock button added, panel missing |
| §11.4 CSS for lock button + panel | `globals.css` | ❌ NOT done |
| §11.5 Proxy route for verify | N/A | ❌ NOT needed — catch-all rewrite handles it |
| §12 smoke-step15.ts | N/A | ❌ NOT done |
| §14 CLAUDE.md update | N/A | ❌ NOT done |

## Remaining Work

### 1. Backend routes — `routes/chat.ts` (§10)

The routes file has **no changes** yet. Need to:

#### [MODIFY] [chat.ts](file:///d:/Fran's%20Folder/Project-archive/Claude_Agent/packages/backend/src/routes/chat.ts)

- **§10.1** `handleChat`: extract `sessionId` from parsed body, call `isVerified(sessionId)`, pass `{ verified, sessionId }` to `runChat`. Add `verificationRequired`, `challengeQuestion`, `sensitivity` to the 201 response.
- **§10.2** New `POST /api/chat/verify` route: parse with `chatVerifyRequestSchema`, call `verify()`, return `verified`/`denied`/`disabled`. Generic error messages. Never log pin/answer.
- **§10.3** New `GET /api/chat/challenge` route: return `{ guardEnabled, question }`.
- **§10.4** `POST /api/chat/reset`: parse optional `sessionId` from body, call `clearVerified(sessionId)`.

### 2. Dashboard VerifyPanel + CSS (§11.4)

#### [MODIFY] [page.tsx](file:///d:/Fran's%20Folder/Project-archive/Claude_Agent/packages/dashboard/src/app/page.tsx)

- Add the `VerifyPanel` inline JSX (or small component) below the lock button area in the stage section:
  - Show `challengeQuestion`, PIN input (`type="password"`), answer input, submit button
  - On submit: call `verifyIdentity(sessionId, pin, answer)` → on success set `verified=true`, clear panel, show toast
  - On denial: show generic error; on locked: show wait message
  - Clear inputs after submit (never retain PIN/answer in state)

#### [MODIFY] [globals.css](file:///d:/Fran's%20Folder/Project-archive/Claude_Agent/packages/dashboard/src/app/globals.css)

- Add `.jarvis-lock-btn`, `.jarvis-lock-label`, `.jarvis-verify-panel` styles

### 3. Build verification

- `npm run build` (full workspace)
- `npm run build:dashboard`

### 4. Smoke test (§12) — deferred

> [!IMPORTANT]
> The blueprint specifies a `smoke-step15.ts` test. This is a significant piece of work involving a stub invoker, temp DB setup, and 10 assertion categories. I will **not** create it in this session to keep scope manageable, but will note it as remaining.

### 5. CLAUDE.md update (§14) — deferred

> [!NOTE]
> Small doc update. Will skip unless you want it now.

## Risk Assessment

> [!TIP]
> **Low risk overall.** The security-critical work (redaction in `buildChatContext`, prompt privacy block, runChat wiring, identityVerifier) is **already done** in the uncommitted diffs. What remains is:
> - Backend routes (mechanical plumbing — calls into already-written services)
> - Dashboard UI (VerifyPanel — standard form + API call)
> - CSS (visual only)
>
> None of these touch the security boundary. The hardest part is already done.

## Verification Plan

### Automated Tests
- `npm run build` — full workspace TypeScript compilation
- `npm run build:dashboard` — Next.js production build

### Manual Verification
- Verify the lock icon appears in the session bar when guard is enabled
- Verify the VerifyPanel renders and submits correctly
