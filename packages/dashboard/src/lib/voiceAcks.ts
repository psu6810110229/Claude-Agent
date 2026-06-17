/**
 * Step 23 — Responsive Voice State Machine.
 *
 * A client-side voice acknowledgement state machine for user-initiated chat
 * sends. It makes Friday feel responsive while a slow reply is in flight without
 * talking over the final answer.
 *
 * Lifecycle per send, with a CONTEXT-AWARE first delay:
 *   1. Small talk / presence / greeting (smalltalk): NO ack ever — wait for the
 *      final answer only.
 *   2. Data lookups (line/calendar/contacts/gmail/tasks/reminders/drive/memory)
 *      and multi-source briefs: ONE short ack after ~2.0s of silence.
 *   3. Generic non-data requests: ONE very short ack after ~3.0s (or none, if the
 *      answer lands first).
 *   4. Still waiting after ~7.5s: ONE different long-wait line, then silence
 *      (never repeats).
 *
 * Audio plays on a DEDICATED <audio> element, fully separate from the main TTS
 * queue in `api.ts` (`_audio`/`_ttsChain`). That isolation is what guarantees
 * buffering the final answer never clips a playing ack, and lets us cancel acks
 * independently of the real spoken reply.
 *
 * Everything fails soft: any TTS/audio failure degrades to silence; chat text is
 * never affected. No external packages, no overlap, deterministic phrasing.
 */

/** Default first-ack delay (data lookups). Per-context overrides in FIRST_DELAY_MS. */
export const FIRST_ACK_DELAY_MS = 2000;
/** Delay before the second (long-wait) acknowledgement. At most one of these per send. */
export const LONG_ACK_DELAY_MS = 7500;
/**
 * Minimum SILENT gap after the first ack's audio actually ENDS before the
 * long-wait ack may start. LONG_ACK_DELAY_MS is measured from send start, so
 * when the first ack finishes near that mark the long one would otherwise queue
 * up and play back-to-back. This guarantees a breath between them regardless of
 * how long the first ack ran or how slow its fetch was.
 */
export const LONG_ACK_MIN_GAP_MS = 2500;

export type AckContext =
  | "line"
  | "calendar"
  | "contacts"
  | "gmail"
  | "tasks"
  | "reminders"
  | "drive"
  | "memory"
  | "brief"
  | "generic"
  | "smalltalk";
export type AckPhase = "first" | "long";

/**
 * Per-context first-ack delay (ms). Data lookups + briefs ack early (~2s);
 * generic non-data waits longer (~3s) so simple replies usually beat the ack.
 * `smalltalk` never acks (handled in startAck, before any timer is scheduled).
 */
const FIRST_DELAY_MS: Record<AckContext, number> = {
  line: 2000,
  calendar: 2000,
  contacts: 2000,
  gmail: 2000,
  tasks: 2000,
  reminders: 2000,
  drive: 2000,
  memory: 2000,
  brief: 2000,
  generic: 3000,
  smalltalk: 0, // unused; smalltalk is suppressed before scheduling
};

/**
 * First-acknowledgement phrase POOLS per context. Several non-repeating options
 * each so Friday does not always say the same line. Feminine polite particles
 * (คะ/ค่ะ) preserved; no "ครับ". No follow-up question (Friday prompt rules).
 * Generic uses VERY short lines only (no long data-work phrasing). `smalltalk`
 * is empty — it never reaches phrase selection.
 */
