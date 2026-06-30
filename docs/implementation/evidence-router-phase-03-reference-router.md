# Phase 03: Conversation Reference Resolver และ Source Router

อ้างอิง: `docs/hotfix/conversation-reference-audit.md`

เอกสารนี้ตั้งใจบอกเป้าหมายและ guardrails มากกว่าบังคับ algorithm ถ้า rule ง่ายพอให้ใช้ rule ถ้า ambiguous จริงค่อยใช้ model-assisted path แบบมี budget

## วัตถุประสงค์

ทำให้ระบบตัดสินได้ว่า user turn ปัจจุบันควร reuse scope เดิม, search ใหม่, ถามย้ำ, หรือปฏิเสธเพราะไม่รองรับ แทนการให้ lexical source intent ยิง retrieval ใหม่ทันที

## หลักฐานจาก audit

- คำว่า "รูป/ภาพ/file/mail/line" เป็น trigger กว้างเกินสำหรับ follow-up
- Follow-up phrase มีได้หลายแบบ เช่น "มีกี่รูป", "อะไรนะ", "เช็คอีกที", "กี่อัน"
- การเพิ่ม keyword list อย่างเดียวไม่พอ เพราะภาษา user สั้นและหลากหลายมาก

## Branch และกติกา

Suggested branch: `codex/evidence-router-phase-03-reference-router`

- ทุก phase ต้องทำบน branch แยกของตัวเอง
- เมื่อจบ 1 sprint ให้ทำ focused checks ที่เกี่ยวข้อง แล้ว commit 1 ครั้ง
- เมื่อ phase นี้ครบและ tests/eval ที่ตกลงกันผ่าน ให้ push branch ของ phase นี้เข้า dev flow 1 ครั้ง
- ถ้าจะ merge เข้า `dev` โดยตรง ให้ทำเฉพาะเมื่อ workflow/project owner อนุมัติ

## Sprint 1: Resolver output contract

เป้าหมาย:

- นิยามผลลัพธ์กลาง เช่น `reuse_scope`, `fresh_search`, `clarify`, `unsupported`
- ใส่ confidence, selected scope id, reason code, และ limitations
- Reason code ควรอ่าน debug ได้ เช่น `short_followup`, `explicit_new_search`, `multiple_candidate_scopes`

ผลลัพธ์ที่คาดหวัง:

- Router และ verifier ใช้ผลลัพธ์เดียวกันได้
- Debug อาการ drift ได้จาก logs/metadata โดยไม่ต้อง dump content ส่วนตัว

Commit หลัง sprint:

- ตัวอย่าง message: `phase 03 sprint 1: define reference resolver contract`

## Sprint 2: Rule-first resolver

เป้าหมาย:

- จับ short follow-up และ pronoun ที่ชัด เช่น "มีกี่รูป", "กี่อัน", "อะไรนะ", "อันนั้น", "อันแรก", "เช็คอีกที"
- ถ้ามี recent scope เดียวที่เด่น ให้ reuse
- ถ้ามีหลาย scope ใกล้กัน ให้ clarify
- ถ้ามี explicit new intent เช่น "ค้นใหม่", "หาใน...", "ลองดูอีกโฟลเดอร์" ให้ fresh search

ผลลัพธ์ที่คาดหวัง:

- แก้เคส Drive/Gmail/LINE drift หลักได้โดยไม่ต้องเพิ่ม token มาก
- ไม่ปิดทาง user ที่ตั้งใจ search ใหม่จริง

Commit หลัง sprint:

- ตัวอย่าง message: `phase 03 sprint 2: add rule-first reference resolution`

## Sprint 3: Source Router integration

เป้าหมาย:

- ให้ read flows consult resolver ก่อนยิง focused source search ใหม่
- เริ่มจาก Drive เพราะเป็นอาการที่มีหลักฐานชัดที่สุด
- จากนั้นขยายไป Gmail และ LINE โดยไม่เปลี่ยน connector contract เกินจำเป็น

ผลลัพธ์ที่คาดหวัง:

- "มีกี่รูป" หลัง Drive result ควรใช้ scope เดิม
- "กี่ฉบับ" หลัง Gmail result ควรใช้ scope เดิม
- "ล่าสุดว่าไง" หลัง LINE focused chat ควรใช้ chat เดิม

Commit หลัง sprint:

- ตัวอย่าง message: `phase 03 sprint 3: route follow-ups through evidence scopes`

## Sprint 4: Clarification behavior

เป้าหมาย:

- ถ้า resolver confidence ต่ำหรือ candidate หลายชุด ให้ถามย้ำแบบสั้นและมีตัวเลือกที่อิง evidence จริง
- ห้ามเดาสุ่มในงาน write-sensitive เช่น calendar/reminder/email
- คำถามย้ำควรเป็นภาษาเดียวกับ user และไม่อธิบาย implementation

ผลลัพธ์ที่คาดหวัง:

- ลด false action และ false search
- User รู้สึกว่า Friday เข้าใจบริบท แต่ไม่มั่วเมื่อไม่แน่ใจ

Commit หลัง sprint:

- ตัวอย่าง message: `phase 03 sprint 4: add clarification gate for ambiguous references`

## Phase Done

ก่อน push:

- Golden cases ใน Phase 01 สำหรับ read-only follow-up ผ่านหรือดีขึ้นชัดเจน
- เคส explicit new search ยัง search ใหม่ได้
- Token usage ของ normal chat ไม่เพิ่มผิดสัดส่วน
- Logs ไม่เก็บ private content เกินจำเป็น

