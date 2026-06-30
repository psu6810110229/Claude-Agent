# Conversation Reference Audit และ Model Eval

วันที่: 2026-06-30  
ขอบเขต: inspect / audit / diagnose เท่านั้น ไม่มีการแก้ application code, ไม่อ่าน `.env`, `data/`, DB, secrets, หรือ exports จริง, และไม่ยิง live provider เพิ่ม

## สรุปสั้น

ปัญหาหลักไม่ใช่ dashboard preview แต่เป็นการที่ backend ปล่อยให้ follow-up สั้น ๆ กลายเป็น source search ใหม่ โดยไม่มีหลักฐานผูกกับคำตอบก่อนหน้า

อาการจึงเกิดแบบนี้ได้:

1. ข้อความตอบอิงจาก chat history เดิม เลยตอบว่า "มี 5 ภาพ"
2. source preview ถูกสร้างจาก Drive search ใหม่ เลยไปเจอ 30 ภาพจากคนละ scope
3. dashboard แสดงตาม `totalItems` ที่ backend ส่งมา จึงขึ้น `+26 ภาพ`

สรุป root cause: ไม่มี Evidence Scope ที่เป็น structured state ของคำตอบล่าสุด และไม่มี Reference Resolver ที่ตัดสินว่า "มีกี่รูป", "อะไรนะ", "เช็คอีกที" ควร reuse scope เดิม, search ใหม่, หรือถามย้ำ

## หลักฐานในโค้ด

- `packages/backend/src/services/chat.ts:1112` สร้าง history จาก `listRecentMessages(...)` โดยเก็บแค่ `role` และ `content` ไม่ได้ส่ง `source_previews_json` หรือ evidence ids กลับเข้า prompt/state
- `packages/backend/src/services/chat.ts:1467` ถ้า `detectDriveReadIntent(message)` ติด จะเริ่ม Drive focused read จากข้อความปัจจุบัน
- `packages/backend/src/services/chat.ts:1476` ถ้า match file/folder จากชื่อไม่ได้ จะเรียก `searchDriveByKeywords(driveFocusedTerms, 30, ...)`
- `packages/backend/src/services/googleDrive.ts:166` `searchDriveByKeywords` ค้นจาก keyword ปัจจุบัน
- `packages/backend/src/services/googleDrive.ts:195` order ด้วย `modifiedTime desc` และ comment ในไฟล์ระบุเองว่าไม่มี recency horizon
- `packages/dashboard/src/app/page.tsx:2087` dashboard รวม `totalItems` จาก backend
- `packages/dashboard/src/app/page.tsx:2109` overflow คือ `totalItems - previewItems.length` ดังนั้น `+26` หมายถึง backend ส่ง total 30 ไม่ใช่ UI สร้างเอง

## Root Cause Map

1. Lexical source trigger กว้างเกินไปสำหรับ follow-up  
   คำว่า "รูป/ภาพ/file/mail/line" ทำให้ระบบเข้า source read path ได้ แม้ผู้ใช้กำลังถามต่อจากผลลัพธ์ก่อนหน้า

2. ไม่มี structured previous scope  
   ระบบจำได้แค่ข้อความ แต่ไม่จำ scope แบบ machine-readable เช่น folder id, file ids, query, count, source, timestamp, confidence

3. answer evidence กับ preview evidence แยกกัน  
   model ตอบจาก text history ได้ถูก แต่ preview มาจาก retrieval รอบใหม่ที่ไม่มี anchor

4. ไม่มี post-answer verifier สำหรับ source consistency  
   ไม่มี gate ตรวจว่า "จำนวนในคำตอบ", "รายการใน preview", และ "source ที่ค้น" เป็นชุดเดียวกันหรือไม่

## ความเสี่ยงข้าม Source