const FIRST_POOLS: Record<AckContext, string[]> = {
  line: [
    "แป๊บนะคะ กำลังเช็กจาก export ล่าสุดให้ค่ะ",
    "เดี๋ยวดูในไลน์ให้ค่ะ",
    "ขอเปิดดู export ไลน์ให้ก่อนค่ะ",
    "เดี๋ยวฟรายเดย์ดูให้ค่ะ",
  ],
  calendar: [
    "เดี๋ยวดูตารางให้ค่ะ",
    "ขอเช็กปฏิทินให้ก่อนค่ะ",
    "เดี๋ยวฟรายเดย์ดูให้ค่ะ",
  ],
  contacts: [
    "เดี๋ยวดูรายชื่อให้ค่ะ",
    "ขอค้นรายชื่อให้ก่อนค่ะ",
    "เดี๋ยวฟรายเดย์ดูให้ค่ะ",
  ],
  gmail: [
    "เดี๋ยวเช็กอีเมลให้ค่ะ",
    "ขอเปิดดูเมลให้ก่อนค่ะ",
    "เดี๋ยวฟรายเดย์ดูให้ค่ะ",
  ],
  tasks: [
    "เดี๋ยวดูงานที่ค้างให้ค่ะ",
    "ขอเช็กรายการงานให้ก่อนค่ะ",
    "เดี๋ยวฟรายเดย์ดูให้ค่ะ",
  ],
  reminders: [
    "เดี๋ยวดูรายการเตือนให้ค่ะ",
    "ขอเช็กตัวเตือนให้ก่อนค่ะ",
    "เดี๋ยวฟรายเดย์ดูให้ค่ะ",
  ],
  drive: [
    "เดี๋ยวค้นไฟล์ใน Drive ให้ค่ะ",
    "ขอเปิดดูไฟล์ให้ก่อนค่ะ",
    "เดี๋ยวฟรายเดย์ดูให้ค่ะ",
  ],
  memory: [
    "เดี๋ยวเปิดดูข้อมูลที่จำไว้ให้ค่ะ",
    "ขอไล่ดูบันทึกความจำให้ก่อนค่ะ",
    "เดี๋ยวฟรายเดย์ดูให้ค่ะ",
  ],
  brief: [
    "เดี๋ยวรวบรวมสรุปให้ค่ะ",
    "ขอเรียบเรียงข้อมูลให้สักครู่ค่ะ",
    "เดี๋ยวฟรายเดย์ดูให้ค่ะ",
  ],
  // Generic: very short only. No long "กำลังรวบรวมข้อมูล…" data phrasing here.
  generic: [
    "ได้ค่ะ",
    "รอแป๊บค่ะ",
    "สักครู่ค่ะ",
  ],
  smalltalk: [],
};

/** Long-wait phrases (shared pool). Soft "still on it"; disjoint from generic. */
const LONG_PHRASES = [
  "สักครู่นะคะ",
  "แป๊ปนึงนะคะ",
  "ขอเวลาอีกสักครู่ค่ะ",
  "ใกล้เสร็จแล้วค่ะ",
];

// Classification keyword sets. Checked in priority order (more specific first):
// line → gmail → contacts → reminders → calendar → tasks → drive → memory →
// brief → smalltalk → generic. Matched against the raw message (case-insensitive;
// the `i` flag leaves Thai untouched).
const LINE_PATTERNS = /(line|ไลน์|แชท|แชต|export)/i;
const GMAIL_PATTERNS = /(gmail|e-?mail|inbox|เมล|อีเมล|จดหมาย|กล่องจดหมาย)/i;
const CONTACTS_PATTERNS = /(contact|รายชื่อ|เบอร์|ติดต่อ|โทรศัพท์|สมุดติดต่อ)/i;
const REMINDERS_PATTERNS = /(reminder|เตือน|แจ้งเตือน|ตัวเตือน)/i;
const CALENDAR_PATTERNS =
  /(calendar|schedule|event|meeting|appointment|ตาราง|นัด|ปฏิทิน|ประชุม|กำหนดการ)/i;
const TASKS_PATTERNS = /(task|to-?do|งาน|รายการงาน|สิ่งที่ต้องทำ)/i;
const DRIVE_PATTERNS = /(drive|ไฟล์|file|เอกสาร|document|โฟลเดอร์|folder)/i;
const MEMORY_PATTERNS = /(memory|preference|fact|จำ|ความจำ|บันทึก|ข้อมูลที่จำ)/i;
const BRIEF_PATTERNS = /(brief|สรุป|บรีฟ|ภาพรวม|รายงาน)/i;

// Small talk / presence / greeting / thanks. Anchored to the WHOLE message (after
// an optional leading "Friday"/"ฟรายเดย์" address + trailing particles/punctuation)
// so it only fires on pure social turns — never on a data request that happens to
// open with a greeting. Such turns get NO ack: wait for the final answer only.
const SMALLTALK_PATTERNS =
  /^(?:(?:ฟรายเดย์|friday)\s*)?(?:อยู่ไหม|อยู่รึเปล่า|อยู่ป่าว|ว่าไง|ว่าไงคะ|สวัสดี|หวัดดี|ดีค่ะ|ดีจ้า|โอเค|โอเคค่ะ|โอเคนะ|โอเคค้ะ|okay|ok|ขอบคุณ(?:มาก)?|ขอบใจ|thanks|thank\s*you|hi|hello|เฮ้|เฮ้ย)\s*[ค่ะคับครับคะนะจ้าๆฮะฮ่ะ!\.\?]*$/i;

