# Phase 02: Evidence Scope Store

อ้างอิง: `docs/hotfix/conversation-reference-audit.md`

เอกสารนี้เป็น guide เพื่อคุมวัตถุประสงค์และขอบเขต ไม่ใช่คำสั่งว่าต้อง implement ตามชื่อ type หรือไฟล์ที่เสนอทุกจุด

## วัตถุประสงค์

ทำให้ backend มี structured evidence scope ของคำตอบล่าสุด แทนการจำแค่ข้อความใน chat history เพื่อให้ follow-up สามารถอ้างอิง source เดิมได้อย่าง deterministic

## หลักฐานจาก audit

- `listRecentMessages(...)` ถูก map เหลือแค่ `role` และ `content`
- `source_previews_json` / ids / folder / query ไม่ได้ถูกใช้เป็น state สำหรับ turn ถัดไป
- Drive preview mismatch เกิดเพราะคำตอบกับ preview ใช้ evidence คนละชุด

## Branch และกติกา

Suggested branch: `codex/evidence-router-phase-02-scope-store`

- ทุก phase ต้องทำบน branch แยกของตัวเอง
- เมื่อจบ 1 sprint ให้ทำ focused checks ที่เกี่ยวข้อง แล้ว commit 1 ครั้ง
- เมื่อ phase นี้ครบและ tests/eval ที่ตกลงกันผ่าน ให้ push branch ของ phase นี้เข้า dev flow 1 ครั้ง
- ถ้าจะ merge เข้า `dev` โดยตรง ให้ทำเฉพาะเมื่อ workflow/project owner อนุมัติ

## Sprint 1: Scope schema แบบ metadata-only

เป้าหมาย:

- นิยาม evidence scope กลางที่ใช้ได้กับ Drive, Gmail, LINE, Calendar, Reminder, Contacts
- เก็บเฉพาะ metadata ที่จำเป็น เช่น source, item ids, parent/folder/thread/chat id, query, total count, preview ids, fetched_at, confidence, limitations
- หลีกเลี่ยง message body, LINE snippets, secrets, tokens, หรือข้อมูลส่วนตัวที่ไม่จำเป็น

ผลลัพธ์ที่คาดหวัง:

- Schema ชัดพอให้ resolver ใช้ได้
- Compatible กับ guardrail เรื่อง privacy และ local-first

Commit หลัง sprint:

- ตัวอย่าง message: `phase 02 sprint 1: define evidence scope schema`

## Sprint 2: Capture scope จาก Drive result

เป้าหมาย:

- เมื่อ Drive focused read หรือ folder expansion สำเร็จ ให้สร้าง scope ที่อธิบายผลลัพธ์ชุดเดียวกับคำตอบ/preview
- เก็บ count, file ids, folder/parent ที่เกี่ยวข้อง, preview ids, และ search terms เท่าที่จำเป็น
- ไม่เปลี่ยน behavior การ search มากเกินไปใน sprint นี้

ผลลัพธ์ที่คาดหวัง:

- Turn ถัดไปสามารถรู้ได้ว่า "มีกี่รูป" ควรอิง folder/result set ไหน
- Preview ที่ส่งออกยังมาจาก evidence ชุดเดียวกับ answer

Commit หลัง sprint:

- ตัวอย่าง message: `phase 02 sprint 2: capture drive evidence scopes`

## Sprint 3: Capture scope จาก Gmail และ LINE

เป้าหมาย:

- Gmail: เก็บ thread/message ids, query summary, count, fetched_at โดยไม่เก็บ body เกินจำเป็น
- LINE: เก็บ chat identity, export evidence id/timestamp/count โดยไม่เก็บ message bodies/snippets ใน log หรือ scope ถ้าไม่จำเป็น
- ทำให้ source scope มี shape ใกล้เคียงกัน แต่ไม่ฝืนจนเสีย semantics ของแต่ละ connector

ผลลัพธ์ที่คาดหวัง:

- Follow-up อย่าง "กี่ฉบับ", "อันแรกจากใคร", "ล่าสุดว่าไง" มี scope ให้ bind

Commit หลัง sprint:

- ตัวอย่าง message: `phase 02 sprint 3: capture gmail and line evidence scopes`

## Sprint 4: Feed recent scopes เข้า chat context อย่างประหยัด

เป้าหมาย:

- โหลด recent scopes ที่เกี่ยวข้องกับ conversation turn ล่าสุด
- ส่งเข้า prompt/context แบบ compact และ capped
- ไม่ทำให้ token usage โตแบบควบคุมไม่ได้

ผลลัพธ์ที่คาดหวัง:

- Gemini ได้ evidence pack ที่ชัดขึ้นโดยไม่ต้องเดาจาก text history อย่างเดียว
- ถ้าไม่มี scope หรือ scope stale ต้องระบุ limitation ได้

Commit หลัง sprint:

- ตัวอย่าง message: `phase 02 sprint 4: expose recent evidence scopes to chat`

## Phase Done

ก่อน push:

- Phase 01 eval ยังรันได้
- มี focused tests สำหรับ scope creation / serialization / privacy redaction
- ตรวจว่า scope ไม่เก็บ secrets, tokens, DB dump, LINE bodies, หรือ export content จริง
- บันทึก limitation ของ scope store ไว้ชัด เช่น retention, cap, stale policy

