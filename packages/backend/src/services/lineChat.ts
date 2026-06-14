import fs from "node:fs";
import path from "node:path";
import {
  LINE_EXPORT_DIR,
  LINE_MAX_RESULTS,
  LINE_ENABLED,
  BANGKOK_OFFSET_MS,
} from "../config.js";
import { getConfigBool } from "../db/repositories/configRepo.js";
import type { LineMessage, LineChatSummary } from "../schemas/lineChat.js";

/**
 * LINE connector (Step 20) — READ-ONLY local export ingest.
 *
 * Why not the live DB: LINE for Windows stores chats in an ENCRYPTED, locked
 * `.edb` SQLite file (magic bytes replaced; better-sqlite3 → "unable to open
 * database file"). Reading it live is impossible without reverse-engineering the
 * key, which is fragile and out of scope. So we parse LINE's own chat-export
 * `.txt` files instead.
 *
 * Export format (LINE for Windows v26):
 *   2025.12.04 Thursday          <- date header: YYYY.MM.DD Weekday
 *   11:34 P'SARA ข้อความ          <- HH:mm <sender> <message>  (single-space delimited)
 *   sara@example.com             <- continuation line(s) of the message above
 *
 * Parsing challenge: the delimiter is a single space, and display names may
 * contain spaces ("Thanphisit 207", "สมิตา ꕤ."), so first-token splitting is
 * wrong. We use a REGISTRY-BASED split: pass 1 harvests reliable sender names
 * from media/system lines (where the sender is the prefix before a fixed
 * English suffix like " Photos" / " unsent a message."), then pass 2 splits
 * each message by longest known-sender prefix, falling back to first-token.
 *
 * SAFETY: fail-closed (disabled / missing dir / IO error → throw LineError;
 * callers degrade to available:false). Message text is NEVER logged.
 */

export type LineFailureReason = "disabled" | "config" | "io";

export class LineError extends Error {
  constructor(
    public readonly reason: LineFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "LineError";
  }
}

/** Whether the LINE connector is enabled. DB config overrides the env-var. */
export function isLineEnabled(): boolean {
  const dbValue = getConfigBool("line_enabled");
  if (dbValue !== null) return dbValue;
  return LINE_ENABLED;
}

const DATE_RE = /^(\d{4})\.(\d{2})\.(\d{2})\b/;
const MSG_RE = /^(\d{2}):(\d{2}) (.*)$/;

/** Fixed trailing tokens that mark a media line; the sender precedes them. */
const MEDIA_SUFFIXES = [
  "Photos",
  "Videos",
  "Stickers",
  "Photo",
  "Video",
  "Sticker",
  "Voice message",
  "Files",
  "File",
  "Location",
  "Contact",
];

/** Suffixes that mark a system line whose sender is the leading name. */
const SYSTEM_NAME_SUFFIXES = [" unsent a message."];

/** Whole-line system notices that carry NO sender. */
const SENDERLESS_SYSTEM = new Set(["Message unsent."]);

/** Substrings that mark a line as a LINE system notice (for the `system` flag). */
const SYSTEM_MARKERS = [
  "joined the group.",
  "left the group.",
  " added ",
  " removed ",
  "unsent a message.",
  "Message unsent.",
  "Group voice call started.",
  "Group call ended.",
  "Group video call started.",
  " created.", // Album "x" created.
];

interface RawEntry {
  y: string;
  mo: string;
  d: string;
  hh: string;
  mm: string;
  /** Full remainder after "HH:mm " — may span multiple lines (continuations). */
  remainder: string;
}

/** Pass 0: split text into timestamped entries, attaching continuation lines. */
function parseEntries(text: string): RawEntry[] {
  const lines = text.split(/\r?\n/);
  const entries: RawEntry[] = [];
  let curDate: { y: string; mo: string; d: string } | null = null;
  let cur: RawEntry | null = null;
  const flush = () => {
    if (cur) {
      // Drop trailing blank/continuation lines (file-end newline artifact);
      // internal blank lines inside a multiline message are preserved.
      cur.remainder = cur.remainder.replace(/\s+$/u, "");
      entries.push(cur);
      cur = null;
    }
  };
  for (const line of lines) {
    const dm = DATE_RE.exec(line);
    if (dm) {
      flush();
      curDate = { y: dm[1], mo: dm[2], d: dm[3] };
      continue;
    }
    const msg = MSG_RE.exec(line);
    if (msg && curDate) {
      flush();
      cur = {
        y: curDate.y,
        mo: curDate.mo,
        d: curDate.d,
        hh: msg[1],
        mm: msg[2],
        remainder: msg[3],
      };
      continue;
    }
    // Continuation line (including blank lines inside a multiline message).
    if (cur) cur.remainder += "\n" + line;
  }
  flush();
  return entries;
}