/** Classify a chat message into an acknowledgement context. */
export function classifyAckContext(message: string): AckContext {
  if (LINE_PATTERNS.test(message)) return "line";
  if (GMAIL_PATTERNS.test(message)) return "gmail";
  if (CONTACTS_PATTERNS.test(message)) return "contacts";
  if (REMINDERS_PATTERNS.test(message)) return "reminders";
  if (CALENDAR_PATTERNS.test(message)) return "calendar";
  if (TASKS_PATTERNS.test(message)) return "tasks";
  if (DRIVE_PATTERNS.test(message)) return "drive";
  if (MEMORY_PATTERNS.test(message)) return "memory";
  if (BRIEF_PATTERNS.test(message)) return "brief";
  if (SMALLTALK_PATTERNS.test(message.trim())) return "smalltalk";
  return "generic";
}

/** Last phrase spoken across all sends, so we never repeat back-to-back. */
let lastSpoken: string | null = null;

/**
 * Pick a phrase from `pool`, avoiding `exclude` and the globally last-spoken line,
 * with a randomized index so the order is never fixed. Falls back gracefully when
 * exclusions would empty the pool.
 */
function pickVaried(pool: string[], exclude?: string | null): string {
  let list = pool.filter((p) => p !== exclude && p !== lastSpoken);
  if (list.length === 0) list = pool.filter((p) => p !== exclude);
  if (list.length === 0) list = pool;
  const choice = list[Math.floor(Math.random() * list.length)];
  lastSpoken = choice;
  return choice;
}

/**
 * Pick the phrase for a phase. Randomized and non-repeating (never the same as
 * the previous line or the just-spoken one). The long phrase is always different
 * from the first because the pools are disjoint.
 */
export function chooseAckPhrase(
  context: AckContext,
  phase: AckPhase,
  previousPhrase?: string,
): string {
  const pool = phase === "first" ? FIRST_POOLS[context] : LONG_PHRASES;
  return pickVaried(pool, previousPhrase);
}

/**
 * Phrases preloaded once on chat page load (deduped). Only the COMMON, always-
 * cheap-to-hit lines: generic first-acks + the long-wait pool. Context-specific
 * data phrases (line/calendar/…) are fetched on demand the first time they speak
 * (and then cached), so page load does not pay for every pool up front.
 */
const PRELOAD_PHRASES: string[] = [
  ...new Set([...FIRST_POOLS.generic, ...LONG_PHRASES]),
];

// --- Module-level playback state (browser memory only) --------------------

/** phrase -> object URL of its buffered audio Blob. Lives for the page session. */
const ackCache = new Map<string, string>();

/** Dedicated audio element, created lazily so this module is SSR-safe to import. */
let ackAudio: HTMLAudioElement | null = null;

/** Id of the send whose acks are currently allowed. Stale acks check against this. */
let activeRequestId = 0;
/** Gate for not-yet-started plays. Flipped off once the final answer settles. */
let acksAllowed = false;
/** First phrase actually spoken this send (so the long phrase can differ). */
let firstPhrase: string | null = null;
/** Resolves when the currently-playing ack ends; null when nothing is playing. */
let currentPlaying: Promise<void> | null = null;

let firstTimer: ReturnType<typeof setTimeout> | null = null;
let longTimer: ReturnType<typeof setTimeout> | null = null;

let requestCounter = 0;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Allocate a fresh per-send request id. Tie acks/cancellation to this value. */
export function nextAckRequestId(): number {
  return ++requestCounter;
}

function clearAckTimers(): void {
  if (firstTimer !== null) {
    clearTimeout(firstTimer);
    firstTimer = null;
  }
  if (longTimer !== null) {
    clearTimeout(longTimer);
    longTimer = null;
  }
}

function getAckAudio(): HTMLAudioElement {
  if (!ackAudio) ackAudio = new Audio();
  return ackAudio;
}

