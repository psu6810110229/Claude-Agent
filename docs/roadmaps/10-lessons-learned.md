# Lessons Learned

## 2026-06-12 - Future Multi-Provider Agent Direction

### Symptom

We discussed adding Gemini as an additional AI option, with both Manual and Auto model selection, while keeping the system reliable enough for future multi-step JARVIS workflows.

### Root Cause

A simple model dropdown would not be enough for the long-term product direction. Future workflows may need deterministic reads, filtered context, multiple AI analysis steps, transparent provider choice, and approval-gated action proposals.

### Fix

No code or current roadmap implementation was changed for Gemini. The agreed direction is:

- finish roadmaps 00-09 first
- treat Claude/Gemini as proposal-only providers, not state owners
- keep the backend orchestrator as owner of AgentRun, AgentStep, state transitions, validation, guardrails, and approvals
- support Manual provider choice first, then transparent Auto choice later
- never switch providers silently
- allow model choice per step in future workflows, with provider/model/reason visible to the user when relevant

### Test Added Or Updated

No automated test yet. Future tests should use stubbed providers and must not call live Claude, live Gemini, or real Google APIs.

### Follow-Up

When 00-09 are complete, create a post-09 roadmap for AI provider abstraction, Gemini provider support, AgentRun/AgentStep, guardrails, step budgets, provider trace, and transparent fallback policy.

ใช้ไฟล์นี้บันทึก bug หรือ insight ที่เจอระหว่าง implementation sprint

## Entry Template

```markdown
## YYYY-MM-DD - Sprint Name

### Symptom

เกิดอะไรขึ้น ผู้ใช้เห็นอะไร หรือ test fail อย่างไร

### Root Cause

สาเหตุจริงอยู่ที่ไฟล์/ชั้นไหน

### Fix

แก้อะไรไป และทำไมเลือกวิธีนี้

### Test Added Or Updated

เพิ่ม/แก้ test หรือ smoke อะไร

### Follow-Up

สิ่งที่ควรกลับมาทำทีหลัง ถ้ามี
```

## 2026-06-12 - Roadmap Discovery

### Symptom

Jarvis สามารถตอบเหมือน action สำเร็จหรือยังค้างอยู่แบบไม่ตรงกับ state จริงหลังผู้ใช้ approve action จาก chat

### Root Cause

จากการอ่านโปรเจกต์:

- approval มี status แค่ `pending`, `approved`, `rejected`
- execution result ไม่มี state แยกใน approval model
- chat context ยังไม่ include recent approval/action outcomes
- reminder ยังไม่มี `done` state ทำให้การ "ทำเสร็จ" ถูกแทนด้วย archive ได้ง่าย

### Fix

ยังไม่แก้ code ในรอบนี้ เพราะเป็น documentation/roadmap sprint เท่านั้น

### Test Added Or Updated

ยังไม่มี test เพิ่มในรอบนี้

### Follow-Up

เริ่มจาก Sprint 1 และ Sprint 3 ก่อน เพราะเป็น data truth และ approval truth ที่ส่งผลต่อ UX ทั้งระบบ

## 2026-06-12 - Sprint 2 Action Registry

### Symptom

Dashboard `page.tsx` `isActionType()` allowlist ไม่มี `reminder.done` (ตกค้างจาก Sprint 1 ที่เพิ่ม `reminder.done` ใน backend แล้ว). ผลคือ action `reminder.done` ที่ chat propose จะถูก `parseActions` drop เงียบๆ — inline approval ไม่โผล่ใน chat bubble.

### Root Cause

Action wording/allowlist ถูก hardcode ซ้ำหลายจุด (backend enum, dashboard `isActionType`, `approvalCopy`). เพิ่ม action type ใหม่ใน backend แต่ลืม sync ฝั่ง dashboard.

### Fix

- backend: `services/actionRegistry.ts` เป็น canonical metadata (domain, humanLabel, riskLevel, outward, allowedInChat).
- dashboard: `lib/actionDisplay.ts` รวม `ACTION_TYPES`/`isActionType`/`actionQuestion`/`summarizePayload` ไว้ที่เดียว + เพิ่ม `reminder.done` พร้อม wording เฉพาะ ("ทำ reminder นี้เป็นเสร็จแล้วไหม").
- approvals page แสดง `humanLabel` + payload summary แทน raw `action_type`; raw JSON ย้ายไป `<details>` (collapsed).

### Test Added Or Updated

`npm run smoke:registry` — assert backend enum == `actionPayloadSchemas` keys == registry keys, ทุก type มี humanLabel, มีแค่ `google_event.create` ที่ outward. Build dashboard จับ action type mismatch ฝั่ง UI.

### Follow-Up

ฝั่ง dashboard ยัง hand-mirror list อยู่ (ไม่มี shared types package). Sprint 5 จะทำ approvals board UI เต็มรูปแบบ — ตอนนั้น `humanLabel`/`summarizePayload` ใช้ต่อได้.
