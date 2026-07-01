# Phase 04: Deterministic Consistency Verifier

อ้างอิง: `docs/hotfix/conversation-reference-audit.md`

เอกสารนี้เสนอ verifier ที่เล็กและตรงจุดก่อน ไม่ควรขยายเป็น orchestration ใหญ่ถ้ายังไม่จำเป็น

## วัตถุประสงค์

ตรวจว่า answer, source preview, evidence scope, และ proposed action สอดคล้องกันก่อนส่งกลับ user เพื่อลดอาการ "ตอบถูกแต่ preview ผิด" หรือ "preview ถูกแต่ข้อความนับผิด"

## หลักฐานจาก audit

- Dashboard แสดง `+26 ภาพ` เพราะ backend ส่ง `totalItems=30`
- UI ไม่ใช่ root cause หลัก มันแสดงตาม payload
- ไม่มี post-answer gate ที่ตรวจว่า count ในคำตอบกับ preview/evidence เป็นชุดเดียวกัน

## Branch และกติกา

Suggested branch: `codex/evidence-router-phase-04-consistency-verifier`

- ทุก phase ต้องทำบน branch แยกของตัวเอง
- เมื่อจบ 1 sprint ให้ทำ focused checks ที่เกี่ยวข้อง แล้ว commit 1 ครั้ง
- เมื่อ phase นี้ครบและ tests/eval ที่ตกลงกันผ่าน ให้ push branch ของ phase นี้เข้า dev flow 1 ครั้ง
- ถ้าจะ merge เข้า `dev` โดยตรง ให้ทำเฉพาะเมื่อ workflow/project owner อนุมัติ

## Sprint 1: Verification contract

เป้าหมาย:

- นิยาม verification result เช่น `pass`, `repairable`, `clarify`, `block`
- ตรวจ metadata ก่อน เช่น source id, scope id, total count, preview item ids, limitations
- ไม่พยายาม parse natural language ทุกอย่างตั้งแต่แรก ถ้าไม่คุ้ม

ผลลัพธ์ที่คาดหวัง:

- มีจุดเดียวที่บอกได้ว่าผลลัพธ์ปลอดภัยพอจะส่ง user หรือควรถามย้ำ

Commit หลัง sprint:

- ตัวอย่าง message: `phase 04 sprint 1: define consistency verifier contract`

## Sprint 2: Count และ preview consistency

เป้าหมาย:

- ตรวจว่า `totalItems`, preview item count, overflow count, และ evidence count ไม่ขัดกัน
- ถ้า answer ระบุจำนวนแบบชัดเจน ควรตรงกับ evidence count หรือมี limitation อธิบายได้
- ถ้า mismatch ให้ repair payload หรือถามย้ำ ไม่ส่ง preview ที่คนละ scope

ผลลัพธ์ที่คาดหวัง:

- เคส "ตอบ 5 แต่แสดง 30" ต้อง fail verifier
- UI ไม่ต้องเดาว่าควรเชื่อข้อความหรือ preview

Commit หลัง sprint:

- ตัวอย่าง message: `phase 04 sprint 2: verify count and preview consistency`

## Sprint 3: Source consistency across Drive/Gmail/LINE

เป้าหมาย:

- ตรวจว่า source preview ที่แนบมากับ assistant message มี scope id/source ตรงกับ evidence ที่ใช้ตอบ
- ป้องกันการรวม preview จากหลาย source โดยไม่ได้ตั้งใจ
- ถ้ามีหลาย source จริง ต้องมี reason ชัด เช่น user asked mixed-source summary

ผลลัพธ์ที่คาดหวัง:

- ลดอาการ preview คนละ folder/thread/chat
- Debug ง่ายขึ้นเมื่อ connector ใดคืนผลผิด

Commit หลัง sprint:

- ตัวอย่าง message: `phase 04 sprint 3: verify source consistency for read-only previews`

## Sprint 4: Action proposal consistency

เป้าหมาย:

- ตรวจ proposed actions ว่าอ้างอิง evidence scope ที่ resolve แล้ว
- Write-sensitive domains เช่น Calendar, Gmail draft/send, Reminder ต้องไม่ผ่านถ้า reference ambiguous
- ยังต้องคง approval queue/action dispatcher เป็น system of record

ผลลัพธ์ที่คาดหวัง:

- ลดการเสนอ action ผิด event/thread/reminder
- ไม่เพิ่ม direct write path ใหม่

Commit หลัง sprint:

- ตัวอย่าง message: `phase 04 sprint 4: verify action proposals against evidence scopes`

## Phase Done

ก่อน push:

- Phase 01 eval ผ่านเพิ่มขึ้น โดยเฉพาะ preview/evidence consistency
- มี tests สำหรับ mismatch cases และ repair/clarify behavior
- ไม่มี dashboard workaround ที่ซ่อน backend inconsistency
- ยืนยันว่า approval-gated architecture ยังอยู่ครบ

