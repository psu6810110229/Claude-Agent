# Sprint 7: Activity Humanization

## Goal

เปลี่ยน Activity page จาก log ภาษาเครื่องให้เป็น timeline ที่อ่านแล้วเข้าใจทันทีว่า Jarvis หรือผู้ใช้ทำอะไร

ตอนนี้ activity ใช้ `event_type` เช่น:

- `chat.message.received`
- `chat.message.replied`
- `chat.message.proposed`
- `approval.approve`
- `approval.execute_failed`

สิ่งนี้มีประโยชน์กับ backend แต่ไม่เหมาะเป็น primary UI สำหรับผู้ใช้

## Branch

```bash
git checkout -b feature/jarvis-activity-humanization
```

## Files To Touch

- `packages/dashboard/src/app/activity/page.tsx`
- `packages/dashboard/src/lib/activityDisplay.ts` ใหม่
- `packages/dashboard/src/lib/types.ts`
- `packages/backend/src/routes/activity.ts` เฉพาะถ้าต้องเพิ่ม filter/metadata
- `packages/backend/src/db/repositories/activityRepo.ts` เฉพาะถ้าต้องเพิ่ม structured detail ในอนาคต

## Proposed Display

แปลงเป็นข้อความสั้น เช่น:

- `chat.message.received` -> "Fran ส่งข้อความ"
- `chat.message.replied` -> "Jarvis ตอบกลับ"
- `chat.message.proposed` -> "Jarvis ขออนุมัติ action"
- `approval.approve` -> "Fran อนุมัติ action"
- `approval.execute_failed` -> "Action ทำไม่สำเร็จ"

ยังควรเก็บ raw event type ไว้ใน expanded/debug view เพื่อช่วยตอน debug

## Grouping

ควร group activity ตาม:

- วันนี้
- เมื่อวาน
- เก่ากว่านั้น

และอาจแสดง source icon:

- Chat
- Approval
- Calendar
- Task
- Reminder
- Memory

## Risk

- Low: ถ้าเป็น display-only
- Medium: ถ้า backend detail ยังเป็น plain string แล้ว UI parse มากเกินไป

## Automated Test Plan

โฟกัส helper ที่เสี่ยง:

- unknown event type ต้อง fallback เป็นข้อความอ่านได้
- known event type ต้อง map ถูก
- timestamp formatting ไม่ทำให้ build fail

ถ้าไม่มี test harness สำหรับ dashboard helper ให้ใช้ `npm run build:dashboard` เป็นหลัก

## Build Before Commit

```bash
npm run build:dashboard
```

ถ้าแก้ backend:

```bash
npm run build
npm run build:dashboard
```

## Manual Visual Test By Fran

- เปิด `/activity`
- ดูว่าอ่าน timeline แล้วเข้าใจโดยไม่ต้องแปล event type เอง
- expand/debug ดู raw detail ได้เมื่อจำเป็น
- รายการ approve/done/deleted/edited/enable/disable ใช้ภาษาและ toast tone สอดคล้องกัน