/** Pass 1: harvest reliable sender names from media / "unsent" lines. */
function collectSenders(entries: RawEntry[]): Set<string> {
  const senders = new Set<string>();
  for (const e of entries) {
    // Multiline remainders are real text, never single media lines — skip.
    if (e.remainder.includes("\n")) continue;
    const r = e.remainder;
    for (const suf of MEDIA_SUFFIXES) {
      const tail = " " + suf;
      if (r.endsWith(tail) && r.length > tail.length) {
        senders.add(r.slice(0, r.length - tail.length).trim());
      }
    }
    for (const suf of SYSTEM_NAME_SUFFIXES) {
      if (r.endsWith(suf) && r.length > suf.length) {
        senders.add(r.slice(0, r.length - suf.length).trim());
      }
    }
  }
  senders.delete("");
  return senders;
}

function isSystemText(firstLine: string): boolean {
  return SYSTEM_MARKERS.some((m) => firstLine.includes(m));
}

/** Pass 2: split a remainder into sender + text using the sender registry. */
function splitSenderMessage(
  remainder: string,
  senders: Set<string>,
): { sender: string | null; text: string; system: boolean } {
  const firstLine = remainder.split("\n", 1)[0];
  if (SENDERLESS_SYSTEM.has(firstLine.trim())) {
    return { sender: null, text: remainder, system: true };
  }
  // Longest known-sender prefix wins (handles names containing spaces).
  let best = "";
  for (const s of senders) {
    if (s.length <= best.length) continue;
    if (
      remainder === s ||
      remainder.startsWith(s + " ") ||
      remainder.startsWith(s + "\n")
    ) {
      best = s;
    }
  }
  if (best) {
    const rest = remainder.slice(best.length).replace(/^[ \n]/, "");
    return { sender: best, text: rest, system: isSystemText(firstLine) };
  }
  // Fallback: first whitespace-delimited token is the sender (best effort).
  const idx = remainder.indexOf(" ");
  if (idx === -1) return { sender: remainder, text: "", system: false };
  return {
    sender: remainder.slice(0, idx),
    text: remainder.slice(idx + 1),
    system: isSystemText(firstLine),
  };
}

/** Approximate UTC ISO instant for a Bangkok wall-clock date/time. */
function toUtcIso(e: RawEntry): string {
  const localAsUtcMs = Date.UTC(
    Number(e.y),
    Number(e.mo) - 1,
    Number(e.d),
    Number(e.hh),
    Number(e.mm),
  );
  return new Date(localAsUtcMs - BANGKOK_OFFSET_MS).toISOString();
}

/** Parse a full LINE chat-export text into structured messages. Pure. */
export function parseLineExport(text: string): LineMessage[] {
  const entries = parseEntries(text);
  const senders = collectSenders(entries);
  return entries.map((e) => {
    const { sender, text: msgText, system } = splitSenderMessage(
      e.remainder,
      senders,
    );
    return {
      date: `${e.y}-${e.mo}-${e.d}`,
      time: `${e.hh}:${e.mm}`,
      atUtc: toUtcIso(e),
      sender,
      text: msgText,
      system,
    };
  });
}

/** Derive a human chat name from an export filename. */
function chatNameFromFile(file: string): string {
  return file
    .replace(/\.txt$/i, "")
    .replace(/^\[LINE\]\s*/i, "")
    .trim();
}

interface CacheEntry {
  mtimeMs: number;
  messages: LineMessage[];
}
const parseCache = new Map<string, CacheEntry>();

