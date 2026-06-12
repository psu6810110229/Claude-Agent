# Sprint 2: Action Registry & Human Wording

## Goal

รวม metadata ของ action ไว้ที่เดียว เพื่อให้ backend, prompt, approval UI, inline chat และ toast ใช้ภาษาเดียวกัน

ตอนนี้ action wording กระจายหลายจุด:

- Backend schema: `packages/backend/src/schemas/approval.ts`
- Executor: `packages/backend/src/services/executor.ts`
- Prompt: `packages/backend/src/services/chatPrompt.ts`
- Dashboard inline approval helper: `packages/dashboard/src/app/page.tsx`
- Approvals page raw payload: `packages/dashboard/src/app/approvals/page.tsx`

## Branch

```bash
git checkout -b feature/jarvis-action-registry
```

## Files To Touch

- `packages/backend/src/services/actionRegistry.ts` ใหม่
- `packages/backend/src/services/chatPrompt.ts`
- `packages/backend/src/services/executor.ts`
- `packages/backend/src/schemas/approval.ts`
- `packages/dashboard/src/lib/actionDisplay.ts` ใหม่
- `packages/dashboard/src/app/page.tsx`
- `packages/dashboard/src/app/approvals/page.tsx`
- `packages/dashboard/src/components/ToastProvider.tsx` ถ้าต้อง normalize tone

## Proposed Registry Fields

- `action_type`
- `domain`
- `humanLabel`
- `questionTemplate`
- `approvedToast`
- `rejectedToast`
- `doneLabel`
- `riskLevel`
- `requiresApproval`
- `payloadSummary(payload)`
- `allowedInChat`
- `executorKey`

ตัวอย่าง wording:

- `google_event.create`: "สร้าง event นี้ไหม"
- `reminder.done`: "ทำ reminder นี้เป็นเสร็จแล้วไหม"
- `task.archive`: "เก็บ task นี้ออกจากรายการหลักไหม"

## Risk

- Medium: ถ้า wording registry ไม่ sync กับ schema/executor จะเกิด action ที่ UI รู้จักแต่ backend execute ไม่ได้
- Medium: ถ้า abstract เร็วเกินไปจะซับซ้อนโดยไม่จำเป็น

## Automated Test Plan

โฟกัสจุดเสี่ยง:

- Build backend เพื่อจับ type mismatch
- Build dashboard เพื่อจับ action type ที่ UI ไม่รู้จัก
- เพิ่ม smoke หรือ assertion ง่ายๆ ว่า action types ใน registry ครอบคลุม action schema สำคัญ
- ไม่ต้อง test ทุก wording string

## Build Before Commit

```bash
npm run build
npm run build:dashboard
```

## Manual Visual Test By Fran

- Inline approval อ่านเป็นภาษาคน
- Toast ใช้ tone เดียวกัน
- Approvals board ไม่แสดง raw JSON เป็นหลัก

