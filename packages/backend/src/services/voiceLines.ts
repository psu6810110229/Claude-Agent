/**
 * Deterministic Thai JARVIS voice lines for scheduler notifications.
 * Pure functions — no Claude, no DB, no async. Keep each line ≤ 120 chars.
 */

export function reminderDueLine(title: string): string {
  return `ครับผม ถึงเวลา ${title} แล้วครับ`;
}

export function eventSoonLine(title: string, location?: string): string {
  return location
    ? `${title} กำลังจะเริ่มแล้วครับ ที่ ${location}`
    : `${title} กำลังจะเริ่มแล้วครับ`;
}

export function approvalNagLine(count: number): string {
  return `ครับผม มีงานรออนุมัติ ${count} รายการ ค้างอยู่ครับ รบกวนตรวจสอบด้วยครับ`;
}
