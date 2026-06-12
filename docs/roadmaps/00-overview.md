# J.A.R.V.I.S Action & Approval Roadmap

เอกสารชุดนี้เป็นแผนปรับ J.A.R.V.I.S จากข้อมูลจริงในโปรเจกต์ปัจจุบัน โดยโฟกัส 3 เรื่องหลัก:

- ทำให้ Jarvis รายงานและทำ action ได้ตรงกับสถานะจริง
- ทำให้ approval, activity, chat อ่านง่ายแบบมนุษย์
- วางโครงสร้างรองรับ action/capability เพิ่มในอนาคต โดยยังรักษา approval-gated architecture

## Project Findings

จากไฟล์ backend/dashboard ที่อ่านแล้ว สถานะปัจจุบันคือ:

- Backend เป็น system of record ผ่าน SQLite และ approval queue
- Claude/AI อยู่ในบทบาท proposal-only ผ่าน `packages/backend/src/services/chat.ts`
- Action allowlist กระจายอยู่ใน prompt/schema/executor เช่น `chatPrompt.ts`, `approval.ts`, `executor.ts`
- `approval` มีสถานะแค่ `pending`, `approved`, `rejected`
- ถ้า approve แล้ว execute fail backend จะ log `approval.execute_failed` และยังปล่อย approval เป็น pending
- `task` รองรับ `open`, `done`, `archived`
- `reminder` รองรับแค่ `active`, `archived` จึงยังไม่มีความหมายของ Done แยกจาก Archived
- Chat context ยังไม่ส่งผลลัพธ์ล่าสุดของ approval/action กลับไปให้ Jarvis อ้างอิง
- Activity page ยังแสดง event type แบบระบบ เช่น `chat.message.replied`, `approval.approve`
- Approvals page ยังเป็น list/panel พร้อม raw JSON payload ไม่ใช่ backlog board
- Home chat มี helper และ UI logic หลายอย่างรวมใน `packages/dashboard/src/app/page.tsx`

## Non-Negotiable Rules

ทุก sprint ที่เป็น implementation ต้องทำตามนี้:

- สร้าง branch แยกก่อนเริ่ม sprint เช่น `feature/jarvis-domain-state`
- ทำงานให้จบเป็น sprint เล็กๆ และ commit เมื่อ sprint ผ่าน build/test แล้วเท่านั้น
- Run build ก่อน commit ทุก sprint
- ถ้าแตะ backend ให้ run `npm run build`
- ถ้าแตะ dashboard ให้ run `npm run build:dashboard`
- ถ้าแตะทั้งคู่ ให้ run ทั้งสองคำสั่ง
- Visual test ให้ Fran manual test เองเท่านั้น
- ห้ามใช้ MCP/browser automation สำหรับ visual validation
- Automated test ให้โฟกัส API, Backend, DATA ในจุดเสี่ยง ไม่ต้องทำ exhaustive UI tests
- ถ้าเจอบั๊กระหว่าง sprint ให้แก้ใน sprint นั้น และบันทึกสิ่งที่เรียนรู้ใน `docs/roadmaps/10-lessons-learned.md`

## Architecture Guardrails

- Backend ยังเป็น system of record
- AI/Claude ต้อง propose เท่านั้น
- Backend execute เฉพาะ action ที่ผ่าน approval queue
- ห้ามเพิ่ม direct write route เพื่อข้าม approval
- Google Calendar writes ต้องเป็น create-only และ approval-gated เหมือนเดิม
- ห้ามเพิ่ม Google Calendar update/delete action
- ห้ามเพิ่ม connector ใหม่ถ้าไม่ได้ขอชัดเจน
- ห้ามอ่านหรือ log secrets, token, `.env`, `data/`, Google credentials

## Sprint Order

1. Domain state: แยก Done กับ Archived ให้ชัด โดยเฉพาะ reminders
2. Action registry: รวม action wording, schema metadata, UI label, risk level
3. Approval execution state: ทำให้ approve แล้วรู้ว่าทำสำเร็จ/ล้มเหลว/รอตรวจ
4. Chat context: ส่งสถานะ action ล่าสุดให้ Jarvis ตอบตามความจริง
5. Approvals board UI: เปลี่ยน approvals เป็น backlog board แบบ columns
6. Inline approval UX: approve/reject จาก chat แล้วเปลี่ยนสถานะทันที
7. Activity humanization: แปลง activity log เป็นภาษาคน
8. Chat fallback & clarification: ตอบแบบตรงไปตรงมาเมื่อไม่แน่ใจหรือทำไม่ได้
9. Conversation polish: grouping, streaming-like reply, markdown, source/context icon
10. Capability foundation: วางโครงให้ action เพิ่มได้ในอนาคตอย่างปลอดภัย

## Roadmap Files

- `01-domain-state-done-vs-archived.md`
- `02-action-registry-and-wording.md`
- `03-approval-context-and-execution-state.md`
- `04-approvals-board-ui.md`
- `05-chat-fallbacks-and-clarification.md`
- `06-conversation-polish.md`
- `07-activity-humanization.md`
- `08-capability-foundation.md`
- `09-test-plan.md`
- `10-lessons-learned.md`

## Definition Of Done Per Sprint

- มี branch แยก
- โค้ดหรือเอกสารเปลี่ยนเฉพาะ scope ของ sprint
- Build ผ่านตาม package ที่แตะ
- Automated test เฉพาะจุดเสี่ยงผ่าน หรือระบุชัดว่าทำไมไม่ต้องมี
- Visual checklist ส่งให้ Fran manual test ถ้าเป็น UI
- Commit แล้วด้วย message ที่บอก sprint ชัดเจน
- ถ้ามี bug/lesson ให้บันทึกใน `10-lessons-learned.md`

