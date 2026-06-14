/**
 * Action display registry (Sprint 2, dashboard mirror).
 *
 * Single wording source for the dashboard: the allowed action types, the inline
 * approval question/approve/reject copy (Thai, the conversational UI tone), an
 * English `humanLabel`, and a compact `summarizePayload` for the Approvals page.
 *
 * Mirrors the backend `services/actionRegistry.ts` set (hand-kept in sync like
 * the rest of `lib/types.ts`). The backend `smoke:registry` guards the backend
 * side; this file must list the SAME action types so chat-proposed actions are
 * never silently dropped (the previous bug: `reminder.done` was missing here).
 */

import { formatTs } from "./format";
import type { ActionType } from "./types";

/** Canonical action types — must match the backend executor allowlist. */
export const ACTION_TYPES: readonly ActionType[] = [
  "task.create",
  "task.update",
  "task.archive",
  "memory.write",
  "event.create",
  "event.update",
  "event.archive",
  "reminder.create",
  "reminder.update",
  "reminder.done",
  "reminder.archive",
  "google_event.create",
  "google_event.update",
  "google_event.delete",
  "fact.remember",
  "fact.update",
  "fact.forget",
  "gmail.draft",
  "gmail.send",
];

export function isActionType(value: string): value is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(value);
}

/** Short English label for headers / fallbacks. */
const HUMAN_LABELS: Record<ActionType, string> = {
  "task.create": "Create task",
  "task.update": "Update task",
  "task.archive": "Archive task",
  "memory.write": "Write memory",
  "event.create": "Create event",
  "event.update": "Update event",
  "event.archive": "Archive event",
  "reminder.create": "Create reminder",
  "reminder.update": "Update reminder",
  "reminder.done": "Mark reminder done",
  "reminder.archive": "Archive reminder",
  "google_event.create": "Create Google Calendar event",
  "google_event.update": "Update Google Calendar event",
  "google_event.delete": "Delete Google Calendar event",
  "fact.remember": "Remember a fact",
  "fact.update": "Update a fact",
  "fact.forget": "Forget a fact",
  "gmail.draft": "Create Gmail draft",
  "gmail.send": "Send Gmail email",
};

export function humanLabel(actionType: ActionType): string {
  return HUMAN_LABELS[actionType] ?? actionType;
}

export interface ActionQuestion {
  question: string;
  approve: string;
  reject: string;
}

interface ActionLike {
  action_type: ActionType;
  payload?: unknown;
}

