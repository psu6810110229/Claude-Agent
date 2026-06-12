# Lessons Learned

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

