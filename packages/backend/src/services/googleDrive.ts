import { Readable } from "node:stream";
import { google } from "googleapis";
import {
  GOOGLE_DRIVE_ENABLED,
  GOOGLE_DRIVE_MAX_RESULTS,
  GOOGLE_DRIVE_CONTENT_MAX_CHARS,
} from "../config.js";
import { getConfigBool } from "../db/repositories/configRepo.js";
import { buildOAuthClient, GoogleCalendarError } from "./googleCalendar.js";
import type { DriveFile, DriveUploadBody } from "../schemas/googleDrive.js";

/**
 * Google Drive connector (Step 19).
 *
 * SAFETY BOUNDARIES:
 * - Reads (search, content) are fail-closed.
 * - Upload is a direct user-initiated action from the dashboard (user confirms
 *   in UI before sending) — no approval queue needed.
 * - FAILS CLOSED. Disabled flag, missing credentials, or any API error throw
 *   DriveError; callers degrade gracefully to available:false.
 * - NEVER LOGS SECRETS. Reuses the same OAuth client + credentials.
 * - Content reading is capped at GOOGLE_DRIVE_CONTENT_MAX_CHARS characters.
 *   Binary / unsupported file types return a DriveError("unsupported").
 */

export type DriveFailureReason =
  | "disabled"
  | "config"
  | "auth"
  | "api"
  | "unsupported"
  | "too_large";

export class DriveError extends Error {
  constructor(
    public readonly reason: DriveFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

/** Whether the Drive connector is enabled. DB config overrides env-var. */
export function isDriveEnabled(): boolean {
  const dbValue = getConfigBool("google_drive_enabled");
  if (dbValue !== null) return dbValue;
  return GOOGLE_DRIVE_ENABLED;
}

function buildDriveClient() {
  try {
    const auth = buildOAuthClient();
    return google.drive({ version: "v3", auth });
  } catch (err) {
    if (err instanceof GoogleCalendarError) {
      throw new DriveError("config", err.message);
    }
    throw new DriveError("config", "Failed to build Drive OAuth client.");
  }
}

/**
 * Google Workspace MIME types that can be exported as readable text.
 * Maps google-apps MIME → export target MIME.
 */
const GOOGLE_DOC_EXPORT: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

function isReadableTextMime(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml"
  );
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Search Drive files by keyword and/or sharedWith email.
 * When query is empty and no email, returns most recently modified files.
 */
export async function searchDriveFiles(
  query: string,
  sharedWithEmail?: string,
  limit?: number,
): Promise<DriveFile[]> {
  if (!isDriveEnabled()) {
    throw new DriveError("disabled", "Google Drive is not enabled.");
  }

  const drive = buildDriveClient();
  const pageSize = Math.min(limit ?? GOOGLE_DRIVE_MAX_RESULTS, 100);

  const parts: string[] = ["trashed = false"];
  const trimmed = query.trim();
  if (trimmed) {
    const escaped = escapeDriveQuery(trimmed);
    parts.push(
      `(name contains '${escaped}' or fullText contains '${escaped}')`,
    );
  }
  if (sharedWithEmail) {
    parts.push(`'${escapeDriveQuery(sharedWithEmail)}' in readers`);
  }

  const res = await drive.files.list({
    q: parts.join(" and "),
    pageSize,
    orderBy: "modifiedTime desc",
    fields: "files(id,name,mimeType,webViewLink,modifiedTime,owners,size)",
  });

  return (res.data.files ?? []).map((f) => ({
    id: f.id ?? "",
    name: f.name ?? "(unnamed)",
    mimeType: f.mimeType ?? "",
    webViewLink: f.webViewLink ?? undefined,
    modifiedTime: f.modifiedTime ?? undefined,
    owners: f.owners?.map((o) => ({ displayName: o.displayName ?? "" })),
    size: f.size ?? undefined,
  }));
}

/**
 * Read the text content of a Drive file.
 * - Google Docs/Sheets/Slides → exported as text/plain or text/csv.
 * - Plain text files → downloaded directly.
 * - Binary / unsupported types → throws DriveError("unsupported").
 * - Files over the char cap → content is truncated; `truncated: true`.
 */
export async function getDriveFileContent(fileId: string): Promise<{
  name: string;
  content: string;
  truncated: boolean;
}> {
  if (!isDriveEnabled()) {
    throw new DriveError("disabled", "Google Drive is not enabled.");
  }

  const drive = buildDriveClient();

  const meta = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,size",
  });
  const name = meta.data.name ?? "(unnamed)";
  const mimeType = meta.data.mimeType ?? "";

