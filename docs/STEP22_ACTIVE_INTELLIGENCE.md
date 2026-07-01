# Step 22: Active Intelligence Layer (Multi-step Asynchronous Execution)

Status: PLANNING ONLY. No code written. Awaiting approval.

Goal: Replace the one-shot, heuristic-driven pre-fetch execution model with a multi-step Agent Tool-Calling Orchestrator. The UI will feature progressive disclosure of in-flight tasks and their results, delivering a true "Masterpiece" asynchronous UX that satisfies complex, compound user requests (e.g., "Find LinkedIn emails, check LINE family group, check followup status, and check my schedule") without layout clutter.

---

## 1. Principles

- **Backend remains the deterministic system of record.**
- **AI and workers are proposal/read-only.** The AI orchestrates read tools and proposes actions; it does not write directly.
- **UX stays chat-native:** In-flight tasks show as progressive UI cards inside the chat bubble, rather than hidden in a separate admin page.
- **Fail-soft:** If a sub-task fails (e.g., Google API timeout), the loop continues and reports the failure, rather than crashing the whole turn.
- **Tests are focused and proportional:** No real Google APIs or LINE exports are hit during tests; use stubs and mocks for the Agent loop.

---

## 2. Scope

**In (Step 22):**
- A backend orchestrator loop (`agentLoop.ts`) capable of ReAct / tool-calling.
- New Server-Sent Events (SSE) payloads for `task_started`, `task_progress`, `task_completed`, and `task_failed`.
- Frontend `TaskProgressStack` component using `framer-motion` for fluid state transitions.
- Conversion of existing read heuristics (Gmail, Drive, Calendar, LINE, Follow-up) into formal LLM Tools with JSON schemas.
- A "Synthesizer" final pass where the AI summarizes the gathered data concisely.

**Out (Step 22):**
- Complex multi-agent topologies (e.g., passing tasks between specialized agents); this is a single orchestrator with multiple tools.
- Replacing the primary Action Dispatcher / Approval queue; the orchestrator still proposes actions that go to the queue.
- Webhooks or external triggers.

---

## 2. Deep Architectural Audit & Identified Gaps

Upon inspecting the inner workings of the project, several critical holes must be addressed before proceeding with the architecture:

**2.1 Streaming API Contract (`api.ts` / `psuClient.ts`)**
- *Current:* The SSE parser `handleFrame` inside `api.ts` only acknowledges `thinking` and `done` events.
- *Gap:* It will silently drop `task_*` events. We must expand `ChatStreamCallbacks` and the Fastify `aiStreaming.ts` payloads to handle progressive updates without breaking legacy streams.

**2.2 Approvals & Action Dispatching**
- *Current:* Actions like `google_calendar.create` trigger an Approval queue.
- *Gap:* If the Orchestrator loop proposes a Write action mid-loop, it would halt execution waiting for user confirmation.
- *Rule:* The `agentLoop.ts` must **strictly** execute Read-Only tools. Write actions (Proposals) must be deferred to the final Synthesizer phase to ensure non-blocking execution.

**2.3 Context (Token) Explosion**
- *Current:* `detectGmailReadIntent` injects raw message snippets.
- *Gap:* Fetching from 4 disparate sources sequentially could cause context window overflow or high latency.
- *Rule:* Tool executors must strictly return compressed JSON (e.g. max 3 emails, max 50 chars per LINE message).

**2.4 Speech (TTS) Integration**
- *Current:* Voice synthesis triggers upon receiving `result.spoken`.
- *Gap:* We must guarantee that `task_progress` events do not trigger TTS. TTS must be strictly gated until the final `done` (Synthesis) event.

---

## 3. Architecture

```
User Prompt ──> chat.runChat
                     │
                     ▼
             agentLoop.ts (The Orchestrator)
             ├─ Loop: Prompt LLM with Tools
             ├─ LLM calls tool `gmail.search` ──> SSE `task_started`
             ├─ Execute `gmail.search`        ──> SSE `task_completed(payload)`
             ├─ LLM calls tool `line.search`  ──> SSE `task_started`
             ├─ Execute `line.search`         ──> SSE `task_completed(payload)`
             └─ LLM signals DONE              ──> Proceed to Synthesis
                     │
                     ▼
             Synthesizer Prompt ──────────────> SSE text delta (Final Answer)
```

