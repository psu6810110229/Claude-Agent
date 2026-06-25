import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { UPLOAD_DIR, UPLOAD_TTL_HOURS } from "../config.js";

/**
 * Upload store — opaque, gitignored local file staging for the schedule import.
 *
 * Security boundaries:
 * - Files are named by a server-generated UUID; the client's original filename is
 *   NEVER used on disk (no traversal, no name-based collisions/overwrites).
 * - Every id is validated against a strict UUID pattern before being joined to a
 *   path, and the resolved path is asserted to stay inside UPLOAD_DIR — defense in
 *   depth against traversal even if the pattern ever loosens.
 * - Files are purged after the import resolves (caller) or after a TTL sweep.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ensureDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

/** Resolve an id to its absolute path, or null if the id is malformed/escapes. */
export function uploadPath(id: string): string | null {
  if (!UUID_RE.test(id)) return null;
  const p = path.join(UPLOAD_DIR, id);
  const resolved = path.resolve(p);
  // Must stay strictly inside UPLOAD_DIR.
  if (resolved !== path.resolve(UPLOAD_DIR, id)) return null;
  if (path.dirname(resolved) !== path.resolve(UPLOAD_DIR)) return null;
  return resolved;
}

/** Persist bytes under a fresh UUID; returns the id. */
export function saveUpload(buf: Buffer): string {
  ensureDir();
  const id = randomUUID();
  fs.writeFileSync(path.join(UPLOAD_DIR, id), buf);
  return id;
}

/** Read an upload by id, or null if missing/invalid. */
export function readUpload(id: string): Buffer | null {
  const p = uploadPath(id);
  if (!p) return null;
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

/** Delete an upload by id (no-op if absent/invalid). */
export function deleteUpload(id: string): void {
  const p = uploadPath(id);
  if (!p) return;
  try {
    fs.rmSync(p, { force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * Sweep expired uploads (older than the TTL). Best-effort; called opportunistically
 * on each new upload so the directory cannot grow unbounded. Returns the count
 * purged. Never throws.
 */
export function purgeExpiredUploads(): number {
  const ttlMs = UPLOAD_TTL_HOURS * 60 * 60 * 1000;
  const cutoff = Date.now() - ttlMs;
  let purged = 0;
  try {
    if (!fs.existsSync(UPLOAD_DIR)) return 0;
    for (const name of fs.readdirSync(UPLOAD_DIR)) {
      if (!UUID_RE.test(name)) continue;
      const fp = path.join(UPLOAD_DIR, name);
      try {
        if (fs.statSync(fp).mtimeMs < cutoff) {
          fs.rmSync(fp, { force: true });
          purged++;
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* best-effort */
  }
  return purged;
}