/** POST one phrase to /api/tts; returns an object URL, or null on disable/failure. */
async function fetchAckBlobUrl(text: string): Promise<string | null> {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    // 204 = TTS disabled/offline; non-2xx = failure → fail soft to silence.
    if (res.status === 204 || !res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/** Cached URL if preloaded, otherwise on-demand fetch (and cache it). */
async function getAudioUrl(phrase: string): Promise<string | null> {
  const cached = ackCache.get(phrase);
  if (cached) return cached;
  const url = await fetchAckBlobUrl(phrase);
  if (url) ackCache.set(phrase, url);
  return url;
}

/**
 * Preload every acknowledgement phrase on chat page load. Stores Blob URLs in
 * browser memory only. Fail-soft: a phrase that fails is simply fetched on
 * demand later.
 */
export async function preloadAckAudio(): Promise<void> {
  await Promise.all(
    PRELOAD_PHRASES.map(async (phrase) => {
      if (ackCache.has(phrase)) return;
      const url = await fetchAckBlobUrl(phrase);
      if (url) ackCache.set(phrase, url);
    }),
  );
}

/**
 * Play one acknowledgement phrase for `requestId`. Serializes behind any ack
 * already playing (so the long phrase never overlaps the first) and re-checks
 * staleness after every await, so a settled/cancelled send never speaks.
 */
async function playPhrase(
  requestId: number,
  phrase: string,
  minGapAfterPrevMs = 0,
): Promise<void> {
  // Queue behind a still-playing ack, then re-validate.
  const prev = currentPlaying;
  if (prev) {
    try {
      await prev;
    } catch {
      /* ignore */
    }
  }
  if (requestId !== activeRequestId || !acksAllowed) return;

  // Enforce a silent gap after the previous ack ENDED (long-wait phase only),
  // so the two acks never run back-to-back. Re-validate after the wait.
  if (minGapAfterPrevMs > 0) {
    await sleep(minGapAfterPrevMs);
    if (requestId !== activeRequestId || !acksAllowed) return;
  }

  const url = await getAudioUrl(phrase);
  if (!url) return; // TTS disabled/failed → silent
  if (requestId !== activeRequestId || !acksAllowed) return; // became stale while fetching

  const audio = getAckAudio();
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  currentPlaying = done;
  audio.onended = () => resolveDone();
  audio.onerror = () => resolveDone();
  audio.src = url;
  try {
    await audio.play();
  } catch {
    resolveDone();
  }
  // Safety net so a stuck element never wedges settleAckForFinal().
  const guard = setTimeout(resolveDone, 8000);
  await done;
  clearTimeout(guard);
  if (currentPlaying === done) currentPlaying = null;
}

/**
 * Begin the ack state machine for a user-initiated send. Cancels any prior
 * send's acks (timers + playing audio) first — this is the stale-request guard.
 * When `muted`, schedules nothing (text UI is unaffected either way).
 */
export function startAck(
  requestId: number,
  message: string,
  muted: boolean,
): void {
  clearAckTimers();
  if (ackAudio) ackAudio.pause(); // stop any prior send's ack
  activeRequestId = requestId;
  acksAllowed = true;
  currentPlaying = null;
  firstPhrase = null;

  if (muted) {
    acksAllowed = false;
    return;
  }

  const context = classifyAckContext(message);
  // Small talk / presence / greeting: never ack — wait for the final answer only.
  if (context === "smalltalk") {
    acksAllowed = false;
    return;
  }
  const firstDelay = FIRST_DELAY_MS[context] || FIRST_ACK_DELAY_MS;
  firstTimer = setTimeout(() => {
    if (requestId !== activeRequestId || !acksAllowed) return;
    const phrase = chooseAckPhrase(context, "first");
    firstPhrase = phrase;
    void playPhrase(requestId, phrase);
  }, firstDelay);
  longTimer = setTimeout(() => {
    if (requestId !== activeRequestId || !acksAllowed) return;
    const phrase = chooseAckPhrase(context, "long", firstPhrase ?? undefined);
    void playPhrase(requestId, phrase, LONG_ACK_MIN_GAP_MS);
  }, LONG_ACK_DELAY_MS);
}

/**
 * The final answer for `requestId` has arrived. Cancel any scheduled long-wait
 * ack, block any not-yet-started ack, and resolve once a currently-playing ack
 * finishes — so the real spoken reply is queued AFTER it, never overlapping.
 */
export async function settleAckForFinal(requestId: number): Promise<void> {
  if (requestId !== activeRequestId) return;
  clearAckTimers();
  acksAllowed = false;
  const playing = currentPlaying;
  if (playing) {
    try {
      await playing;
    } catch {
      /* ignore */
    }
  }
}

/**
 * Hard-cancel all acknowledgements: clear timers, block pending plays, and stop
 * any ack audio immediately. Used on send error or a brand-new send.
 */
export function cancelAck(): void {
  clearAckTimers();
  acksAllowed = false;
  activeRequestId = -1;
  if (ackAudio) {
    ackAudio.pause();
    try {
      ackAudio.src = "";
    } catch {
      /* ignore */
    }
  }
  currentPlaying = null;
}
