# Step 22: Active Intelligence Layer (Multi-step Asynchronous Execution)

## Objective
Replace the one-shot, heuristic-driven pre-fetch execution model with a true multi-step Agent Tool-Calling Orchestrator. The UI will feature progressive disclosure of in-flight tasks and their results, delivering a true "Masterpiece" asynchronous UX that satisfies complex, compound user requests (e.g., "Find LinkedIn emails, check LINE family group, check followup status, and check my schedule").

## 1. Deep Architectural Audit & Limitations
### 1.1 Backend Limitations (`chat.ts`)
- **Current Flow:** The chat pipeline uses static, pre-generation heuristics (`detectDriveReadIntent`, `detectGmailReadIntent`, etc.) to run queries *before* the AI is even invoked.
- **The Bottleneck:** For a compound query with 4 distinct intents, Regex/Heuristics fall apart. They cannot deduce complex filters or sequence actions.
- **AI Constraints:** The AI receives a massive blob of pre-fetched context and generates a single monolithic response (a proposal-only runtime). It has no agency to say "I found X, now let me look for Y."

### 1.2 Frontend UX Limitations (`page.tsx`)
- **Current Rendering:** The UI expects a monolithic `result` payload. All `sourcePreviews` (Drive, Gmail) are crammed at the very bottom of the chat bubble inside `SourcePreviewPanel`.
- **The UX Flaw:** If we fetch Emails, LINE messages, and Calendar events simultaneously, appending them all to the bottom creates severe Information Overload (Clutter). There is no progressive state to show the user that "Task B is running while Task A is finished."

## 2. Architecture Refactoring Strategy
To build this Masterpiece safely without breaking the current robust local-first architecture, we must decouple the Orchestration from the UI.

1. **The Orchestrator (`backend/src/services/agentLoop.ts`):**
   - Shift from "Pre-fetch" to a "ReAct / Tool-Calling Loop".
   - The AI will have discrete Tools: `gmail.search`, `drive.search`, `line.search`, `calendar.query`, `db.followup_status`.
   - The backend runs these tools either sequentially or in parallel based on the AI's plan.
2. **The Streaming Event Bus (`backend/src/services/aiStreaming.ts`):**
   - Upgrade Server-Sent Events (SSE) to multiplex **Text Deltas** and **Task Events**.
   - Events: `task_queued`, `task_started`, `task_progress`, `task_completed(payload)`, `task_failed(error)`.
3. **The Synthesizer Phase:**
   - After the Orchestrator loop finishes gathering evidence, the AI does one final pass (Synthesis) to generate a concise, non-redundant human-readable response.
4. **Masterpiece UX (`packages/dashboard/src/components/TaskProgressStack.tsx`):**
   - A new UI component embedded in `ChatBubble`.
   - Listens to the `tasks` event stream.
   - **Animation:** Uses `framer-motion` `<motion.div layout>` for silky-smooth transitions.
   - **States:** A skeletal loader (e.g., "🔍 กำลังหาอีเมล LinkedIn") smoothly morphs into a compact Micro-Card containing just the results for that specific task.

## 3. Implementation Plan & Git Sprints

**Core Rule:** Every Phase must have its own Git branch. Every Sprint requires a light test and a commit. Do not proceed to the next Phase until the current one is committed and fully tested.

---

### 🟢 Phase 1: Task Queue & SSE Streaming (Backend Foundation)
**Branch:** `feat/step22-phase1-streaming`
**Goal:** Build the backend infrastructure capable of emitting discrete Task Events over SSE.

- **Sprint 1.1: Data Models & Zod Schemas**
  - Define `TaskState` (`queued`, `running`, `done`, `error`) in `schemas/chat.ts`.
  - Define `TaskEvent` payload schemas for SSE multiplexing.
  - *Test:* Run `npm run test` or Jest for schema validation. *Commit.*
- **Sprint 1.2: SSE Streaming Updates**
  - Refactor Fastify SSE (`aiStreaming.ts`) to support dispatching Task Events alongside text chunks.
  - *Test:* Integration test asserting valid JSON SSE chunks. *Commit.*