**Frontend Rendering:**
- The frontend `page.tsx` receives `task_*` events and pushes them to `message.tasks`.
- `TaskProgressStack` renders each task. A running task is a skeleton loader. A completed task smoothly morphs into a modular `SourcePreviewPanel` micro-card.
- The final synthesized text appears at the bottom of the stack.

---

## 4. Components / files

| File | Change |
|------|--------|
| `services/agentLoop.ts` | **NEW.** Houses the ReAct / Tool-calling while-loop, managing conversation context and tool execution. |
| `services/aiStreaming.ts` | Extend `streamChat` / SSE chunk formats to support multiplexing `event: task` alongside `event: text`. |
| `schemas/chat.ts` | **NEW.** Define Zod schemas for `TaskState` (`queued`, `running`, `done`, `error`) and Task SSE payloads. |
| `services/chat.ts` | Deprecate pre-fetch heuristics. Wire `runChat` to delegate to `agentLoop.ts`. |
| `dashboard/src/app/page.tsx` | Parse new SSE task events; update React state `messages[i].tasks`. |
| `dashboard/src/components/TaskProgressStack.tsx` | **NEW.** Renders the progressive disclosure UI using `framer-motion`. |
| `dashboard/src/components/ChatBubble.tsx` | Embed `TaskProgressStack` instead of rendering a monolithic `SourcePreviewPanel` at the end. |

---

## 5. Phase Breakdown & Sprints

### Phase 1: Task Queue & SSE Streaming (Backend Foundation)
**Branch:** `phase/step22-streaming`
**Goal:** Build the backend infrastructure capable of emitting discrete Task Events over SSE.

- **Sprint 1.1: Data Models & Zod Schemas**
  - Define `TaskState` and `TaskEvent` payload schemas for SSE multiplexing.
  - Tests: Schema validation unit tests. `npm run build`.
- **Sprint 1.2: SSE Streaming Updates**
  - Refactor Fastify SSE (`aiStreaming.ts`) to dispatch Task Events.
  - Tests: Integration test asserting valid JSON SSE chunks.
- **Sprint 1.3: Mock Route for UI Testing**
  - Create `/api/chat/mock-multi-step` simulating a 5-second task flow.
  - Tests: Manual curl check.

### Phase 2: Progressive Execution UI (Frontend Masterpiece)
**Branch:** `phase/step22-ux`
**Goal:** Build the dynamic UI without real AI logic, ensuring flawless layout transitions.

**UX/UI Masterpiece Presentation (Strictly "Liquid Glass Atelier"):**
The new UX must strictly adhere to `DESIGN.md` and `.impeccable/design.json`. `JobProgressInline` and `SourcePreviewPanel` currently stack monotonically, breaking the immersive conversational flow. To fix this:
1. **Task-Scoped Cards (Glass Panels):** Introduce `TaskProgressStack` interleaved with chat text. It must be a translucent white film (`rgba(255,255,255,0.05)`) with `backdrop-filter: blur(22px) saturate(140%)`, an inner-light highlight (`inset 0 1px 0 rgba(255,255,255,0.07)`), and NO hard borders.
2. **Progressive Disclosure:** 
   - **Running:** A glassy skeleton loader / spinner ("🔍 กำลังหาอีเมล...").
   - **Done:** Smoothly snaps into a compact card ("📧 หาอีเมลเจอ 3 ฉบับ").
   - **Semantic Colors Only:** Use OK Green (`#5fdf94`) for success icons, Rose (`#ff7088`) for errors, and Amber (`#ffcf66`) for waiting states. Do NOT use Arc Blue/Halo Violet for mere task status (The One Signature Rule).
