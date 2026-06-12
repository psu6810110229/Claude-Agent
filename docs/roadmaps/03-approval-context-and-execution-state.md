# Sprint 3: Approval Execution State & Chat Context

## Future Note: Multi-Provider Agent Trace

Do not implement Gemini, provider switching, or multi-step agents in this sprint. Those are post-09 work.

When adding approval execution state, leave the model easy to extend with future agent metadata:

- optional `agent_run_id` / `agent_step_id` references, or a separate execution detail table later
- explicit execution status that is independent from approval decision status
- result summaries that can be shown to chat/activity without exposing raw payloads
- failure states that can support retry/fallback decisions without pretending success

Future orchestrated work must still pass through this boundary: AI providers may propose actions, but backend validation and the approval queue remain the only path to execution.

## Goal

แก้ปัญหา Jarvis ไม่รู้ว่า action ที่เสนอไปถูก approve และ execute สำเร็จแล้วหรือยัง

ตัวอย่างปัญหาจากพฤติกรรมจริง:

- Jarvis เสนอ 3 approvals
- ผู้ใช้กด approved แล้ว
- ถามต่อว่าเหลืองานเลยกำหนดไหม
- Jarvis ยังตอบเหมือนคิวอนุมัติอาจค้างอยู่ หรือยังเห็นรายการเดิมเป็น overdue

## Current Finding

- `approval.status` มีแค่ `pending`, `approved`, `rejected`
- `routes/approvals.ts` execute action ก่อนแล้วค่อย set approved
- ถ้า executor fail จะ log `approval.execute_failed` และ response 422
- Chat context ใน `services/chat.ts` ยังไม่มี recent approval/action results
- `chat_message.actions_json` เก็บแค่ approval id และ action type ไม่เก็บ execution result

## Branch

```bash
git checkout -b feature/jarvis-approval-state
```

## Files To Touch

- `packages/backend/src/db/schema.sql`
- `packages/backend/src/schemas/approval.ts`
- `packages/backend/src/db/repositories/approvalRepo.ts`
- `packages/backend/src/routes/approvals.ts`
- `packages/backend/src/services/executor.ts`
- `packages/backend/src/services/chat.ts`
- `packages/backend/src/services/chatPrompt.ts`
- `packages/dashboard/src/lib/types.ts`
- `packages/dashboard/src/app/page.tsx`
- `packages/dashboard/src/app/approvals/page.tsx`

## Proposed Data Model

เพิ่ม execution metadata โดยยังรักษา approval status เดิม:

- `status`: `pending | approved | rejected`
- `execution_status`: `not_started | succeeded | failed`
- `executed_at`
- `execution_error`
- `result_summary`

ถ้าอยากลด migration surface อาจสร้าง table ใหม่:

- `approval_execution`
- `approval_id`
- `status`
- `result_summary`
- `error_code`
- `created_at`

## Proposed Behavior

- Approve แล้ว execute สำเร็จ:
  - approval = approved
  - execution_status = succeeded
  - activity = human-readable done event
- Approve แล้ว execute fail:
  - approval ยังไม่ควรถูกบอกว่าทำสำเร็จ
  - execution_status = failed
  - UI แสดงให้ retry หรือ reject
  - Jarvis ต้องบอกตรงๆ ว่าขออนุมัติแล้วแต่ทำไม่สำเร็จ
- Chat context ควร include recent action outcomes แบบ capped เช่น 10 รายการล่าสุด

## Risk

- High: approval เป็น boundary สำคัญของระบบ
- High: ถ้า state ผิด Jarvis จะรายงาน false success
- Medium: migration/backward compatibility

## Automated Test Plan

ใช้ temp DB และ stubbed executor/Claude:

- Approve success sets `approved + succeeded`
- Approve failure does not pretend success
- Failed execution creates readable activity
- Chat context includes recent succeeded/failed action summaries
- Approved done reminder ไม่กลับมาเป็น overdue ใน response ถ้า domain state แก้แล้ว

ควรพิจารณาเพิ่ม root script:

```json
"smoke:step12": "npm run smoke:step12 -w @claude-agent/backend"
```

## Build Before Commit

```bash
npm run build
npm run build:dashboard
```

## Manual Visual Test By Fran

- Inline approval เปลี่ยนสถานะทันทีหลัง approve
- ถ้า action fail เห็นข้อความสั้นๆ ว่าทำไม่สำเร็จ
- Jarvis ไม่บอกว่าทำแล้วถ้ายัง execute ไม่สำเร็จ