  // Google Workspace docs — export as text
  if (GOOGLE_DOC_EXPORT[mimeType]) {
    const exportMime = GOOGLE_DOC_EXPORT[mimeType];
    const res = await drive.files.export(
      { fileId, mimeType: exportMime },
      { responseType: "text" },
    );
    const raw = typeof res.data === "string" ? res.data : String(res.data);
    const truncated = raw.length > GOOGLE_DRIVE_CONTENT_MAX_CHARS;
    return { name, content: raw.slice(0, GOOGLE_DRIVE_CONTENT_MAX_CHARS), truncated };
  }

  // Plain text files — download directly
  if (isReadableTextMime(mimeType)) {
    const sizeStr = meta.data.size;
    const sizeBytes = sizeStr ? Number(sizeStr) : null;
    // Rough guard: 2 bytes/char upper bound
    if (sizeBytes !== null && sizeBytes > GOOGLE_DRIVE_CONTENT_MAX_CHARS * 2) {
      throw new DriveError(
        "too_large",
        `ไฟล์นี้ใหญ่เกินไป (${Math.round(sizeBytes / 1024)} KB) — เปิดดูใน Drive โดยตรงได้เลยค่ะ`,
      );
    }

    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "text" },
    );
    const raw = typeof res.data === "string" ? res.data : String(res.data);
    const truncated = raw.length > GOOGLE_DRIVE_CONTENT_MAX_CHARS;
    return { name, content: raw.slice(0, GOOGLE_DRIVE_CONTENT_MAX_CHARS), truncated };
  }

  throw new DriveError(
    "unsupported",
    `ไม่รองรับการอ่านไฟล์ประเภท ${mimeType} — เปิดดูใน Drive โดยตรงได้เลยค่ะ`,
  );
}

/**
 * Upload a file to Drive.
 * Content must be provided as base64-encoded string (from dashboard FileReader).
 * Returns the new file's id, name, and webViewLink.
 */
export async function uploadToDrive(body: DriveUploadBody): Promise<{
  id: string;
  name: string;
  webViewLink: string | null;
}> {
  if (!isDriveEnabled()) {
    throw new DriveError("disabled", "Google Drive is not enabled.");
  }

  const drive = buildDriveClient();

  const buffer = Buffer.from(body.contentBase64, "base64");
  const stream = Readable.from(buffer);

  const requestBody: { name: string; parents?: string[] } = { name: body.name };
  if (body.folderId) requestBody.parents = [body.folderId];

  const res = await drive.files.create({
    requestBody,
    media: { mimeType: body.mimeType, body: stream },
    fields: "id,name,webViewLink",
  });

  return {
    id: res.data.id ?? "",
    name: res.data.name ?? body.name,
    webViewLink: res.data.webViewLink ?? null,
  };
}

/**
 * Fetch recent Drive files (for chat context). Fails silently — returns []
 * on any error or when disabled.
 */
export async function getRecentDriveFiles(limit = 10): Promise<DriveFile[]> {
  if (!isDriveEnabled()) return [];
  try {
    const drive = buildDriveClient();
    const res = await drive.files.list({
      q: "trashed = false",
      pageSize: limit,
      orderBy: "modifiedTime desc",
      fields: "files(id,name,mimeType,webViewLink,modifiedTime)",
    });
    return (res.data.files ?? []).map((f) => ({
      id: f.id ?? "",
      name: f.name ?? "(unnamed)",
      mimeType: f.mimeType ?? "",
      webViewLink: f.webViewLink ?? undefined,
      modifiedTime: f.modifiedTime ?? undefined,
    }));
  } catch {
    return [];
  }
}
