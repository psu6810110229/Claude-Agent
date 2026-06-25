import { PDF_MAX_PAGES } from "../config.js";
import type { VisionPart } from "./geminiClient.js";

/**
 * File extractor — turns an uploaded image/PDF into the source the schedule
 * extractor reasons over, with a HYBRID strategy:
 *   - PDF with a real text layer  → extract text locally (no bytes leave the box).
 *   - Scanned PDF / image         → send the bytes to Gemini vision.
 *
 * Security: file kind is decided by MAGIC BYTES (sniffFileKind), never by the
 * client-declared name/MIME alone, so a mislabelled or hostile upload cannot slip
 * through the allowlist.
 */

export type FileKind = "image/png" | "image/jpeg" | "application/pdf";

/** Minimum extracted PDF text length to treat a PDF as text (else: scanned). */
const MIN_PDF_TEXT_CHARS = 40;

/**
 * Sniff the file kind from its leading magic bytes. Returns null when the buffer
 * is not one of the allowed kinds — the caller rejects it. Allowlist: PNG, JPEG,
 * PDF.
 */
export function sniffFileKind(buf: Buffer): FileKind | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return "application/pdf"; // "%PDF"
  }
  return null;
}

/** A coarse kind tag stored on the import session. */
export function sourceKindOf(kind: FileKind): "image" | "pdf" {
  return kind === "application/pdf" ? "pdf" : "image";
}

export type ExtractedSource =
  | { mode: "text"; text: string }
  | { mode: "vision"; parts: VisionPart[] };

/**
 * Extract the schedule source from an uploaded file buffer. PDF text-layer is
 * tried first; an empty/near-empty layer (scanned) falls back to vision over the
 * PDF bytes. Images always go to vision. Pure apart from the optional pdf-parse
 * load (dynamic import avoids that library's load-time debug harness under ESM).
 */
export async function extractScheduleSource(
  kind: FileKind,
  buf: Buffer,
): Promise<ExtractedSource> {
  if (kind === "application/pdf") {
    const text = await tryPdfText(buf);
    if (text && text.trim().length >= MIN_PDF_TEXT_CHARS) {
      return { mode: "text", text: text.trim() };
    }
    // Scanned PDF → vision over the raw PDF (Gemini accepts application/pdf).
    return {
      mode: "vision",
      parts: [{ data: buf.toString("base64"), mimeType: "application/pdf" }],
    };
  }
  // Image → vision.
  return {
    mode: "vision",
    parts: [{ data: buf.toString("base64"), mimeType: kind }],
  };
}

/** Extract a PDF's text layer; returns "" on any parse failure (fail soft → vision). */
async function tryPdfText(buf: Buffer): Promise<string> {
  try {
    // Import the inner module directly: the package's index runs a debug routine
    // that reads a bundled sample file when it thinks it is the main module, which
    // throws under ESM/tsx. The inner module has no such side effect. A non-literal
    // specifier keeps TS from demanding types for the untyped subpath.
    const modName = "pdf-parse/lib/pdf-parse.js";
    const mod = (await import(modName)) as {
      default?: (b: Buffer, opts?: { max?: number }) => Promise<{ text: string }>;
    } & ((b: Buffer, opts?: { max?: number }) => Promise<{ text: string }>);
    const pdfParse = mod.default ?? mod;
    const result = await pdfParse(buf, { max: PDF_MAX_PAGES });
    return result.text ?? "";
  } catch {
    return "";
  }
}
