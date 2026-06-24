/**
 * Evidence verifier — Phase B, Step 22.
 *
 * Pure, deterministic, no IO. Turns a LineEvidence bundle into an
 * EvidenceVerdict (allowed/blocked claims + guidance) BEFORE prompt generation.
 * Constraining upfront is more reliable than post-hoc NL verification.
 *
 * All guidance lines are in Thai/mixed to match Friday persona.
 */

import type { LineEvidence } from "./lineEvidence.js";
import type { LineChatCoverage } from "./lineChat.js";

export interface EvidenceVerdict {
  confidence: "high" | "medium" | "low";
  guidance: string[]; // short imperative lines injected into the prompt
  allowedClaims: string[];
  blockedClaims: string[];
}

// Always-blocked claims regardless of evidence content
const ALWAYS_BLOCKED_CLAIMS = [
  "LINE ยังไม่ได้อ่าน / ยังไม่เห็น / อ่านแล้ว (read/unread ไม่มีใน export)",
  "live LINE หรือข้อมูล real-time",
  "ผู้ส่ง / เวลา / กลุ่มที่ไม่ปรากฏใน evidence bundle",
];

const ALWAYS_GUIDANCE = [
  'เมื่อตอบจาก LINE ให้ใช้ภาษาว่า "จาก export LINE ล่าสุดที่ระบบเห็น"',
  "ห้ามอ้างสถานะ read/unread และห้ามอ้างว่าเห็น LINE แบบ real-time",
  "ห้ามระบุชื่อผู้ส่ง/เวลา/กลุ่มที่ไม่มีอยู่ใน evidence bundle",
];

/**
 * Verify evidence for an answer-intent question (e.g. "มีใครตอบยัง?").
 * Returns guardrails for what Friday may and may not claim.
 */
export function verifyLineEvidenceAnswerIntent(input: {
  userMessage: string;
  evidence: LineEvidence;
}): EvidenceVerdict {
  const { evidence } = input;

  // Case 1: LINE disabled / error
  if (!evidence.available) {
    return {
      confidence: "low",
      guidance: [
        ...ALWAYS_GUIDANCE,
        "บอกตรงๆ ว่าตอนนี้ดู LINE export ไม่ได้",
        "ห้ามอ้างข้อมูลจาก LINE ใด ๆ ทั้งสิ้น",
      ],
      allowedClaims: [
        'may say "ตอนนี้ระบบเข้า LINE export ไม่ได้ ยังตอบเรื่องนี้จาก LINE ไม่ได้ค่ะ"',
      ],
      blockedClaims: [
        ...ALWAYS_BLOCKED_CLAIMS,
        "ทุก specific claim เกี่ยวกับ LINE",
        '"ไม่มีใครตอบ" (ไม่รู้เพราะ LINE ไม่พร้อม)',
        '"ไม่มีอัปเดต" (ไม่รู้เพราะ LINE ไม่พร้อม)',
      ],
    };
  }

  // Case 2: Available but no messages matched
  if (evidence.messages.length === 0) {
    return {
      confidence: "medium",
      guidance: [
        ...ALWAYS_GUIDANCE,
        "บอกว่าไม่พบข้อความใหม่เรื่องนี้ใน export ล่าสุด แต่ห้ามพูดว่าไม่มีใครตอบอย่างเด็ดขาด",
        "เตือนว่า export อาจไม่ใช่ข้อมูลล่าสุด",
        ...(evidence.staleCaveat
          ? ["เตือนผู้ใช้ว่าระบบเห็นแค่ถึง export ล่าสุด ซึ่งอาจเก่า"]
          : []),
      ],
      allowedClaims: [
        '"ยังไม่เห็นข้อความใหม่เรื่องนี้ใน export ล่าสุด"',
        '"export อาจไม่ update แล้ว"',
      ],
      blockedClaims: [
        ...ALWAYS_BLOCKED_CLAIMS,
        '"ไม่มีใครตอบ" เป็น absolute (export ไม่ใช่ inbox จริง)',
        '"ไม่มีอัปเดต" เป็น absolute',
      ],
    };
  }

  // Case 3: Has messages — check for candidate answers
  const hasAnswers = evidence.candidateAnswers.length > 0;
  const hasQuestions = evidence.candidateQuestions.length > 0;

  // Determine confidence
  let confidence: "high" | "medium" | "low";
  if (hasAnswers) {
    // High only if candidate answer is from a different sender AND within window
    const goodAnswer = evidence.candidateAnswers.some(
      (a) =>
        evidence.candidateQuestions.some(
          (q) => q.sender !== a.sender && q.chat === a.chat,
        ),
    );
    confidence = goodAnswer ? "high" : "medium";
  } else {
    confidence = "medium";
  }

  const guidance: string[] = [
    ...ALWAYS_GUIDANCE,
    ...(evidence.staleCaveat
      ? ["เตือนผู้ใช้ว่าเห็นแค่ถึง export ล่าสุด ซึ่งอาจเก่า"]
      : []),
  ];

  const allowedClaims: string[] = [
    `"จาก export LINE ล่าสุด มีข้อความเกี่ยวเรื่องนี้ ${evidence.stats.total} รายการ"`,
  ];
  const blockedClaims: string[] = [...ALWAYS_BLOCKED_CLAIMS];

  if (hasAnswers) {
    allowedClaims.push(
      '"มีคนตอบแล้ว (น่าจะ ...)" — hedged, candidate only',
      '"ดูเหมือนมีการตอบใน export"',
    );
    blockedClaims.push('"ไม่มีใครตอบ" (candidate answers exist in evidence)');
  } else if (hasQuestions) {
    // Questions found but no answers
    allowedClaims.push('"ยังไม่เห็นคำตอบใน export ล่าสุด"');
    blockedClaims.push(
      '"ไม่มีใครตอบ" เป็น absolute — ใช้แค่ "ยังไม่เห็นคำตอบใน export ล่าสุด"',
    );
  } else {
    allowedClaims.push('"ใน export มีข้อความเกี่ยวเรื่องนี้"');
    blockedClaims.push('"ไม่มีใครตอบ" as absolute');
  }

  blockedClaims.push('"ไม่มีอัปเดต" เป็น absolute');

  return { confidence, guidance, allowedClaims, blockedClaims };
}

