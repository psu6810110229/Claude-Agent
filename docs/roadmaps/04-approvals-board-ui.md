# Sprint 4: Approvals Board UI

## Future Note: Agent-Origin Approvals

Do not add Gemini, provider switching, or agent orchestration UI in this sprint.

Design the board so approval cards can later show a compact origin trace without redesigning the page:

- source: Chat, Brief, Manual, future AgentRun
- optional provider/model label for future AI-generated proposals
- optional step label, such as "Step 4: recommendation"
- clear distinction between proposed action, approved action, running execution, succeeded execution, and failed execution

The board should remain approval-focused. Future model/provider details are context, not the primary UI.

## Goal

เปลี่ยน Approvals page จาก list/panel เป็น backlog board แบบ GitHub-style columns เพื่อ scan ง่าย

## Branch

```bash
git checkout -b feature/jarvis-approvals-board
```

## Files To Touch

- `packages/dashboard/src/app/approvals/page.tsx`
- `packages/dashboard/src/lib/actionDisplay.ts`
- `packages/dashboard/src/lib/types.ts`
- `packages/dashboard/src/lib/api.ts` ถ้าต้องเพิ่ม filter query
- `packages/backend/src/routes/approvals.ts` เฉพาะถ้าต้องเพิ่ม API filter

## Proposed Columns

- Pending: รอตัดสินใจ
- Approved / Running / Done: อนุมัติแล้วและสถานะ execution
- Needs Attention: execute failed หรือ payload ไม่ชัด
- Rejected: ปฏิเสธแล้ว
- Archived: ถ้ามี archive view ในอนาคต

ถ้า backend ยังไม่มี execution_status ให้ sprint นี้ควรรอ Sprint 3 ก่อน หรือทำ UI รองรับ field optional

## Card Content

แต่ละ card ควรมี:

- action title แบบมนุษย์
- payload summary 1-2 บรรทัด
- source เช่น Chat, Brief, Manual
- created time
- status badge
- expand details เพื่อดู raw payload เฉพาะตอนจำเป็น
- primary action: Approve / Reject / Retry ตามสถานะ

## UX Rules

- หลีกเลี่ยง raw JSON เป็น primary UI
- Expand details ต้องไม่ดัน layout กระโดดมาก
- Card ต้อง scan ได้ใน 3-5 วินาที
- Tone ต้องสอดคล้องกับ Home inline approval และ toast

## Risk

- Medium: UI อาจแสดง state ไม่ครบถ้า backend ยังไม่มี execution_status
- Low: ส่วนใหญ่เป็น presentation ถ้า API ไม่เปลี่ยน

## Automated Test Plan

- `npm run build:dashboard`
- ถ้ามี API filter ใหม่ ให้ backend smoke ทดสอบ query เฉพาะ status สำคัญ
- ไม่ทำ visual automation

## Build Before Commit

```bash
npm run build:dashboard
```

ถ้าแก้ backend route ด้วย:

```bash
npm run build
npm run build:dashboard
```

## Manual Visual Test By Fran

- เปิด `/approvals`
- ดูว่าการ์ดแบ่ง column ชัด
- expand card แล้วอ่าน payload ได้
- approve/reject แล้ว card ย้าย column หรือ status เปลี่ยนเข้าใจง่าย
- mobile/desktop ไม่ overlap