- **Sprint 1.3: Mock Route for UI Testing**
  - Create a temporary route `/api/chat/mock-multi-step` that simulates a 5-second compound task flow, emitting mock task events.
  - *Test:* Manual `curl` or local test script to verify stream integrity. *Commit.*
- **Phase 1 Validation:** Merge into branch.

---

### 🟡 Phase 2: Progressive Execution UI (Frontend Masterpiece)
**Branch:** `feat/step22-phase2-ux`
**Goal:** Build the dynamic UI without hooking up the real AI logic yet, ensuring layout transitions are perfect.

- **Sprint 2.1: Client-side State Management**
  - Update `psuClient.ts` to parse `task_*` SSE events.
  - Add `tasks: ChatTask[]` to the React state for each `ChatMessage`.
  - *Test:* Render dummy tasks statically in a sandbox/mock view. *Commit.*
- **Sprint 2.2: `TaskProgressStack` & Micro-Cards**
  - Build `TaskProgressStack.tsx` using `framer-motion`.
  - Refactor `SourcePreviewPanel` into modular variants that can be embedded inside a single Task Card.
  - *Test:* Visual regression / UI check for layout shift issues. *Commit.*
- **Sprint 2.3: Connect to Phase 1 Mock Route**
  - Hook the chat input (via a debug flag) to hit `/api/chat/mock-multi-step`.
  - Polish the animation timing. Ensure Text synthesis appends below the stack gracefully without thrashing.
  - *Test:* Visual E2E test on the Dashboard. *Commit.*
- **Phase 2 Validation:** Merge into branch.

---

### 🔵 Phase 3: The Tool-Calling Loop & Agent (Backend Intelligence)
**Branch:** `feat/step22-phase3-agent-loop`
**Goal:** Replace legacy heuristics with a deterministic LLM Tool-Calling loop.

- **Sprint 3.1: Tool Definitions**
  - Convert existing read-only heuristics (e.g., `gmail`, `calendar`) into formal AI Tools (OpenAI/Gemini JSON schemas).
  - *Test:* Unit tests ensuring Tool executors return strict, UI-compatible payloads. *Commit.*
- **Sprint 3.2: The Orchestrator Loop (`agentLoop.ts`)**
  - Implement the ReAct / loop logic.
  - Hook the execution of Tools to the Phase 1 SSE emitter (`task_started`, `task_completed`).
  - *Test:* Headless test using a mock LLM client to ensure the loop terminates correctly. *Commit.*
- **Sprint 3.3: The Synthesizer Prompt**
  - Build the final pass logic: providing the LLM with all tool results to generate a concise summary.
  - *Test:* Persona prompt tests (`npm run smoke:persona`) to ensure the bot doesn't talk too much when UI cards are present. *Commit.*
- **Phase 3 Validation:** Merge into branch.

---

### 🟣 Phase 4: Full Integration & Edge Cases
**Branch:** `feat/step22-phase4-integration`
**Goal:** Connect everything, handle failures, and integrate approval gates.

- **Sprint 4.1: End-to-End Integration**
  - Wire the main `chat.ts` endpoint to use the new `agentLoop.ts`.
  - *Test:* Run a real compound query in the Dashboard. *Commit.*
- **Sprint 4.2: Edge Cases & Rate Limits**
  - Handle Tool timeouts (e.g., if Google API is slow, mark task as `error` but don't crash the loop).
  - Integrate with the Approval Queue (if a sub-task requires approval, pause or emit an inline approval card).
  - *Test:* E2E Smoke tests forcing network errors. *Commit.*
- **Sprint 4.3: Cleanup & Final Audit**
  - Deprecate old heuristic pre-fetch functions safely.
  - *Test:* Run the full suite (`npm run smoke`). *Commit.*
- **Phase 4 Validation:** Merge to branch, push to `dev`.

## Execution Directive
Do not begin Phase 1 until this document is formally accepted. All work must follow the Sprint and Branching rules strictly.
