# Sprint 10: Capability Foundation

## Future Note: Post-09 Provider and Agent Foundation

Do not add Gemini, new secrets, new external connectors, or multi-step agent execution in this sprint.

This sprint should still prepare the safety shape for future provider/orchestrator work:

- keep actions separate from capabilities
- keep read-only, propose-only, approval-required, create-only, and disabled policies explicit
- avoid exposing actions to prompts just because they exist in code
- make it easy for future AgentSteps to declare allowed capabilities before execution
- preserve Google Calendar create-only behavior

Future Gemini/Claude provider switching should be built above this capability contract, not beside it.

## Goal

วางโครงให้ Jarvis รองรับ action/capability เพิ่มในอนาคต โดยไม่ทำให้ระบบหลุดจาก approval-gated architecture

นี่ไม่ใช่การเพิ่ม connector ใหม่ แต่เป็นการจัดระเบียบความสามารถที่มีอยู่และอนาคตให้ปลอดภัยขึ้น

## Branch

```bash
git checkout -b feature/jarvis-capability-foundation
```

## Files To Touch

- `packages/backend/src/services/actionRegistry.ts`
- `packages/backend/src/services/chatPrompt.ts`
- `packages/backend/src/services/executor.ts`
- `packages/backend/src/schemas/approval.ts`
- `packages/backend/src/services/chat.ts`
- เอกสารใน `docs/` สำหรับ capability contract

## Proposed Concepts

### Capability

ความสามารถระดับ product เช่น:

- tasks
- reminders
- local events
- google calendar create
- memory write

### Action

คำสั่งที่ execute ได้หลัง approval เช่น:

- `task.create`
- `task.update`
- `task.archive`
- `reminder.done`
- `google_event.create`

### Policy

กฎความปลอดภัย เช่น:

- read-only
- approval-required
- create-only
- local-only
- disabled

## Contract

ทุก action ใหม่ต้องมี:

- schema validation
- executor
- human wording
- risk level
- approval policy
- test case เฉพาะจุดเสี่ยง
- prompt exposure แบบตั้งใจ ไม่ใช่หลุดจาก schema อัตโนมัติ

## What Not To Add Yet

ไม่เพิ่มสิ่งเหล่านี้ใน sprint นี้:

- Notion
- Gmail
- Google Drive
- Voice
- Scheduler
- Filesystem scanning
- Google Calendar update/delete

## Risk

- High: ถ้า capability เปิดกว้างเกินไปอาจ bypass approval policy
- Medium: abstraction หนาเกินไปจะทำให้งานเล็กช้าลง

## Automated Test Plan

- Registry coverage test เฉพาะ action สำคัญ
- Smoke approve/execute action สำคัญ 1-2 ตัว
- Verify disabled capability ไม่โผล่ใน prompt
- Verify create-only Google Calendar policy ยังอยู่

## Build Before Commit

```bash
npm run build
```

ถ้าแตะ dashboard display ด้วย:

```bash
npm run build:dashboard
```

## Manual Visual Test By Fran

ไม่มี visual requirement หลัก ยกเว้นมี UI capability display เพิ่มจริง
