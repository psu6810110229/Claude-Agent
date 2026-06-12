# Sprint 5: Chat Fallbacks & Clarification

## Future Note: Transparent Provider Fallbacks

Do not add Gemini or automatic model switching in this sprint.

The fallback and clarification language should prepare for a future where Auto mode can choose or retry with another provider. The rule is: no silent model switching.

Future messages should be able to say things like:

- "Gemini hit a rate limit. I can retry with Claude if you want."
- "Auto chose Gemini for summarization because this is a low-risk read-only step."
- "Claude handled the recommendation step because the analysis was more complex."

For this sprint, keep the wording provider-neutral, honest about state, and compatible with future provider/step annotations.

## Goal

ทำให้ Jarvis ตอบอย่างซื่อสัตย์และน่าเชื่อใจเมื่อ:

- ทำไม่ได้
- ทำแล้วแต่ยังไม่แน่ใจ
- ต้องให้ผู้ใช้ตรวจอีกที
- ข้อมูลไม่พอและควรถาม clarification

ต้องไม่ strict จน Jarvis ไม่กล้ารายงาน แต่ต้องไม่บอกว่าทำสำเร็จถ้ายังไม่ได้ทำจริง

## Branch

```bash
git checkout -b feature/jarvis-chat-fallbacks
```

## Files To Touch

- `packages/backend/src/services/chat.ts`
- `packages/backend/src/services/chatPrompt.ts`
- `packages/backend/src/schemas/chat.ts`
- `packages/dashboard/src/app/page.tsx`
- `packages/dashboard/src/lib/types.ts`

## Fallback Message Principles

ข้อความควร:

- สั้น
- เป็นภาษาคน
- บอกสถานะจริง
- เสนอ next step ที่ชัด
- ไม่โยน error raw ให้ผู้ใช้

ตัวอย่าง:

- "ผมยังทำรายการนี้ให้ไม่สำเร็จครับ เห็นสาเหตุว่า reminder นี้หาไม่เจอ เดี๋ยวผมช่วยเช็กจากรายการที่ยังเปิดอยู่ได้"
- "ผมสร้างคำขออนุมัติให้แล้วครับ แต่ยังไม่ได้ลง calendar จนกว่าจะกดอนุมัติ"
- "ผมไม่แน่ใจว่าหมายถึง event ไหนครับ เลือกจาก 2 รายการนี้ก่อนดีไหม"

## Clarification UI

ถ้า intent ไม่ชัด UI ควรรองรับ:

- quick choice buttons
- compact options
- cancel/skip
- no raw action payload

Backend ยังไม่ควร execute จนกว่าผู้ใช้ตอบ clarification และผ่าน approval ตาม policy

## Risk

- High: wording ผิดทำให้ผู้ใช้เข้าใจว่าระบบทำ action แล้ว
- Medium: prompt อาจ conservative เกินไปจนไม่กล้าเสนอ action

## Automated Test Plan

- Stub Claude response ที่มี invalid JSON แล้ว verify fallback ไม่ persist เป็น success
- Stub action ที่ข้อมูลไม่พอ แล้ว verify response ขอ clarification
- Verify rejected/failed chat path ไม่สร้าง approval ผิดๆ
- Verify activity log ไม่บันทึก false done

## Build Before Commit

```bash
npm run build
npm run build:dashboard
```

## Manual Visual Test By Fran

- ลองสั่งคำกำกวม เช่น "เลื่อนนัดนี้ให้หน่อย"
- ลองสั่ง action ที่ต้อง approval
- ลอง approve/reject จาก chat
- ดูว่า Jarvis พูดตรงกับ state จริงและไม่ยาวเกินไป
