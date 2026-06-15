/**
 * Deterministic Thai JARVIS voice lines for scheduler notifications.
 * Pure functions — no Claude, no DB, no async. Keep each line ≤ 120 chars.
 */

export function reminderDueLine(title: string): string {
  return `ถึงเวลา ${title} แล้วครับ`;
}

export function eventSoonLine(title: string, location?: string): string {
  return location
    ? `${title} กำลังจะเริ่มแล้ว ที่ ${location} ครับ`
    : `${title} กำลังจะเริ่มแล้วครับ`;
}

export function approvalNagLine(count: number): string {
  return `มีงานรออนุมัติ ${count} รายการค้างอยู่ รบกวนตรวจสอบด้วยครับ`;
}
