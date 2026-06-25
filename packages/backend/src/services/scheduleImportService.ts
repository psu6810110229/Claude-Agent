import { readUpload, deleteUpload } from "./uploadStore.js";
import {
  sniffFileKind,
  sourceKindOf,
  extractScheduleSource,
} from "./fileExtractor.js";
import {
  runScheduleExtraction,
  type ScheduleExtractionDeps,
} from "./scheduleExtractor.js";
import {
  createScheduleImport,
  getScheduleImportById,
  listScheduleImportItems,
  setScheduleImportItemStatus,
  setScheduleImportStatus,
} from "../db/repositories/scheduleImportRepo.js";
import { createClassBlockDedup } from "../db/repositories/classBlockRepo.js";
import type {
  ScheduleImport,
  ScheduleImportItem,
} from "../schemas/scheduleImport.js";
import type { ClassBlock } from "../schemas/classBlock.js";

/**
 * Schedule import orchestration — keeps the routes thin and the business rules
 * testable without HTTP/multipart. Reading the upload, extracting, persisting the
 * staging buffer, and converting approved items into class_block rows all live
 * here.
 */

export class ScheduleImportError extends Error {
  constructor(
    public readonly code:
      | "upload-missing"
      | "unsupported-type"
      | "extract-failed"
      | "not-found"
      | "not-pending",
    message: string,
  ) {
    super(message);
    this.name = "ScheduleImportError";
  }
}

/**
 * Build a staging import from a previously uploaded file. Reads + sniffs the
 * bytes, extracts the source (text or vision), runs the schedule extractor, and
 * persists the candidate items. The upload is CONSUMED (deleted) on success — it
 * is never needed again once the structured items exist.
 */
export async function createImportFromUpload(
  uploadId: string,
  deps: ScheduleExtractionDeps = {},
): Promise<{ import: ScheduleImport; items: ScheduleImportItem[] }> {
  const buf = readUpload(uploadId);
  if (!buf) {
    throw new ScheduleImportError("upload-missing", "ไฟล์อัปโหลดหมดอายุหรือไม่พบ");
  }
  const kind = sniffFileKind(buf);
  if (!kind) {
    deleteUpload(uploadId);
    throw new ScheduleImportError("unsupported-type", "รองรับเฉพาะรูปภาพหรือ PDF");
  }

  const source = await extractScheduleSource(kind, buf);
  const result = await runScheduleExtraction(source, deps);

  const created = createScheduleImport(
    {
      source_kind: sourceKindOf(kind),
      term_from: result.extraction.term_from,
      term_until: result.extraction.term_until,
      note: result.extraction.note,
    },
    result.items,
  );

  deleteUpload(uploadId); // consumed — structured items now exist
  return created;
}

export interface ApproveResult {
  created: ClassBlock[];
  /** Items skipped because a required field (weekday/start/end) was missing. */
  skipped: ScheduleImportItem[];
  /** Items the user had deselected. */
  rejected: number;
}

/**
 * Approve a pending import: every SELECTED item with a complete (weekday + valid
 * start<end) shape becomes a class_block (deduped); incomplete selected items are
 * skipped (reported back so the UI can flag them); deselected items are rejected.
 * Term bounds (from the request, else the parsed term) apply to every block.
 */
export function approveImport(
  importId: number,
  term: { term_from: string | null; term_until: string | null },
): ApproveResult {
  const imp = getScheduleImportById(importId);
  if (!imp) throw new ScheduleImportError("not-found", "ไม่พบรายการนำเข้า");
  if (imp.status !== "pending") {
    throw new ScheduleImportError("not-pending", "รายการนี้ถูกดำเนินการไปแล้ว");
  }

  const activeFrom = term.term_from ?? imp.term_from;
  const activeUntil = term.term_until ?? imp.term_until;

  const created: ClassBlock[] = [];
  const skipped: ScheduleImportItem[] = [];
  let rejected = 0;

  for (const item of listScheduleImportItems(importId)) {
    if (item.selected !== 1) {
      setScheduleImportItemStatus(item.id, "rejected");
      rejected++;
      continue;
    }
    const complete =
      item.weekday !== null &&
      item.start_local !== null &&
      item.end_local !== null &&
      item.end_local > item.start_local;
    if (!complete) {
      skipped.push(item);
      continue; // leave as 'candidate' so the user can fix + re-approve
    }
    const { block } = createClassBlockDedup({
      subject: item.subject,
      weekday: item.weekday!,
      start_local: item.start_local!,
      end_local: item.end_local!,
      location: item.location,
      active_from: activeFrom,
      active_until: activeUntil,
      source: "import",
    });
    created.push(block);
    setScheduleImportItemStatus(item.id, "approved");
  }

  // Only finalize the session when nothing is left to fix.
  if (skipped.length === 0) {
    setScheduleImportStatus(importId, "approved");
  }
  return { created, skipped, rejected };
}