| Source | โอกาสเกิด | เหตุผล |
| --- | --- | --- |
| Drive | สูงมาก | follow-up สั้น ๆ ถูกตีเป็น search ใหม่, Drive search กว้าง, ไม่มี scope binding |
| Gmail | สูง-กลาง | มี focused read intent และ query builder คล้าย Drive; follow-up เช่น "กี่ฉบับ", "อันแรก" อาจหลุด scope |
| LINE | กลาง | มี focused chat carry บางส่วน แต่ถ้าคำตามไม่อยู่ใน short-followup list ก็ยังหลุดได้ |
| Calendar / reminders | กลางถึงสูงในงานเขียน | มี verifier ดีกว่า แต่คำว่า "อันนั้น", "เลื่อนอันนี้", date/time ไม่ครบ ยังต้องมี resolver/clarification |
| Contacts | ต่ำถึงกลาง | surface แคบกว่า แต่ pronoun เช่น "เขา", "คนนี้" ยังต้อง bind กับ candidate ล่าสุด |

## วิธีแก้แบบยิงนัดเดียวได้นกหลายตัว

ทำชั้นเดียวที่ใช้ร่วมทุก connector: Evidence-Bound Conversation Router

ส่วนประกอบ:

1. Evidence Scope Store  
   เก็บ scope ล่าสุดแบบ structured ต่อ assistant turn: source, ids, parent/folder/chat/thread, query, count, displayed preview ids, timestamp, limitations

2. Conversation Reference Resolver  
   รับ message ปัจจุบัน + scopes ล่าสุด แล้วออกผลเป็น `reuse_scope`, `fresh_search`, `clarify`, หรือ `unsupported`

3. Source Router  
   ถ้าเป็น follow-up ให้ reuse scope ก่อน ไม่ใช่ยิง source search ใหม่ทันที

4. Clarification Gate  
   ถ้า candidate หลายชุด, date/time mapping ไม่ชัด, หรือกำลังจะเขียน calendar/reminder/email ให้ถามย้ำก่อน staging action

5. Deterministic Verifier  
   หลัง model ตอบ ตรวจว่า answer count, preview items, source ids, และ proposed actions สอดคล้องกับ evidence

วิธีนี้ใช้ได้กับ Drive, Gmail, LINE, Calendar, Reminders, Contacts ไม่ใช่เฉพาะเคสภาพ

## ลำดับทำก่อนหลังแบบไม่ over-engineer

1. เพิ่ม eval golden set ก่อน  
   วัด baseline ให้ชัด: scope accuracy, count accuracy, source-preview consistency, clarification precision, latency

2. ทำ Evidence Scope Store แบบเล็ก  
   เริ่มจาก Drive/Gmail/LINE read-only ก่อน เพราะเสี่ยง preview/context drift สูงและแก้แล้วเห็นผลทันที

3. ทำ Reference Resolver แบบ rule-first + model-assisted  
   rule จับคำ follow-up สั้นและ pronoun, model ช่วยเฉพาะตอน ambiguous

4. ใส่ Source Router  
   follow-up ต้อง reuse scope เดิมเป็น default; fresh search ต้องมี explicit new intent

5. ใส่ Verifier เฉพาะจุด  
   ตรวจ count/preview/source ก่อน จากนั้นค่อยขยายไป action plans

6. ค่อยทำ Calendar Class Planner  
   ใช้ infra เดิมของ constraints, availability, verifier, approval queue แต่เพิ่ม operation planner + ambiguity questions

## เคสตารางเรียนที่ควรได้

ตัวอย่าง: "งดเรียนวิชา 240-218 circuit อาทิตย์นี้ และมีเรียนชดออนไลน์วันที่ 9, 21, 25, 26 กค 19:00-21:00 และ 15:00-17:00"

ระบบควร:

1. match `240-218 circuit` กับ class blocks เดิม
2. resolve "อาทิตย์นี้" เป็น occurrence วันอังคาร/พฤหัสของสัปดาห์นั้น
3. สร้าง plan ว่าจะ cancel/mark skipped occurrence ไหน
4. สร้าง makeup events ตามวันที่และเวลา
5. ถ้า 4 วันแต่มี 2 time ranges ให้ถามย้ำ เช่น "วันที่ไหนใช้ 19:00-21:00 และวันที่ไหนใช้ 15:00-17:00?"
6. ส่ง proposal เข้า approval queue ไม่ execute ตรง

