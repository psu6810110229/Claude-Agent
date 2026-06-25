import { unwrapJsonOutput } from "./jsonOutput.js";
import {
  scheduleExtractionSchema,
  type ScheduleExtraction,
} from "../schemas/scheduleImport.js";
import type { CreateScheduleImportItemInput } from "../db/repositories/scheduleImportRepo.js";
import type { ExtractedSource } from "./fileExtractor.js";
import { realGeminiInvoker, geminiVisionExtract } from "./geminiClient.js";
import type { GeminiVisionInvoker } from "./geminiClient.js";
import type { ClaudeInvoker } from "./claudeClient.js";

/**
 * Schedule extractor — turns an extracted file source (text or image/PDF parts)
 * into normalized candidate class rows for the staging buffer.
 *
 * The model ONLY proposes; nothing is written to a calendar or class_block here.
 * Unreadable fields come back null and the review card forces the user to fill
 * them before approval — no silent guessing. Vision uses Gemini (the only vision
 * provider); text-PDF uses the Gemini text invoker. Injectable for tests.
 */

const EXTRACTION_PROMPT = `You read a student's weekly class TIMETABLE (image, PDF, or text) and output its classes as STRICT JSON. This is a LOCAL timetable, NOT a calendar — output the weekly pattern only.

OUTPUT CONTRACT (output ONE JSON object, nothing else — no prose, no markdown, no code fences):
{
  "classes": [
    { "subject": string, "day": string|null, "start": string|null, "end": string|null, "location": string|null }
  ],
  "term_from": string|null,
  "term_until": string|null,
  "note": string|null
}

RULES:
- One object per class MEETING. A class that meets Mon AND Wed is TWO objects (one per day).
- "subject": the course/class name, trimmed. REQUIRED and non-empty.
- "day": the weekday in lowercase English ("monday".."sunday"). If you cannot read it, use null.
- "start"/"end": 24-hour "HH:MM" Bangkok local clock time. If unreadable, use null. Do NOT invent times.
- "location": room/building if shown, else null.
- "term_from"/"term_until": "YYYY-MM-DD" term start/end if the document states them, else null. NEVER guess.
- "note": one short user-facing note (e.g. "ตารางอ่านยากบางช่อง"), or null. NEVER include raw file text.
- Output ONLY classes you actually see. Do not pad. If the document is not a timetable, return {"classes":[],"term_from":null,"term_until":null,"note":"ไม่พบตารางเรียน"}.`;

/** English + Thai weekday tokens → JS weekday index (0=Sun..6=Sat). */
const WEEKDAY_MAP: Record<string, number> = {
  sun: 0, sunday: 0, อาทิตย์: 0, อา: 0,
  mon: 1, monday: 1, จันทร์: 1, จ: 1,
  tue: 2, tues: 2, tuesday: 2, อังคาร: 2, อ: 2,
  wed: 3, weds: 3, wednesday: 3, พุธ: 3, พ: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, พฤหัส: 4, พฤหัสบดี: 4, พฤ: 4,
  fri: 5, friday: 5, ศุกร์: 5, ศ: 5,
  sat: 6, saturday: 6, เสาร์: 6, ส: 6,
};

/** Parse a loose weekday token → 0..6, or null when unrecognized. Pure. */
export function parseWeekday(token: string | null | undefined): number | null {
  if (!token) return null;
  const t = token.trim().toLowerCase();
  if (t in WEEKDAY_MAP) return WEEKDAY_MAP[t];
  // Substring fallback (e.g. "monday (จันทร์)") — first whole-key hit wins.
  for (const key of Object.keys(WEEKDAY_MAP)) {
    if (key.length >= 3 && t.includes(key)) return WEEKDAY_MAP[key];
  }
  return null;
}

/** Normalize a loose time token to "HH:MM" 24h, or null when invalid. Pure. */
export function normalizeHhmm(token: string | null | undefined): string | null {
  if (!token) return null;
  const m = token.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Normalize a validated extraction envelope into candidate staging items. Times
 * are normalized; an out-of-order pair (end ≤ start) drops the END so the review
 * card forces a fix rather than persisting a nonsense interval. Pure.
 */
export function normalizeExtractionToItems(
  extraction: ScheduleExtraction,
): CreateScheduleImportItemInput[] {
  return extraction.classes.map((c) => {
    const start = normalizeHhmm(c.start);
    let end = normalizeHhmm(c.end);
    if (start && end && end <= start) end = null;
    return {
      subject: c.subject.trim().slice(0, 200),
      weekday: parseWeekday(c.day),
      start_local: start,
      end_local: end,
      location: c.location ? c.location.trim().slice(0, 200) : null,
    };
  });
}

export interface ScheduleExtractionDeps {
  /** Text-source invoker (Gemini text by default). */
  textInvoke?: ClaudeInvoker;
  /** Vision invoker (Gemini vision by default). */
  visionInvoke?: GeminiVisionInvoker;
}

export interface ScheduleExtractionResult {
  extraction: ScheduleExtraction;
  items: CreateScheduleImportItemInput[];
}

/**
 * Run extraction over a file source. Throws the underlying provider error
 * (Gemini/Claude) on failure and a plain Error on invalid model output; the route
 * maps both to a clean response. Never writes anything.
 */
export async function runScheduleExtraction(
  source: ExtractedSource,
  deps: ScheduleExtractionDeps = {},
): Promise<ScheduleExtractionResult> {
  const textInvoke = deps.textInvoke ?? realGeminiInvoker;
  const visionInvoke = deps.visionInvoke ?? geminiVisionExtract;

  const raw =
    source.mode === "text"
      ? await textInvoke(`${EXTRACTION_PROMPT}\n\nTIMETABLE TEXT:\n${source.text}`)
      : await visionInvoke(EXTRACTION_PROMPT, source.parts);

  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJsonOutput(raw));
  } catch {
    throw new Error("extractor returned non-JSON output");
  }
  const check = scheduleExtractionSchema.safeParse(parsed);
  if (!check.success) {
    throw new Error(
      `extractor output failed validation: ${check.error.issues[0]?.message ?? "invalid"}`,
    );
  }
  return {
    extraction: check.data,
    items: normalizeExtractionToItems(check.data),
  };
}