/**
 * S4 — coverage-claim guard for a focused-chat BOUNDARY question
 * ("เก่าสุด/since when"). The bug it prevents: Friday narrating the oldest message
 * in its WINDOW as the start of the whole export (docs/line-coverage-plan.md L1).
 *
 * - No coverage fact → it CANNOT state the extent: force a hedge, block any
 *   "starts at / nothing older" claim.
 * - Coverage present → it MUST answer the boundary from coverage (earliest/latest/
 *   count, segmented if gaps), and is blocked from contradicting it.
 *
 * Pure, deterministic. Verified-path only (caller discards for unverified).
 */
export function verifyLineCoverageClaim(input: {
  chat: string;
  coverage: LineChatCoverage | null;
}): EvidenceVerdict {
  const { coverage } = input;
  if (
    !coverage ||
    coverage.count === 0 ||
    !coverage.earliest ||
    !coverage.latest
  ) {
    return {
      confidence: "low",
      guidance: [
        ...ALWAYS_GUIDANCE,
        "ยังไม่มีข้อมูล coverage ของแชทนี้ — บอกจุดเริ่ม/ข้อความเก่าสุดไม่ได้",
        "บอกตรงๆ ว่าเห็นแค่ข้อความล่าสุด ยืนยันไม่ได้ว่าแชทเริ่มเมื่อไหร่",
      ],
      allowedClaims: [
        '"ตอนนี้เห็นแค่ข้อความล่าสุดของแชทนี้ ยังบอกไม่ได้ว่าเริ่มเมื่อไหร่ค่ะ"',
      ],
      blockedClaims: [
        ...ALWAYS_BLOCKED_CLAIMS,
        '"export เริ่มที่ <วันของข้อความที่เห็น>" — ห้ามอ้างจุดเริ่มจาก window',
        '"ไม่มีข้อความเก่ากว่านี้" เป็น absolute',
      ],
    };
  }

  const e = coverage.earliest;
  const l = coverage.latest;
  const segmented = coverage.gaps.length > 0;
  return {
    confidence: "high",
    guidance: [
      ...ALWAYS_GUIDANCE,
      `ตอบ "เก่าสุด/เริ่มเมื่อไหร่" จาก COVERAGE: เก่าสุด ${e.date} ${e.time}`,
      "ห้ามบอกว่า export เริ่มที่ข้อความล่าสุดที่เห็น — ใช้ค่า COVERAGE",
      ...(segmented
        ? [
            `ประวัติไม่ต่อเนื่อง มีช่วงเว้น ${coverage.gaps.length} ช่วง — อธิบายเป็นช่วงๆ`,
          ]
        : []),
    ],
    allowedClaims: [
      `"export ของแชทนี้เก่าสุด ${e.date} ${e.time}, ล่าสุด ${l.date} ${l.time}, รวม ${coverage.count} ข้อความ"`,
    ],
    blockedClaims: [
      ...ALWAYS_BLOCKED_CLAIMS,
      `"export เริ่มหลัง ${e.date}" — ขัดกับ COVERAGE`,
      '"ไม่มีข้อความเก่ากว่าที่เห็น" — ขัดกับ COVERAGE',
      ...(segmented ? ['"ประวัติต่อเนื่อง/คุยกันตลอด" — มีช่วงเว้นจริง'] : []),
    ],
  };
}
