"use client";

import { useState, useRef, useCallback } from "react";
import useSWR from "swr";
import { getDriveFiles, getDriveFileContent, uploadToDrive } from "@/lib/api";
import { Loading, Empty, ErrorBanner } from "@/components/States";
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
      // strip "data:<mime>;base64," prefix
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// ---- sub-components ---------------------------------------------------------

function ContentModal({
  fileId,
  fileName,
  onClose,
}: {
  fileId: string;
  fileName: string;
  onClose: () => void;
}) {
  const { data, error, isLoading } = useSWR(
    `/api/drive/files/${fileId}/content`,
    () => getDriveFileContent(fileId),
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--surface-1)",
          borderRadius: 12,
          padding: 24,
          maxWidth: 680,
          width: "100%",
          maxHeight: "80vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{fileName}</span>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: 18,
              color: "var(--text-3)",
            }}
          >
            ✕
          </button>
        </div>
        <div
          style={{
            flex: 1,
            overflow: "auto",
            fontSize: 12,
            color: "var(--text-2)",
            whiteSpace: "pre-wrap",
            fontFamily: "monospace",
            background: "var(--surface-2)",
            borderRadius: 8,
            padding: 12,
            minHeight: 200,
          }}
        >
          {isLoading && "กำลังโหลด..."}
          {error && `ไม่สามารถอ่านไฟล์ได้: ${(error as Error).message}`}
          {data && !data.available && (data.message ?? "ไม่สามารถอ่านไฟล์นี้ได้")}
          {data?.available && data.content}
        </div>
        {data?.truncated && (
          <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>
            ⚠️ เนื้อหาถูกตัดให้สั้นลงเพราะไฟล์ใหญ่เกินขีดจำกัด
          </p>
        )}
      </div>
    </div>
  );
}

function FileRow({
  file,
  onRead,
}: {
  file: DriveFile;
  onRead: (file: DriveFile) => void;
}) {
  const readable = isReadable(file.mimeType);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: "6px 12px",
        padding: "10px 0",
        borderBottom: "1px solid var(--surface-2)",
        alignItems: "center",
      }}
    >
      <span style={{ fontSize: 18 }}>{mimeIcon(file.mimeType)}</span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-1)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {file.name}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
          {file.owners?.[0]?.displayName ?? ""}{" "}
          {file.modifiedTime ? `· ${formatDate(file.modifiedTime)}` : ""}
          {file.size ? ` · ${Math.round(Number(file.size) / 1024)} KB` : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {readable && (
          <button
            onClick={() => onRead(file)}
            style={{
              fontSize: 11,
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid var(--surface-3)",
              background: "none",
              cursor: "pointer",
              color: "var(--text-2)",
            }}
          >
            อ่าน
          </button>
        )}
        {file.webViewLink && (
          <a
            href={file.webViewLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 11,
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid var(--surface-3)",
              background: "none",
              cursor: "pointer",
              color: "var(--text-2)",
              textDecoration: "none",
              display: "inline-block",
            }}
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
    <div style={{ marginTop: 24 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 10 }}>
        อัปโหลดไฟล์
      </p>
      <div
        ref={dropRef}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !pending && inputRef.current?.click()}
        style={{
          border: "2px dashed var(--surface-3)",
          borderRadius: 10,
          padding: "20px 16px",
          textAlign: "center",
          cursor: pending ? "default" : "pointer",
          color: "var(--text-3)",
          fontSize: 13,
          transition: "border-color 0.15s",
        }}
      >
        {pending ? (
          <div style={{ color: "var(--text-1)" }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{pending.name}</div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>
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
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            onClick={confirmUpload}
            style={{
              flex: 1,
              padding: "8px 0",
              borderRadius: 8,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            ยืนยันอัปโหลด
          </button>
          <button
            onClick={() => setPending(null)}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--surface-3)",
              background: "none",
              cursor: "pointer",
              fontSize: 13,
              color: "var(--text-2)",
            }}
          >
            ยกเลิก
          </button>
        </div>
      )}

      {status === "uploading" && (
        <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 8 }}>กำลังอัปโหลด...</p>
      )}

      {status === "done" && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-2)" }}>
          ✅ {message}
          {driveLink && (
            <>
              {" "}
              <a
                href={driveLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent)" }}
              >
                เปิดใน Drive ↗
              </a>
            </>
          )}
          <button
            onClick={() => { setStatus("idle"); setMessage(""); setDriveLink(null); }}
            style={{
              marginLeft: 10,
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 6,
              border: "1px solid var(--surface-3)",
              background: "none",
              cursor: "pointer",
              color: "var(--text-3)",
            }}
          >
            อัปโหลดอีก
          </button>
        </div>
      )}

      {status === "error" && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--error, #e55)" }}>
          ⚠️ {message}
          <button
            onClick={() => { setStatus("idle"); setMessage(""); }}
            style={{
              marginLeft: 10,
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 6,
              border: "1px solid var(--surface-3)",
              background: "none",
              cursor: "pointer",
              color: "var(--text-3)",
            }}
          >
            ลองใหม่
          </button>
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
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Google Drive</h1>
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
    <div>
      {readingFile && (
        <ContentModal
          fileId={readingFile.id}
          fileName={readingFile.name}
          onClose={() => setReadingFile(null)}
        />
      )}

      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Google Drive</h1>
      <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 16 }}>
        ค้นหาและอ่านไฟล์ · อัปโหลดผ่านหน้านี้ · ดาวน์โหลดผ่าน Drive โดยตรง
      </p>

      {/* Search bar */}
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาไฟล์... (ชื่อ, เนื้อหา, หรือชื่อคนที่แชร์)"
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--surface-3)",
            background: "var(--surface-1)",
            color: "var(--text-1)",
            fontSize: 13,
          }}
        />
        <button
          type="submit"
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ค้นหา
        </button>
        {submitted && (
          <button
            type="button"
            onClick={() => { setQuery(""); setSubmitted(""); }}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--surface-3)",
              background: "none",
              cursor: "pointer",
              fontSize: 13,
              color: "var(--text-3)",
            }}
          >
            ล้าง
          </button>
        )}
      </form>

      {/* File list */}
      {!data || data.files.length === 0 ? (
        <Empty label={submitted ? `ไม่พบไฟล์สำหรับ "${submitted}"` : "ยังไม่มีไฟล์"} />
      ) : (
        <div>
          {data.files.map((file) => (
            <FileRow key={file.id} file={file} onRead={setReadingFile} />
          ))}
        </div>
      )}

      {/* Upload */}
      <UploadPanel />
    </div>
  );
}