/** List export .txt files (excluding the README helper). Throws LineError. */
function listExportFiles(): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(LINE_EXPORT_DIR);
  } catch {
    throw new LineError("io", "LINE export directory is not readable.");
  }
  return names.filter(
    (n) => n.toLowerCase().endsWith(".txt") && n.toLowerCase() !== "readme.txt",
  );
}

/** Parse one export file with an mtime-keyed cache (semi-live re-read). */
function readFileMessages(file: string): LineMessage[] {
  const full = path.join(LINE_EXPORT_DIR, file);
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(full).mtimeMs;
  } catch {
    throw new LineError("io", "LINE export file is not readable.");
  }
  const cached = parseCache.get(full);
  if (cached && cached.mtimeMs === mtimeMs) return cached.messages;
  let text: string;
  try {
    text = fs.readFileSync(full, "utf8");
  } catch {
    throw new LineError("io", "LINE export file is not readable.");
  }
  const messages = parseLineExport(text);
  parseCache.set(full, { mtimeMs, messages });
  return messages;
}

/** Summaries of all available LINE chats. Throws LineError when disabled/IO. */
export function listLineChats(): LineChatSummary[] {
  if (!isLineEnabled()) throw new LineError("disabled", "LINE is disabled.");
  const files = listExportFiles();
  return files.map((file) => {
    const messages = readFileMessages(file);
    const last = messages.length > 0 ? messages[messages.length - 1] : null;
    return {
      id: file,
      name: chatNameFromFile(file),
      messageCount: messages.length,
      lastMessageAt: last ? last.atUtc : null,
    };
  });
}

/** Most-recent `limit` messages for one chat (by export filename id). */
export function getLineMessages(
  chatId: string,
  limit: number = LINE_MAX_RESULTS,
): LineMessage[] {
  if (!isLineEnabled()) throw new LineError("disabled", "LINE is disabled.");
  // Guard against path traversal — chatId must be a plain filename we listed.
  const files = listExportFiles();
  if (!files.includes(chatId)) {
    throw new LineError("io", "Unknown LINE chat.");
  }
  const messages = readFileMessages(chatId);
  const n = Math.max(1, Math.min(limit, 500));
  return messages.slice(-n);
}

/**
 * Recent messages across ALL chats (newest first), tagged with chat name.
 * FAIL-SOFT: returns [] on disabled / any error — used in chat recall context
 * exactly like the Drive/Contacts context fetchers.
 */
export function getRecentLineMessages(
  limit: number,
): (LineMessage & { chat: string })[] {
  if (!isLineEnabled()) return [];
  try {
    const files = listExportFiles();
    const all: (LineMessage & { chat: string })[] = [];
    for (const file of files) {
      const name = chatNameFromFile(file);
      for (const m of readFileMessages(file)) all.push({ ...m, chat: name });
    }
    all.sort((a, b) => (a.atUtc < b.atUtc ? 1 : a.atUtc > b.atUtc ? -1 : 0));
    return all.slice(0, Math.max(0, limit));
  } catch {
    return [];
  }
}

/**
 * Part 1 — fail-soft chat summaries for recall context (so Jarvis always KNOWS
 * every chat that exists, not just the most active one). [] on disabled/error.
 */
export function getLineChatSummariesSafe(): LineChatSummary[] {
  if (!isLineEnabled()) return [];
  try {
    return listLineChats();
  } catch {
    return [];
  }
}

/**
 * Part 1 — recent messages grouped PER chat, for the `maxChats` most-recently-
 * active chats, `perChat` messages each (oldest→newest within a chat). Lets
 * Jarvis answer per-chat questions, not just the global newest. Fail-soft → [].
 */
export function getRecentLineByChatSafe(
  perChat: number,
  maxChats: number,
): { chat: string; messages: LineMessage[] }[] {
  if (!isLineEnabled()) return [];
  try {
    const groups = listExportFiles().map((file) => {
      const messages = readFileMessages(file);
      const last = messages.length > 0 ? messages[messages.length - 1].atUtc : "";
      return { name: chatNameFromFile(file), messages, last };
    });
    groups.sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
    return groups.slice(0, Math.max(0, maxChats)).map((g) => ({
      chat: g.name,
      messages: g.messages.slice(-Math.max(1, perChat)),
    }));
  } catch {
    return [];
  }
}
