"use client";

import useSWR from "swr";
import { getGmailUnread } from "@/lib/api";
import { Loading, Empty, ErrorBanner } from "@/components/States";
import type { GmailMessage } from "@/lib/types";

function formatFrom(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*<?[^>]*>?$/);
  return match ? match[1].trim() : from;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

function MessageRow({ msg }: { msg: GmailMessage }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: "4px 12px",
        padding: "12px 0",
        borderBottom: "1px solid var(--surface-2)",
        alignItems: "start",
      }}
    >
      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: msg.unread ? 700 : 400,
            color: "var(--text-1)",
            marginBottom: 2,
          }}
        >
          {formatFrom(msg.from)}
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: msg.unread ? 600 : 400,
            color: "var(--text-1)",
          }}
        >
          {msg.subject}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--text-3)",
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "480px",
          }}
        >
          {msg.snippet}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-3)", whiteSpace: "nowrap", paddingTop: 1 }}>
        {formatDate(msg.receivedAt)}
      </div>
    </div>
  );
}

export default function GmailPage() {
  const { data, error, isLoading } = useSWR("/api/gmail/unread", getGmailUnread, {
    refreshInterval: 5 * 60 * 1000,
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBanner message={(error as Error).message} />;
  if (!data) return <Loading />;

  if (!data.available) {
    return (
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Gmail</h1>
        <Empty
          label={
            "Gmail ยังไม่ได้เชื่อมต่อ — เปิดใช้งานโดยตั้งค่า GMAIL_ENABLED=1 " +
            "และรัน npm run google-auth เพื่อขอสิทธิ์"
          }
        />
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Gmail</h1>
      <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 16 }}>
        กล่องจดหมายที่ยังไม่ได้อ่าน (อ่านอย่างเดียว — ตอบผ่าน Friday ในหน้าแชท)
      </p>
      {data.messages.length === 0 ? (
        <Empty label="ไม่มีอีเมลที่ยังไม่ได้อ่าน" />
      ) : (
        <div>
          {data.messages.map((msg) => (
            <MessageRow key={msg.id} msg={msg} />
          ))}
        </div>
      )}
    </div>
  );
}
