# Sprint 6: Conversation Polish

## Goal

ทำให้ Home chat เป็นประสบการณ์หลักที่อ่านง่ายและรู้สึกเหมือน ChatGPT/Claude มากขึ้น โดยไม่ทำ visual automation

## Branch

```bash
git checkout -b feature/jarvis-conversation-polish
```

## Files To Touch

- `packages/dashboard/src/app/page.tsx`
- `packages/dashboard/src/components/ToastProvider.tsx`
- `packages/dashboard/src/lib/types.ts`
- `packages/dashboard/src/lib/actionDisplay.ts`
- อาจแยก component ใหม่ใต้ `packages/dashboard/src/components/`

## Proposed Changes

- Message grouping ตาม sender และเวลา
- Streaming-like reply ในฝั่ง UI โดยไม่ต้องเปลี่ยน backend streaming จริงทันที
- Thinking state ที่บอกว่ากำลังทำอะไร เช่น "กำลังเช็ก reminders", "กำลังเตรียมคำขออนุมัติ"
- Markdown/rendering รองรับ bold, italic, underline, list, code, link แบบปลอดภัย
- Source/context icon เพื่อบอกว่าคำตอบอิง Calendar, Tasks, Reminders, Memory หรือ Chat history
- Empty states ที่ไม่เยอะ แต่ช่วยให้เริ่มใช้งานง่าย
- Session handling ที่ชัดว่า new session เก็บ history เดิมไว้แต่ไม่ส่งต่อใน context

## Risk

- Medium: Home page ตอนนี้มี logic เยอะในไฟล์เดียว ถ้าเพิ่มต่อจะดูแลยาก
- Medium: Markdown rendering ถ้าไม่ระวังอาจเปิดช่อง XSS

## Implementation Note

ควรค่อยๆ แยกจาก `page.tsx`:

- `ChatMessageList`
- `ChatComposer`
- `InlineApproval`
- `ThinkingIndicator`
- `MarkdownMessage`
- `SessionConfirmDialog`

อย่า refactor ทั้งหมดใน commit เดียวถ้าไม่จำเป็น

## Automated Test Plan

- `npm run build:dashboard`
- ถ้าเพิ่ม markdown helper เป็น pure function ให้ทดสอบเฉพาะ sanitize/render risky cases ตามเครื่องมือที่มี
- ไม่ทำ visual automation

## Build Before Commit

```bash
npm run build:dashboard
```

## Manual Visual Test By Fran

- เปิด Home แล้วคุยต่อเนื่องหลายข้อความ
- ตรวจว่าข้อความผู้ใช้อยู่ขวา Jarvis อยู่ซ้าย
- ตรวจ markdown ไทย เช่น `**ปัจจุบัน:**` แสดง bold จริง
- ตรวจ thinking/loading ไม่บังเนื้อหา
- ตรวจ mobile/desktop ด้วยสายตาเอง

