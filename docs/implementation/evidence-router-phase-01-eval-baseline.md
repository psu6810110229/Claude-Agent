# Phase 01: Eval Baseline สำหรับ Conversation Reference

อ้างอิง: `docs/hotfix/conversation-reference-audit.md`

เอกสารนี้เป็น implementation guide ไม่ใช่สเปกบังคับตายตัว ถ้าระหว่างทำพบหลักฐานใหม่ที่ขัดกับแผน ให้ปรับตามความจริงของโค้ดและบันทึกเหตุผลไว้ใน PR/commit

## วัตถุประสงค์

สร้าง eval baseline ก่อนแก้ logic หลัก เพื่อให้รู้ชัดว่าอาการ follow-up drift, source preview mismatch, และ model reasoning gap ดีขึ้นจริงหรือไม่

## หลักฐานจาก audit

- Drive follow-up เช่น "มีกี่รูป" ถูกตีเป็น Drive search ใหม่ได้
- ข้อความตอบอิง history เดิม แต่ preview อิง retrieval รอบใหม่
- Artifact เดิมชี้ว่า Qwen จับ implication ได้ดีกว่า Gemini แต่ช้ากว่า
- ยังไม่มี golden set ที่วัด scope accuracy / preview consistency โดยตรง

## Branch และกติกา

Suggested branch: `codex/evidence-router-phase-01-eval-baseline`

- ทุก phase ต้องทำบน branch แยกของตัวเอง
- เมื่อจบ 1 sprint ให้ทำ focused checks ที่เกี่ยวข้อง แล้ว commit 1 ครั้ง
- เมื่อ phase นี้ครบและ tests/eval ที่ตกลงกันผ่าน ให้ push branch ของ phase นี้เข้า dev flow 1 ครั้ง
- ถ้าจะ merge เข้า `dev` โดยตรง ให้ทำเฉพาะเมื่อ workflow/project owner อนุมัติ

## Sprint 1: นิยาม eval contract

เป้าหมาย:

- นิยามรูปแบบ fixture สำหรับ multi-turn chat
- ระบุ expected source, expected scope id/type, expected count, expected preview ids, และ expected clarification behavior
- แยก provider-independent eval ออกจาก live model eval

ผลลัพธ์ที่คาดหวัง:

- มี schema หรือ convention ที่อ่านง่ายและใช้ซ้ำได้
- fixture ไม่ต้องอ่าน secrets, DB จริง, Drive จริง, LINE export จริง

ไม่ควรบาน scope:

- ยังไม่ต้องทำ dashboard UI
- ยังไม่ต้อง tune prompt

Commit หลัง sprint:

- ตัวอย่าง message: `phase 01 sprint 1: add conversation reference eval contract`

## Sprint 2: Golden cases สำหรับ read-only source

เป้าหมาย:

- เพิ่มเคส Drive: folder มี 5 รูป แล้ว follow-up ว่า "มีกี่รูป", "อะไรนะ", "เช็คอีกที"
- เพิ่มเคส Gmail: ค้น mail กลุ่มหนึ่ง แล้วถาม "กี่ฉบับ", "อันแรกจากใคร"
- เพิ่มเคส LINE: โฟกัสแชทหนึ่ง แล้วถาม "ล่าสุดว่าไง", "อะไรนะ"
- เพิ่มเคส mixed source: หลัง Drive แล้วถาม "กี่อัน" ต้องไม่ข้ามไป Gmail/LINE

ผลลัพธ์ที่คาดหวัง:

- baseline ควรจับอาการปัจจุบันได้ ไม่ใช่เขียน test ที่ผ่านง่ายเกินไป
- metric ขั้นต่ำ: scope accuracy, count accuracy, preview/evidence consistency

Commit หลัง sprint:

- ตัวอย่าง message: `phase 01 sprint 2: add read-only follow-up golden cases`

## Sprint 3: Golden cases สำหรับ write-sensitive flows

เป้าหมาย:

- เพิ่ม calendar/reminder ambiguity cases เช่น "เลื่อนอันนั้น", "เตือนอีกทีพรุ่งนี้"
- เพิ่ม class planner case: 4 dates + 2 time ranges ต้องถาม mapping ก่อนเสนอ action

ผลลัพธ์ที่คาดหวัง:

- eval บอกได้ว่าระบบควรถามย้ำเมื่อ reference ไม่พอ
- action-related cases ต้องไม่ bypass approval queue

Commit หลัง sprint:

- ตัวอย่าง message: `phase 01 sprint 3: add write-sensitive reference cases`

## Sprint 4: Provider comparison runner แบบปลอดภัย

เป้าหมาย:

- ทำหรือปรับ runner ให้เทียบ Gemini 3.1 Flash Lite กับ Qwen ได้เมื่อ provider keys ถูกตั้งใน environment อย่างชัดเจน
- Runner ไม่ควรอ่าน `.env` เองถ้าไม่ได้รับอนุญาต
- Output ควรสรุป latency, token usage, scope correctness, clarification correctness

ผลลัพธ์ที่คาดหวัง:

- ถ้าไม่มี keys ให้ skip อย่างชัดเจน ไม่ fail แบบกำกวม
- ได้รายงานที่เทียบ model ได้โดยไม่ผูกกับข้อมูลจริงของผู้ใช้

Commit หลัง sprint:

- ตัวอย่าง message: `phase 01 sprint 4: add safe provider comparison runner`

## Phase Done

ก่อน push:

- focused eval ผ่านตาม baseline expectation
- ไม่มี live provider call โดยไม่ได้ตั้งใจ
- ไม่มีการอ่าน `.env`, `data/`, DB จริง, secrets, หรือ LINE export จริง
- เอกสารผล baseline ระบุให้ชัดว่าอะไรยัง fail อยู่ เพื่อใช้วัด phase ถัดไป

