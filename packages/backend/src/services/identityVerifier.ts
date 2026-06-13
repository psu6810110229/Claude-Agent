/**
 * Step 15 — Owner identity verification (in-memory, no DB).
 *
 * Holds the per-session "verified" set and a per-session failed-attempt rate
 * limiter. State is module-level maps that reset on backend restart (by design:
 * verified lifetime is per dashboard session). Secrets (PIN, challenge answer)
 * are compared ONLY inside `verify` and are NEVER logged, persisted, or placed
 * into any prompt — callers log the outcome `reason`, never the values.
 *
 * SECURITY NOTE: this verifier is the soft lock. The HARD privacy boundary is
 * data redaction at context-build time (see chat.ts). Even if this gate were
 * bypassed, an unverified prompt never contains private data.
 */
import {
  OWNER_PIN,
  OWNER_SECRET_PHRASE,
  PRIVACY_GUARD_ENABLED,
  PRIVACY_GUARD_CONFIGURED,
  PRIVACY_VERIFY_MAX_ATTEMPTS,
  PRIVACY_VERIFY_LOCKOUT_MS,
  PRIVACY_VERIFY_IDLE_TIMEOUT_MS,
} from "../config.js";
import { getConfigString, setConfigString } from "../db/repositories/configRepo.js";

type VerifyReason = "ok" | "bad-credentials" | "locked" | "not-configured" | "disabled";
export interface VerifyOutcome {
  ok: boolean;
  reason: VerifyReason;
}

type VerifiedRec = { verifiedAt: number; lastActive: number };

/**
 * Per-session verified state. Held in memory for speed but ALSO persisted to the
 * `config` table (key below) so it survives a backend restart — without this, a
 * dev `tsx watch` reload (or any restart) wiped every verified session, so a
 * just-unlocked owner's very next message re-locked ("the replay has no
 * password" symptom). Only the opaque sessionId + timestamps are stored — NEVER
 * the PIN/phrase. The hard privacy boundary remains context redaction (chat.ts).
 */
const verified = new Map<string, VerifiedRec>();
const attempts = new Map<string, { count: number; lockedUntil: number }>();

const VERIFIED_CONFIG_KEY = "verified_sessions";
let hydrated = false;

/** Lazily load persisted verified sessions once per process (DB must be ready). */
function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = getConfigString(VERIFIED_CONFIG_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, VerifiedRec>;
    for (const [sid, rec] of Object.entries(obj)) {
      if (
        rec &&
        typeof rec.verifiedAt === "number" &&
        typeof rec.lastActive === "number"
      ) {
        verified.set(sid, rec);
      }
    }
  } catch {
    // Corrupt/absent persisted state is non-fatal: start from an empty map.
  }
}

/** Write the current verified map back to the config table (best-effort). */
function persist(): void {
  try {
    const obj: Record<string, VerifiedRec> = {};
    for (const [sid, rec] of verified) obj[sid] = rec;
    setConfigString(VERIFIED_CONFIG_KEY, JSON.stringify(obj));
  } catch {
    // Persistence is best-effort; in-memory state still works for this process.
  }
}

/** Guard active = flag on. (Configured-ness checked inside verify.) */
export function isGuardEnabled(): boolean {
  return PRIVACY_GUARD_ENABLED;
}

/** 
 * A session is verified only if the guard is on and the session was unlocked.
 * It also checks the idle timeout and auto-locks if inactive.
 */
export function isVerified(sessionId: string | undefined, touch = false): boolean {
  if (!PRIVACY_GUARD_ENABLED) return true; // guard off => everyone "verified"
  if (!sessionId) return false;
  ensureHydrated();

  const rec = verified.get(sessionId);
  if (!rec) return false;

  const now = Date.now();
  if (now - rec.lastActive > PRIVACY_VERIFY_IDLE_TIMEOUT_MS) {
    // Idle timeout exceeded
    verified.delete(sessionId);
    persist();
    return false;
  }

  if (touch) {
    rec.lastActive = now;
    persist();
  }
  return true;
}

/** Constant-ish-time equality (local single-user; avoids trivial early-exit oracle). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verify(sessionId: string, input: string): VerifyOutcome {
  if (!PRIVACY_GUARD_ENABLED) return { ok: false, reason: "disabled" };
  if (!PRIVACY_GUARD_CONFIGURED) return { ok: false, reason: "not-configured" };
  ensureHydrated();

  const now = Date.now();
  const rec = attempts.get(sessionId);
  if (rec && rec.lockedUntil > now) return { ok: false, reason: "locked" };

  const cleanInput = input.trim().toLowerCase();
  const pinOk = safeEqual(cleanInput, OWNER_PIN.trim().toLowerCase());
  
  let phraseOk = false;
  if (OWNER_SECRET_PHRASE) {
    const phrase = OWNER_SECRET_PHRASE.trim().toLowerCase();
    if (
      cleanInput === phrase ||
      cleanInput.startsWith(phrase) ||
      cleanInput.startsWith("จาวิส " + phrase) ||
      cleanInput.startsWith("จาวิส" + phrase)
    ) {
      phraseOk = true;
    }
  }

  // Succeed if matches PIN or matches Secret Phrase
  if (pinOk || phraseOk) {
    verified.set(sessionId, { verifiedAt: now, lastActive: now });
    persist();
    attempts.delete(sessionId);
    return { ok: true, reason: "ok" };
  }

  const count = (rec?.count ?? 0) + 1;
  const locked = count >= PRIVACY_VERIFY_MAX_ATTEMPTS;
  attempts.set(sessionId, {
    count: locked ? 0 : count,
    lockedUntil: locked ? now + PRIVACY_VERIFY_LOCKOUT_MS : 0,
  });
  return { ok: false, reason: locked ? "locked" : "bad-credentials" };
}

/** Drop a session's verified state (called on chat reset). */
export function clearVerified(sessionId: string | undefined): void {
  if (sessionId) {
    verified.delete(sessionId);
    persist();
  }
}

/** Test-only: wipe all in-memory state. */
export function __resetForTest(): void {
  verified.clear();
  attempts.clear();
  hydrated = false;
}
