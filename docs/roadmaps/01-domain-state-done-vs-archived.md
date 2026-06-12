# Sprint 1: Domain State - Done vs Archived

## Goal

ทำให้สถานะของงานและ reminder สื่อความหมายตรงกับชีวิตจริง:

- Done = ทำเสร็จแล้ว
- Archived = เก็บออกจากมุมมองหลัก แต่ไม่ได้แปลว่าทำเสร็จเสมอไป

ตอนนี้ `task` มี `done` แล้ว แต่ `reminder` มีแค่ `active` และ `archived` ทำให้คำสั่งอย่าง "ตั้งรายการนี้เป็นเสร็จสิ้น" ถูก map ไปที่ `reminder.archive` และ Jarvis อาจตอบคลุมเครือว่าเสร็จแล้ว ทั้งที่ใน data จริงคือ archived

## Branch

ใช้ branch แยก:

```bash
git checkout -b feature/jarvis-domain-state
```

## Files To Touch

- `packages/backend/src/db/schema.sql`
- `packages/backend/src/schemas/reminder.ts`
- `packages/backend/src/db/repositories/reminderRepo.ts`
- `packages/backend/src/routes/reminders.ts`
- `packages/backend/src/schemas/approval.ts`
- `packages/backend/src/services/executor.ts`
- `packages/backend/src/services/chatPrompt.ts`
- `packages/dashboard/src/lib/types.ts`
- `packages/dashboard/src/app/tasks/page.tsx`

ถ้าต้อง migrate DB จริง ให้ทำแบบ reversible และไม่แตะ `data/` โดยตรงในงานปกติ

## Proposed Changes

- เพิ่ม `done` เป็น `ReminderStatus`
- เพิ่ม action ใหม่ `reminder.done` หรือขยาย `reminder.update` ให้รองรับ status อย่างชัดเจน
- แยก wording:
  - "ทำเสร็จแล้ว" -> done
  - "เก็บถาวร/ไม่ต้องแสดงแล้ว" -> archived
- ปรับ prompt ให้ไม่ใช้ `archive` แทน `done`
- ปรับ UI Tasks/Reminders ให้แยก Done กับ Archived

## Risk

- High: data semantics เพราะถ้าผิด Jarvis จะตอบว่าทำแล้วทั้งที่ data ไม่ตรง
- Medium: backward compatibility ของ reminder เดิมที่มีแค่ `active/archived`

## Automated Test Plan

โฟกัส Backend/API/DATA เท่านั้น:

- เพิ่มหรือแก้ smoke test ด้วย temp DB
- สร้าง reminder active
- approve action ที่ทำ reminder เป็น done
- verify DB status เป็น `done`
- verify archived reminder ไม่ถูกนับเป็น done
- verify overdue query ไม่รวม done/archived ตาม intended behavior

ไม่ต้องทำ visual automation

## Build Before Commit

```bash
npm run build
npm run build:dashboard
```

## Manual Visual Test By Fran

- หน้า Tasks แยก Done กับ Archived เข้าใจง่าย
- Chat ที่สั่ง "ทำรายการนี้เสร็จแล้ว" ไม่ใช้คำว่าเก็บถาวร
- รายการที่ done แล้วไม่กลับมาถูก Jarvis บอกว่า overdue อีก

