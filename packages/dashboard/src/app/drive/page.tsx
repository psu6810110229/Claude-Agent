"use client";

import { useState, useRef, useCallback } from "react";
import useSWR from "swr";
import { getDriveFiles, getDriveFileContent, uploadToDrive } from "@/lib/api";
import { Loading, Empty, ErrorBanner } from "@/components/States";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { DriveFile } from "@/lib/types";

// ---- helpers ----------------------------------------------------------------

function mimeIcon(mimeType: string): string {
  if (mimeType.includes("google-apps.document")) return "📄";
  if (mimeType.includes("google-apps.spreadsheet")) return "📊";
  if (mimeType.includes("google-apps.presentation")) return "📋";
  if (mimeType.includes("pdf")) return "📕";
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.startsWith("video/")) return "🎬";
  if (mimeType.startsWith("audio/")) return "🎵";
  if (mimeType.includes("zip") || mimeType.includes("compressed")) return "🗜️";
  if (mimeType.startsWith("text/")) return "📝";
  return "📁";
}

function isReadable(mimeType: string): boolean {
  return (
    mimeType.includes("google-apps.document") ||
    mimeType.includes("google-apps.spreadsheet") ||
    mimeType.includes("google-apps.presentation") ||
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml"
  );
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// ---- file content body (rendered inside Modal) ------------------------------

function FileContentBody({ fileId }: { fileId: string }) {
  const { data, error, isLoading } = useSWR(
    `/api/drive/files/${fileId}/content`,
    () => getDriveFileContent(fileId),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          fontSize: "var(--text-xs)",
          color: "var(--muted)",
          whiteSpace: "pre-wrap",
          fontFamily: "monospace",
          background: "var(--glass)",
          borderRadius: "var(--radius)",
          padding: "var(--space-3)",
          minHeight: 200,
        }}
      >
        {isLoading && "กำลังโหลด..."}
        {error && `ไม่สามารถอ่านไฟล์ได้: ${(error as Error).message}`}
        {data && !data.available && (data.message ?? "ไม่สามารถอ่านไฟล์นี้ได้")}
        {data?.available && data.content}
      </div>
      {data?.truncated && (
        <p style={{ fontSize: "var(--text-xs)", color: "var(--muted)", margin: 0 }}>
          ⚠️ เนื้อหาถูกตัดให้สั้นลงเพราะไฟล์ใหญ่เกินขีดจำกัด
        </p>
      )}
    </div>
  );
}

// ---- sub-components ---------------------------------------------------------

function FileRow({
  file,
  onRead,
}: {
  file: DriveFile;
  onRead: (file: DriveFile) => void;
}) {
  const readable = isReadable(file.mimeType);
  return (
    <div className="drive-file-row">
      <span style={{ fontSize: "var(--text-lg)" }}>{mimeIcon(file.mimeType)}</span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: 600,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {file.name}
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: "var(--space-1)" }}>
          {file.owners?.[0]?.displayName ?? ""}{" "}
          {file.modifiedTime ? `· ${formatDate(file.modifiedTime)}` : ""}
          {file.size ? ` · ${Math.round(Number(file.size) / 1024)} KB` : ""}
        </div>
      </div>
      <div className="drive-file-actions">
        {readable && (
          <Button size="sm" variant="ghost" onClick={() => onRead(file)}>
            อ่าน
          </Button>
        )}
        {file.webViewLink && (
          <a
            href={file.webViewLink}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: "none" }}
          >
            เปิด ↗
          </a>
        )}
      </div>
    </div>
  );
}

// ---- upload panel -----------------------------------------------------------