## Eval: Gemini 3.1 Flash Lite vs Qwen

ไม่ได้รัน live eval รอบใหม่ เพราะ shell ไม่มี provider keys และการใช้ script Gemini เดิมต้องอ่าน `.env` ซึ่งขัด guardrail รอบนี้

อิงจาก artifact เดิมใน `eval/`:

| Model / mode | เวลาโดยประมาณ | จุดแข็ง | จุดอ่อน |
| --- | ---: | --- | --- |
| Gemini 3.1 Flash Lite no-thinking | 1.5-3.4s | เร็วมาก | reasoning ตื้นกว่า, หลุด implied work ง่าย |
| Gemini 3.1 Flash Lite thinking 2048 | 5.6-8.6s | explicit constraint ดีขึ้น | ยังพลาดงาน follow-up / implication บางเคส |
| Gemini prompt-nudge | ใกล้ thinking mode | infer ดีขึ้น | เสี่ยง over-infer ถ้าไม่มี evidence gate |
| Qwen / qwen3.7-plus | 25.6-45.4s | จับ implication, งานซับซ้อน, deep search ดีกว่า | ช้ากว่าและแพงกว่า latency budget |

ข้อสรุป: จะรีด Gemini ให้ใกล้ Qwen ไม่ควรหวังจาก prompt/CoT อย่างเดียว ต้องให้ backend ส่ง evidence pack ที่เล็กแต่แน่น และบังคับ verifier ตรวจผลลัพธ์

## Eval Golden Set ที่ควรเพิ่ม

1. Drive: ค้น folder รูปได้ 5 ภาพ แล้วถาม "มีกี่รูป", "อะไรนะ", "เช็คอีกที" ต้องตอบและ preview จาก folder เดิม
2. Drive: มีหลาย folder ชื่อคล้ายกัน ต้องถามย้ำ ไม่เดาสุ่ม
3. Gmail: ค้น mail กลุ่มหนึ่ง แล้วถาม "กี่ฉบับ", "อันแรกจากใคร" ต้อง reuse thread/search เดิม
4. LINE: โฟกัสแชทหนึ่ง แล้วถาม "ใครตอบ", "ล่าสุดว่าไง", "อะไรนะ" ต้องไม่ข้ามแชท
5. Calendar: "เลื่อนอันนั้น" หลังเพิ่งแสดงหลาย event ต้องถามถ้า candidate มากกว่า 1
6. Reminder: "เตือนอีกทีพรุ่งนี้" ต้อง bind กับ reminder ล่าสุด ไม่สร้างอันใหม่ถ้า reference ชัด
7. Class planner: 4 dates + 2 time ranges ต้องถาม mapping
8. Mixed source: หลัง Drive แล้วถาม "กี่อัน" ต้องรู้ว่าอิง Drive ไม่ใช่ Gmail/LINE

Metrics:

- scope accuracy
- count accuracy
- preview/evidence consistency
- clarification precision
- action safety
- latency p50/p95
- token usage

## Recommendation

ทำ Evidence-Bound Conversation Router ก่อน model tuning

เหตุผล: มันแก้ทั้ง preview mismatch, follow-up drift, และช่วยให้ Gemini ทำงานดีขึ้นใน budget 20-30 วินาที เพราะ model ไม่ต้องเดาจาก history ลอย ๆ แต่ได้ evidence ที่ backend คัดและ bind มาแล้ว

ไม่ควรเริ่มจาก:

- เพิ่ม keyword list อย่างเดียว เพราะผู้ใช้พูดได้หลายแบบไม่รู้จบ
- เพิ่ม prompt ให้ยาวขึ้นอย่างเดียว เพราะจะเพิ่ม token แต่ไม่แก้ source mismatch
- ทำ multi-agent ใหญ่ทันที เพราะ root cause ตอนนี้อยู่ที่ scope/evidence contract มากกว่า orchestration

