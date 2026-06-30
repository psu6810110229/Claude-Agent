# Phase 06: Model Performance, Gemini Hardening, และ Provider Comparison

อ้างอิง: `docs/hotfix/conversation-reference-audit.md`

เอกสารนี้ไม่ถือว่า model tuning แทน deterministic evidence ได้ เป้าหมายคือทำให้ Gemini 3.1 Flash Lite ใช้ evidence ที่ backend เตรียมไว้ได้คุ้มขึ้น และยังเทียบกับ Qwen ได้อย่างจริงใจ

## วัตถุประสงค์

รีดประสิทธิภาพ Gemini ให้ดีขึ้นใน budget 20-30 วินาที โดยใช้ compact evidence pack, prompt ที่ชัดแต่ไม่ยาวเกิน, verifier feedback, และ eval เทียบ Qwen แบบวัดได้

## หลักฐานจาก audit

- Gemini no-thinking เร็วมากแต่ reasoning ตื้นกว่า
- Gemini thinking ดีขึ้นแต่ยังพลาด implied follow-up บางเคส
- Qwen ช้ากว่าแต่จับ implication/deep search ได้ดีกว่า
- Prompt/CoT อย่างเดียวไม่พอถ้า evidence ที่ให้ model ไม่ bind กับ source จริง

## Branch และกติกา

Suggested branch: `codex/evidence-router-phase-06-model-performance-eval`

- ทุก phase ต้องทำบน branch แยกของตัวเอง
- เมื่อจบ 1 sprint ให้ทำ focused checks ที่เกี่ยวข้อง แล้ว commit 1 ครั้ง
- เมื่อ phase นี้ครบและ tests/eval ที่ตกลงกันผ่าน ให้ push branch ของ phase นี้เข้า dev flow 1 ครั้ง
- ถ้าจะ merge เข้า `dev` โดยตรง ให้ทำเฉพาะเมื่อ workflow/project owner อนุมัติ

## Sprint 1: Compact evidence pack สำหรับ provider

เป้าหมาย:

- ส่ง evidence scope เข้า provider ในรูปแบบสั้น คง source/count/ids/limitations ที่จำเป็น
- ลด text history ที่ไม่จำเป็นเมื่อมี structured evidence
- ใส่ budget/cap ชัดเจนเพื่อไม่ให้ token พุ่ง

ผลลัพธ์ที่คาดหวัง:

- Gemini มีข้อมูลที่ถูกต้องขึ้นโดยไม่ต้องอ่านบริบทยาว
- Latency และ token usage ยังอยู่ใน budget

Commit หลัง sprint:

- ตัวอย่าง message: `phase 06 sprint 1: compact evidence packs for providers`

## Sprint 2: Prompt hardening แบบ evidence-first

เป้าหมาย:

- ปรับ provider prompt ให้ใช้ evidence scope เป็น source of truth
- ถ้า evidence ไม่พอให้ถามย้ำ ไม่เดาจาก text history
- Prompt ไม่ควรบังคับ chain-of-thought output หรือทำให้คำตอบยาวเกินจำเป็น

ผลลัพธ์ที่คาดหวัง:

- Gemini ตอบ follow-up และ implied tasks ได้แม่นขึ้น
- ลด hallucinated source/action

Commit หลัง sprint:

- ตัวอย่าง message: `phase 06 sprint 2: harden provider prompts around evidence`

## Sprint 3: Provider policy และ fallback

เป้าหมาย:

- ทบทวน policy ใน provider routing ว่า task แบบไหนให้ Gemini ทำก่อน, task แบบไหนควร escalate/fallback ไป Qwen
- ใช้ eval data เป็นหลัก ไม่ใช้ความรู้สึก
- รักษา architecture เดิม: provider เสนอเท่านั้น backend validate/execute

ผลลัพธ์ที่คาดหวัง:

- Gemini เป็น default ที่เร็วขึ้นและแม่นขึ้น
- Qwen ถูกใช้เมื่อ reasoning complexity คุ้มกับ latency

Commit หลัง sprint:

- ตัวอย่าง message: `phase 06 sprint 3: tune provider policy from eval results`

## Sprint 4: Final model eval report

เป้าหมาย:

- รัน eval suite เทียบ Gemini 3.1 Flash Lite, Gemini thinking setting ที่เลือก, และ Qwen เมื่อ keys ถูกตั้งใน environment อย่างชัดเจน
- ถ้า keys ไม่พร้อม ให้สร้าง report จาก deterministic eval และระบุ provider eval ว่า skipped
- สรุป latency p50/p95, token usage, pass rate, และ failure classes

ผลลัพธ์ที่คาดหวัง:

- มีตัวเลขก่อน/หลัง phase ให้ตัดสินใจได้
- เห็นชัดว่า Gemini ดีขึ้นตรงไหน และยังควรให้ Qwen ช่วยตรงไหน

Commit หลัง sprint:

- ตัวอย่าง message: `phase 06 sprint 4: publish final model comparison report`

## Phase Done

ก่อน push:

- Eval suite ผ่านตาม threshold ที่ตกลง
- Provider eval ไม่อ่าน `.env` เองโดยไม่ได้รับอนุญาต
- Token/latency ไม่เกิน budget ที่ตั้งไว้โดยไม่มีเหตุผล
- รายงานสุดท้ายแยกข้อเท็จจริงจากข้อเสนอแนะชัดเจน

