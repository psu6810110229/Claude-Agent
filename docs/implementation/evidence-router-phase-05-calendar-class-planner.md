# Phase 05: Calendar Class Planner และ Ambiguous Schedule Changes

อ้างอิง: `docs/hotfix/conversation-reference-audit.md`

เอกสารนี้โฟกัสการเข้าใจคำสั่งตารางเรียน/ปฏิทินที่ user พิมพ์สั้น แต่ยังคงหลักเดิมว่า backend ต้อง validate และ action ต้องผ่าน approval gate

## วัตถุประสงค์

ทำให้ Friday เข้าใจคำสั่ง schedule ที่อาศัยบริบท เช่น วิชาเรียนประจำ, "อาทิตย์นี้", "งดเรียน", "เรียนชด", และ date/time หลายชุด โดยถามย้ำเมื่อ mapping ไม่ชัด

## หลักฐานจาก audit

- Calendar infra เดิมมี constraints, availability resolver, verifier, และ approval queue ที่ค่อนข้างแข็งแรง
- ช่องว่างอยู่ที่ operation planner / clarification gate สำหรับคำสั่งมนุษย์ที่สั้นและมี implication
- ตัวอย่าง 4 dates + 2 time ranges ต้องถาม mapping ก่อน stage action

## Branch และกติกา

Suggested branch: `codex/evidence-router-phase-05-calendar-class-planner`

- ทุก phase ต้องทำบน branch แยกของตัวเอง
- เมื่อจบ 1 sprint ให้ทำ focused checks ที่เกี่ยวข้อง แล้ว commit 1 ครั้ง
- เมื่อ phase นี้ครบและ tests/eval ที่ตกลงกันผ่าน ให้ push branch ของ phase นี้เข้า dev flow 1 ครั้ง
- ถ้าจะ merge เข้า `dev` โดยตรง ให้ทำเฉพาะเมื่อ workflow/project owner อนุมัติ

## Sprint 1: Class/event matching

เป้าหมาย:

- Match course code/title เช่น `240-218 circuit` กับ class blocks หรือ calendar events ที่มีอยู่
- รองรับชื่อย่อ/สะกดไม่ครบเท่าที่ evidence พอ
- ถ้ามีหลายวิชาคล้ายกัน ให้ถามย้ำ

ผลลัพธ์ที่คาดหวัง:

- User ไม่ต้องอธิบายตารางเรียนซ้ำถ้าระบบมี context อยู่แล้ว
- ไม่เดาวิชาผิดเมื่อ candidate ใกล้กัน

Commit หลัง sprint:

- ตัวอย่าง message: `phase 05 sprint 1: match class references to schedule evidence`

## Sprint 2: Occurrence resolver

เป้าหมาย:

- Resolve คำอย่าง "อาทิตย์นี้", "พฤหัสนี้", "คาบหน้า" เป็น occurrence จริงพร้อม timezone
- ใช้ Google Calendar เป็น schedule source หลักตาม project rule
- Local events/reminders เป็น secondary เว้นแต่ user ระบุชัด

ผลลัพธ์ที่คาดหวัง:

- งดเรียนเฉพาะ occurrence ที่ถูกต้อง ไม่ลบ recurring series ผิด
- Date/time ชัดเจนก่อนสร้าง proposal

Commit หลัง sprint:

- ตัวอย่าง message: `phase 05 sprint 2: resolve class occurrences for schedule changes`

## Sprint 3: Makeup class operation planner

เป้าหมาย:

- แปลง intent เป็น operation plan เช่น cancel/mark skipped occurrence และ create makeup online class events
- ถ้า dates กับ time ranges mapping ไม่ครบ ให้ถามย้ำก่อนสร้าง proposal
- แผนควรบอกสิ่งที่จะเปลี่ยนเป็นรายการอ่านง่าย

ผลลัพธ์ที่คาดหวัง:

- เคส "วันที่ 9, 21, 25, 26 กค 19:00-21:00 และ 15:00-17:00" ต้องไม่เดาว่าเวลาไหนคู่วันไหน
- User ได้คำถามย้ำที่ตรงจุด

Commit หลัง sprint:

- ตัวอย่าง message: `phase 05 sprint 3: plan makeup class operations with clarification`

## Sprint 4: Approval-gated staging

เป้าหมาย:

- ส่ง create/update/delete calendar proposals เข้า approval queue/action dispatcher ตาม architecture เดิม
- Recoverable delete behavior ต้องเคารพ toggle และ guardrail เดิม
- Summary ที่ user เห็นควรตรงกับ proposed actions ทุกข้อ

ผลลัพธ์ที่คาดหวัง:

- ไม่มี direct Google Calendar write จาก model/provider
- User เห็นและอนุมัติก่อน action จริง

Commit หลัง sprint:

- ตัวอย่าง message: `phase 05 sprint 4: stage class schedule plans through approvals`

## Phase Done

ก่อน push:

- Golden cases สำหรับ calendar/class planner ผ่าน
- ตรวจ timezone และ absolute date ใน test cases
- Smoke/focused tests ของ schedule verifier/approval queue ผ่าน
- ไม่มี write capability ใหม่ที่ bypass approval

