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
    <div className="gmail-msg">
      <div>
        <div className={`gmail-msg-sender ${msg.unread ? "is-unread" : ""}`}>
          {formatFrom(msg.from)}
        </div>
        <div className={`gmail-msg-subject ${msg.unread ? "is-unread" : ""}`}>
          {msg.subject}
        </div>
        <div className="gmail-msg-snippet">{msg.snippet}</div>
      </div>
      <div className="gmail-msg-date">{formatDate(msg.receivedAt)}</div>
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
        <header className="page-header">
          <div>
            <p className="page-kicker">Inbox</p>
            <h2>Gmail</h2>
          </div>
        </header>
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
      <header className="page-header">
        <div>
          <p className="page-kicker">Inbox</p>
          <h2>Gmail</h2>
          <p className="lede">
            กล่องจดหมายที่ยังไม่ได้อ่าน (อ่านอย่างเดียว — ตอบผ่าน Friday ในหน้าแชท)
          </p>
        </div>
      </header>
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
