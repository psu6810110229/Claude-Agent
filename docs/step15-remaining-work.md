# Complete Step 15 Privacy Guard — Remaining Work

The previous Claude Code session completed **blueprint items 1–9** (config, identityVerifier, privacyClassifier, schemas, chat.ts redaction + runChat wiring, chatPrompt privacy block) and partially started **item 8** (dashboard). The session hit its limit after adding the lock icon button to the session bar in `page.tsx` but before completing the rest of the dashboard work and all verification.

## What's Already Done (committed + uncommitted diffs)

| Blueprint § | File | Status |
|---|---|---|
| §3 config.ts | `config.ts` | ✅ committed |
| §4 identityVerifier.ts | `identityVerifier.ts` | ✅ committed |
| §5 privacyClassifier.ts | `privacyClassifier.ts` | ✅ committed |
| §6 schemas/chat.ts | `schemas/chat.ts` | ✅ committed |
| §7 buildChatContext redaction | `chat.ts` | ✅ committed |
| §8 chatPrompt privacy block | `chatPrompt.ts` | ✅ committed |
| §9 runChat wiring | `chat.ts` | ✅ committed |
| §10.1 POST /api/chat session pass-through | `routes/chat.ts` | ✅ uncommitted diff |
| §10.2 POST /api/chat/verify route | `routes/chat.ts` | ✅ uncommitted diff |
| §10.3 GET /api/chat/challenge route | `routes/chat.ts` | ✅ uncommitted diff |
| §10.4 POST /api/chat/reset session clear | `routes/chat.ts` | ✅ uncommitted diff |
| §11.1 sessionId (page.tsx) | `page.tsx` | ✅ committed |
| §11.2 api.ts client functions | `api.ts` | ✅ uncommitted diff |
| §11.3 types.ts | `types.ts` | ✅ uncommitted diff |
| §11.4 VerifyPanel UI | `page.tsx` | ✅ committed |
| §11.4 CSS for lock button + panel | `globals.css` | ✅ committed |
| §11.5 Proxy route for verify | `verify/route.ts` | ✅ uncommitted diff |
| §12 smoke-step15.ts | `smoke-step15.ts` | ✅ uncommitted diff |
| §14 CLAUDE.md update | N/A | ❌ NOT done |

## Remaining Work

### 1. Backend routes — `routes/chat.ts` (§10) — ✅ Completed (uncommitted)

All backend endpoints and session verification logic have been implemented and verified.

### 2. Dashboard VerifyPanel + CSS (§11.4) — ✅ Completed

The VerifyPanel UI, lock button, and their associated styles in `globals.css` were already completed and committed in the previous commit.

### 3. Build verification

- `npm run build` (full workspace)
- `npm run build:dashboard`

### 4. Smoke test (§12) — ✅ Completed (uncommitted)

The `smoke-step15.ts` test script has been fully implemented, validating all 10 security assertions across `guard-off`, `guard-on`, and `guard-unconfigured` child runs.

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