/** Conversational approve/reject copy (Thai) for an inline approval. */
export function actionQuestion(action: ActionLike): ActionQuestion {
  const payload = asRecord(action.payload);
  const title = stringField(payload, "title");
  const target = stringField(payload, "summary") ?? stringField(payload, "target");
  const time = stringField(payload, "starts_at") ?? stringField(payload, "due_at");
  const content = stringField(payload, "content");
  const detail = [title, time ? formatTs(time) : null].filter(Boolean).join(" - ");

  switch (action.action_type) {
    case "google_event.create":
    case "event.create":
      return {
        question: `ต้องการสร้าง${detail ? ` "${detail}"` : "อีเวนต์นี้"} ไหม`,
        approve: "สร้าง",
        reject: "ไม่สร้าง",
      };
    case "task.create":
      return {
        question: `ต้องการสร้าง${title ? ` "${title}"` : "งานนี้"} ไหม`,
        approve: "สร้าง",
        reject: "ไม่สร้าง",
      };
    case "reminder.create":
      return {
        question: `ต้องการสร้าง${detail ? ` "${detail}"` : "reminder นี้"} ไหม`,
        approve: "สร้าง",
        reject: "ไม่สร้าง",
      };
    case "memory.write":
      return {
        question: `ต้องการบันทึก${target ? ` "${target}"` : "ความจำนี้"} ไหม`,
        approve: "บันทึก",
        reject: "ไม่บันทึก",
      };
    case "reminder.done":
      return {
        question: "ทำ reminder นี้เป็นเสร็จแล้วไหม",
        approve: "เสร็จแล้ว",
        reject: "ยังไม่เสร็จ",
      };
    case "task.update":
    case "event.update":
    case "reminder.update":
    case "google_event.update":
      return {
        question: "ต้องการอัปเดตรายการนี้ไหม",
        approve: "อัปเดต",
        reject: "ไม่อัปเดต",
      };
    case "google_event.delete":
      return {
        question: "ยืนยันลบอีเวนต์นี้จาก Google Calendar ไหม (ลบจริง กู้คืนได้จาก snapshot)",
        approve: "ลบ",
        reject: "ไม่ลบ",
      };
    case "task.archive":
    case "event.archive":
    case "reminder.archive":
      return {
        question: "ต้องการเก็บรายการนี้ถาวรไหม",
        approve: "เก็บ",
        reject: "ไม่เก็บ",
      };
    case "fact.remember":
      return {
        question: `ต้องการให้ผมจำ${content ? ` "${content}"` : "เรื่องนี้"} ไว้ไหม`,
        approve: "จำไว้",
        reject: "ไม่จำ",
      };
    case "fact.update":
      return {
        question: `ต้องการแก้ความจำนี้${content ? `เป็น "${content}"` : ""}ไหม`,
        approve: "แก้",
        reject: "ไม่แก้",
      };
    case "fact.forget":
      return {
        question: "ต้องการให้ผมลืมความจำนี้ไหม (เก็บ snapshot ไว้ กู้คืนได้)",
        approve: "ลืม",
        reject: "ไม่ลืม",
      };
    case "gmail.draft": {
      const to = stringField(payload, "to");
      const subject = stringField(payload, "subject");
      return {
        question: `ต้องการสร้างแบบร่างอีเมล${subject ? ` "${subject}"` : ""}${to ? ` ถึง ${to}` : ""} ไหม`,
        approve: "สร้างแบบร่าง",
        reject: "ไม่สร้าง",
      };
    }
    case "gmail.send": {
      const to = stringField(payload, "to");
      const subject = stringField(payload, "subject");
      return {
        question: `ยืนยันส่งอีเมล${subject ? ` "${subject}"` : ""}${to ? ` ถึง ${to}` : ""} เลยไหม (ส่งแล้วเรียกคืนไม่ได้)`,
        approve: "ส่งเลย",
        reject: "ไม่ส่ง",
      };
    }
    default:
      return {
        question: "ต้องการดำเนินการนี้ไหม",
        approve: "ตกลง",
        reject: "ไม่ทำ",
      };
  }
}

/** Compact one-line payload summary for approval cards (no raw JSON). */
export function summarizePayload(action: ActionLike): string | null {
  const payload = asRecord(action.payload);
  if (!payload) return null;

  const id = numberField(payload, "id");
  const strId = stringField(payload, "id");
  const title = stringField(payload, "title");
  const target = stringField(payload, "target");
  const time = stringField(payload, "starts_at") ?? stringField(payload, "due_at");
  const parts = [
    id != null ? `#${id}` : strId ? `#${strId}` : null,
    title ?? target ?? null,
    time ? formatTs(time) : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Optional second line for approval cards when the payload has useful detail. */
export function summarizePayloadDetail(action: ActionLike): string | null {
  const payload = asRecord(action.payload);
  if (!payload) return null;

  const fields = [
    stringField(payload, "summary"),
    stringField(payload, "notes"),
    stringField(payload, "location"),
    stringField(payload, "mode"),
    stringField(payload, "content"),
  ]
    .filter(Boolean)
    .map((value) => truncate(value!, 140));

  return fields.length > 0 ? fields.join(" - ") : null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value == null) return undefined;
  return value as Record<string, unknown>;
}

function stringField(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberField(
  record: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}