function UploadPanel() {
  const [pending, setPending] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [driveLink, setDriveLink] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const pickFile = (file: File) => {
    setPending(file);
    setStatus("idle");
    setMessage("");
    setDriveLink(null);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) pickFile(file);
  }, []);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) pickFile(file);
  };

  const confirmUpload = async () => {
    if (!pending) return;
    setStatus("uploading");
    try {
      const contentBase64 = await fileToBase64(pending);
      const result = await uploadToDrive({
        name: pending.name,
        mimeType: pending.type || "application/octet-stream",
        contentBase64,
      });
      if (result.available) {
        setStatus("done");
        setMessage(`อัปโหลด "${result.name}" สำเร็จ`);
        setDriveLink(result.webViewLink ?? null);
        setPending(null);
      } else {
        setStatus("error");
        setMessage(result.message ?? "อัปโหลดไม่สำเร็จ");
      }
    } catch {
      setStatus("error");
      setMessage("อัปโหลดไม่สำเร็จ ลองใหม่ได้ค่ะ");
    }
  };

  return (
    <div className="drive-upload">
      <p style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text)", marginBottom: "var(--space-2)" }}>
        อัปโหลดไฟล์
      </p>
      <div
        ref={dropRef}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !pending && inputRef.current?.click()}
        style={{
          border: "2px dashed var(--border-strong)",
          borderRadius: "var(--radius)",
          padding: "var(--space-5) var(--space-4)",
          textAlign: "center",
          cursor: pending ? "default" : "pointer",
          color: "var(--muted)",
          fontSize: "var(--text-sm)",
          transition: "border-color 0.15s",
        }}
      >
        {pending ? (
          <div style={{ color: "var(--text)" }}>
            <div style={{ fontWeight: 600, marginBottom: "var(--space-1)" }}>{pending.name}</div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>
              {Math.round(pending.size / 1024)} KB · {pending.type || "ไม่ทราบประเภท"}
            </div>
          </div>
        ) : (
          "ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์"
        )}
        <input
          ref={inputRef}
          type="file"
          style={{ display: "none" }}
          onChange={onInputChange}
        />
      </div>

      {pending && status === "idle" && (
        <div className="drive-upload-actions">
          <Button variant="primary" fullWidth onClick={confirmUpload}>
            ยืนยันอัปโหลด
          </Button>
          <Button variant="ghost" onClick={() => setPending(null)}>
            ยกเลิก
          </Button>
        </div>
      )}

      {status === "uploading" && (
        <p style={{ fontSize: "var(--text-xs)", color: "var(--muted)", marginTop: "var(--space-2)" }}>
          กำลังอัปโหลด...
        </p>
      )}

      {status === "done" && (
        <div className="drive-upload-result">
          ✅ {message}
          {driveLink && (
            <a
              href={driveLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent)" }}
            >
              เปิดใน Drive ↗
            </a>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setStatus("idle"); setMessage(""); setDriveLink(null); }}
          >
            อัปโหลดอีก
          </Button>
        </div>
      )}

      {status === "error" && (
        <div className="drive-upload-result error">
          ⚠️ {message}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setStatus("idle"); setMessage(""); }}
          >
            ลองใหม่
          </Button>
        </div>
      )}
    </div>
  );
}

// ---- main page --------------------------------------------------------------

export default function DrivePage() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [readingFile, setReadingFile] = useState<DriveFile | null>(null);

  const { data, error, isLoading } = useSWR(
    `/api/drive/files?q=${encodeURIComponent(submitted)}`,
    () => getDriveFiles(submitted),
    { refreshInterval: 0 },
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(query);
  };

  if (isLoading) return <Loading />;
  if (error) return <ErrorBanner message={(error as Error).message} />;

  if (data && !data.available) {
    return (
      <div>
        <h1 className="drive-title">Google Drive</h1>
        <Empty
          label={
            "Drive ยังไม่ได้เชื่อมต่อ — ตั้งค่า GOOGLE_DRIVE_ENABLED=1 " +
            "และรัน npm run google-auth เพื่อขอสิทธิ์"
          }
        />
      </div>
    );
  }

  return (
    <div className="drive-page">
      <Modal
        open={!!readingFile}
        onClose={() => setReadingFile(null)}
        size="md"
        title={readingFile?.name}
      >
        {readingFile && <FileContentBody fileId={readingFile.id} />}
      </Modal>

      <h1 className="drive-title">Google Drive</h1>
      <p className="drive-lede">
        ค้นหาและอ่านไฟล์ · อัปโหลดผ่านหน้านี้ · ดาวน์โหลดผ่าน Drive โดยตรง
      </p>

      <form onSubmit={handleSearch} className="drive-search">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาไฟล์... (ชื่อ, เนื้อหา, หรือชื่อคนที่แชร์)"
          className="field field-md"
          style={{ flex: 1 }}
        />
        <Button type="submit" variant="primary">ค้นหา</Button>
        {submitted && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => { setQuery(""); setSubmitted(""); }}
          >
            ล้าง
          </Button>
        )}
      </form>

      {!data || data.files.length === 0 ? (
        <Empty label={submitted ? `ไม่พบไฟล์สำหรับ "${submitted}"` : "ยังไม่มีไฟล์"} />
      ) : (
        <div>
          {data.files.map((file) => (
            <FileRow key={file.id} file={file} onRead={setReadingFile} />
          ))}
        </div>
      )}

      <UploadPanel />
    </div>
  );
}
