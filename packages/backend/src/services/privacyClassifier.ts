/**
 * Step 15 — privacy keyword prefilter.
 *
 * Heuristic only: detects when a chat message is PROBING for the owner's private
 * specifics so the dashboard can show the verify panel. This is a UX TRIGGER, NOT
 * the security boundary — a missed keyword does not leak data because redaction
 * (chat.ts buildChatContext) already removed private fields from the prompt.
 *
 * Brittle by design; conservative patterns. Refine over time. Thai + English.
 */
export interface SensitivityResult {
  private: boolean;
  matched: string[];
}

// Thai + English cues that the requester is probing PRIVATE specifics.
const PRIVATE_PATTERNS: { re: RegExp; tag: string }[] = [
  { re: /ที่ไหน|สถานที่|ที่อยู่|address|location|where\b/i, tag: "location" },
  { re: /กับใคร|ใครบ้าง|with whom|who.*with|พบใคร|เจอใคร/i, tag: "people" },
  { re: /เบอร์|phone|email|อีเมล|ติดต่อ/i, tag: "contact" },
  { re: /ชอบ|ความชอบ|preference|รสนิยม/i, tag: "preference" },
  {
    re: /ความลับ|secret|ส่วนตัว|private|ความทรงจำ|จำอะไรเกี่ยวกับ|remember about/i,
    tag: "personal",
  },
  {
    re: /ตารางของ|กำหนดการของ|schedule of|นัดอะไร|มีอะไรบ้างวันนี้.*รายละเอียด/i,
    tag: "schedule-detail",
  },
];

export function classifySensitivity(message: string): SensitivityResult {
  const matched = PRIVATE_PATTERNS.filter((p) => p.re.test(message)).map((p) => p.tag);
  return { private: matched.length > 0, matched };
}