3. **Embedded Previews:** Refactor `SourcePreviewPanel` to embed *inside* the expanded Task Card. It must use the same tonal base. **The Earned-Blur Rule:** Do not nest blurred layers; the parent card provides the blur.
4. **Fluid Layout (Framer Motion):** Use `<motion.div layout>` for layout shifts. Ensure an instant fallback for `prefers-reduced-motion`. The UI must feel responsive and spring-based (`ease-out-expo`), never bouncy or jittery.

- **Sprint 2.1: Client-side State & Streaming API**
  - Update `api.ts` (`ChatStreamCallbacks`) and `psuClient.ts` to parse `task_*` events. Add `tasks` to `ChatMessage`.
  - Tests: Static mock rendering. `npm run build:dashboard`.
- **Sprint 2.2: `TaskProgressStack` & Micro-Cards**
  - Build `TaskProgressStack` using `framer-motion`.
  - Refactor `SourcePreviewPanel` to embed directly inside expanded task cards.
  - Tests: Visual regression / layout shift check.
- **Sprint 2.3: Connect to Mock Route**
  - Hook chat input (via debug mode) to the mock route. Verify animations.
  - Tests: Browser manual verification.

### Phase 3: The Tool-Calling Loop & Agent (Backend Intelligence)
**Branch:** `phase/step22-agent-loop`
**Goal:** Replace legacy heuristics with a deterministic LLM Tool-Calling loop.

- **Sprint 3.1: Formal Tool Definitions**
  - Convert `gmail`, `calendar`, `line`, `drive` read operations into JSON-schema Tools with strict token caps.
  - Tests: Unit tests for Tool executors. `npm run build`.
- **Sprint 3.2: Orchestrator Loop (`agentLoop.ts`)**
  - Implement the `while` loop handling Tool Calls and emitting SSE `task` events.
  - Tests: Headless test with stubbed LLM client returning fake tool calls.
- **Sprint 3.3: Synthesizer Prompt & Approvals**
  - Build the final pass logic to summarize gathered data and propose any Write actions.
  - Tests: `npm run smoke:persona` / Prompt evaluation tests.

### Phase 4: Full Integration & Edge Cases
**Branch:** `phase/step22-integration`
**Goal:** Connect everything, handle failures, and integrate approval gates.

- **Sprint 4.1: End-to-End Integration**
  - Wire main `chat.ts` to use `agentLoop.ts`.
  - Tests: Real compound query in Dashboard.
- **Sprint 4.2: Edge Cases, TTS, & Rate Limits**
  - Handle Tool timeouts gracefully (`task_failed`).
  - Guarantee TTS is only engaged on the final `done` event.
  - Tests: E2E Smoke tests forcing network errors.
- **Sprint 4.3: Cleanup & Final Audit**
  - Deprecate old heuristic pre-fetch functions.
  - Tests: `npm run smoke` full suite. `npm run build`.

---

## 6. Definition of Done

For each sprint:
- Relevant focused tests pass.
- `npm run build` passes for backend changes.
- `npm run build:dashboard` passes for dashboard changes.
- Code matches strict schema definitions.
- No raw LINE bodies or secrets in SSE stream logs.

For the whole program:
- A compound prompt successfully fetches multiple distinct data sources asynchronously.
- The UI renders them smoothly one by one without jarring layout shifts.
- The Synthesizer AI does not redundantly read back everything shown in the cards.
- Legacy functionalities (approvals, fact recall) remain functional under the new orchestrator.

---

## 7. Merge / Commit Discipline

- **Branch:** Implement on a dedicated FEATURE branch per phase (e.g., `phase/step22-streaming`). Cut from `dev`. Never commit directly to `dev` or `main`.
- **Commit gate (green-only):** Commit ONLY when tests and build pass (`npm run build` / `npm run build:dashboard`). No commit on a red tree.
- **Commit granularity:** One commit per Sprint.
- **Commit message:** Conventional Commits (e.g., `feat(chat): add SSE task payload schemas`).
- **Integrate:** When the phase branch is green, merge into `dev` (review/integration).
- **Push:** Push only when explicitly asked.
- **Out of git:** Never stage `.env`, `data/`, DB, tokens, real LINE exports.

---

## 8. Next step

On approval: I will create the `phase/step22-streaming` branch and begin Sprint 1.1.
