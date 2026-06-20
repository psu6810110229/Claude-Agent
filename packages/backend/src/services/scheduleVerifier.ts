/**
 * Schedule verifier — Step 27 / Sprint 4 (RC6).
 *
 * Pure, deterministic, no IO. The scheduling counterpart of `evidenceVerifier`:
 * it turns the deterministic AVAILABILITY report + sticky CONSTRAINTS into a
 * verdict (allowed/blocked claims + guidance) BEFORE the prompt is built, so the
 * model narrates the computed result instead of free-handing "free / clashes /
 * moved to X" over raw lists. Constraining upfront beats post-hoc NL checking.
 *
 * Mirrors `EvidenceVerdict` shape exactly. Guidance is Thai/mixed (Friday voice).
 */

import type {
  AvailabilityReport,
  AvailabilityClash,
} from "./availabilityResolver.js";
import type { ScheduleConstraint } from "../schemas/scheduleConstraint.js";

export interface ScheduleVerdict {
  confidence: "high" | "medium" | "low";
  guidance: string[];
  allowedClaims: string[];
  blockedClaims: string[];
}

// Always-on scheduling discipline regardless of clash state.
const ALWAYS_GUIDANCE = [
  "ห้ามคิดวันในสัปดาห์หรือเวลา Bangkok เอง — ใช้ค่าที่ระบบคำนวณให้แล้ว (Bangkok + weekday ในแต่ละบรรทัด, raw UTC อยู่หลัง utc=)",
  "ตัดสิน 'ว่าง/ชน' จากบล็อก AVAILABILITY / CONFLICTS เท่านั้น ห้ามเดาจากการกวาดสายตา",
  "เคารพ SCHEDULE CONSTRAINTS ทุกข้อ ห้ามเสนอหรือยืนยันเวลาในช่วง protected_window หรือทับ recurring_block",
];

const ALWAYS_BLOCKED = [
  "คำนวณวัน/เวลาเองแล้วยืนยันโดยไม่อิง utc= anchor",
  'ยืนยันว่า "เรียบร้อย/จัดการให้แล้ว" ก่อนระบบรายงานผลจริง',
];

/**
 * Build the scheduling verdict for one turn. `availability` is null on a
 * non-scheduling turn (caller skips). `constraints` are the sticky tank/class
 * rules already in context. Deterministic and pure.
 */
export function verifyScheduleAnswerIntent(input: {
  availability: AvailabilityReport;
  constraints: ScheduleConstraint[];
}): ScheduleVerdict {
  const { availability, constraints } = input;
  const clashes = availability.clashes;
  const constraintClashes = clashes.filter((c) => c.involvesConstraint);

  const guidance = [...ALWAYS_GUIDANCE];
  const allowedClaims: string[] = [];
  const blockedClaims = [...ALWAYS_BLOCKED];

  if (clashes.length === 0) {
    // No clash found across all known sources — confident but scoped.
    guidance.push(
      "ไม่พบการชนในแหล่งที่ระบบเห็น (Google + local + reminders + constraints) — บอกได้ว่า 'ไม่ชนกับอะไรที่เห็น' แต่ห้ามรับประกันเด็ดขาดว่าว่าง 100%",
    );
    allowedClaims.push(
      '"จากที่ระบบเห็น เวลานี้ไม่ชนกับนัด/เตือน/กฎตู้ปลา-คลาส"',
    );
    blockedClaims.push(
      '"ว่างแน่นอน 100%" เป็น absolute (ระบบเห็นแค่แหล่งที่ระบุ ไม่ใช่ทุกอย่าง)',
    );
    return {
      confidence: constraints.length > 0 ? "high" : "medium",
      guidance,
      allowedClaims,
      blockedClaims,
    };
  }

  // Clashes exist — block any "free" claim at those times.
  guidance.push(
    "มีการชนตามบล็อก AVAILABILITY — ต้องแจ้งผู้ใช้ทุกการชน ห้ามพูดว่าเวลานั้นว่าง",
  );
  allowedClaims.push(
    `"เวลานี้ชน ${clashes.length} รายการตามที่ระบบตรวจ" (อ้างจาก AVAILABILITY)`,
  );
  blockedClaims.push(
    '"เวลานี้ว่าง" / "ไม่ชน" สำหรับเวลาที่มีในรายการชน',
    ...clashes.map(
      (c) => `อ้างว่าว่างทับ "${describeClash(c)}"`,
    ),
  );

  if (constraintClashes.length > 0) {
    guidance.push(
      "มีการชน protected_window/recurring_block — ห้ามยืนยัน action ลงเวลานั้น เสนอเวลานอกช่วงแทน และเตือนว่าเวลานี้ผิดกฎตู้ปลา/คลาส",
    );
    blockedClaims.push(
      "ยืนยัน reminder/event ลงเวลาที่อยู่ในช่วงต้องห้าม (ระบบจะ hold ไว้รอยืนยันอยู่แล้ว — อย่ารายงานว่าทำเสร็จ)",
    );
  }

  return {
    confidence: "high",
    guidance,
    allowedClaims,
    blockedClaims,
  };
}

function describeClash(c: AvailabilityClash): string {
  return `${c.labels.join(" ⨯ ")} (${c.detail})`;
}
