import { readUpload } from "./uploadStore.js";
import {
  sniffFileKind,
  sourceKindOf,
  extractScheduleSource,
  type ExtractedSource,
} from "./fileExtractor.js";

/**
 * Chat attachment loading.
 *
 * A composer attachment is uploaded (POST /api/uploads) and then STAGED in the
 * UI until the user sends a message with it — the file rides along with that
 * chat turn (and every later turn in the conversation) by its opaque upload id.
 * Each turn re-reads + re-extracts the kept upload here so the chat path can
 * inject its content (text-layer inline, or image / scanned-PDF bytes to the
 * vision model). The upload is never consumed by chat — the TTL sweep cleans it
 * up. Turning a file into a class TIMETABLE is a SEPARATE, explicit action
 * (POST /api/schedule-imports), not something attachment chat does implicitly.
 */

/**
 * Max characters of a text-layer doc surfaced to the chat prompt. Sized to hold a
 * full multi-page syllabus / handout (≈14k chars) so the model never answers from
 * a truncated half of the document and then fabricates the missing part. Gemini's
 * context easily absorbs this; raise further only if real docs exceed it.
 */
export const ATTACHMENT_TEXT_CAP = 48000;

/** One attachment's content prepared for a chat turn. */
export interface ChatAttachment {
  id: string;
  /** Coarse kind for phrasing in the prompt. */
  kind: "image" | "pdf";
  source: ExtractedSource;
}

/**
 * Load a chat-doc attachment by id for a single chat turn: re-read the kept
 * upload, re-extract its source (text-layer or vision parts). Returns null when
 * the id is missing/expired or not a supported file — the caller just skips it
 * (a stale attachment must never break the chat turn). Text is capped.
 */
export async function loadChatAttachment(
  uploadId: string,
): Promise<ChatAttachment | null> {
  const buf = readUpload(uploadId);
  if (!buf) return null;
  const kind = sniffFileKind(buf);
  if (!kind) return null;
  const source = await extractScheduleSource(kind, buf);
  const capped: ExtractedSource =
    source.mode === "text"
      ? { mode: "text", text: source.text.slice(0, ATTACHMENT_TEXT_CAP) }
      : source;
  return { id: uploadId, kind: sourceKindOf(kind), source: capped };
}
