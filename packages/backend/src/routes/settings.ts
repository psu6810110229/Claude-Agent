import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  GOOGLE_CLIENT_SECRET_PATH,
  GOOGLE_TOKEN_PATH,
} from "../config.js";
import { setConfigBool } from "../db/repositories/configRepo.js";
import { isGoogleCalendarEnabled } from "../services/googleCalendar.js";
import { isClaudeAiEnabled } from "../services/claudeClient.js";
import {
  isAutoExecuteEnabled,
  isAutoExecuteDestructiveEnabled,
} from "../services/actionDispatcher.js";
import {
  isActiveTopicTriageEnabled,
  isSchedulerEnabled,
} from "../services/scheduler.js";
import { isDesktopNotificationsEnabled } from "../services/desktopNotifier.js";
import { isTtsEnabled } from "../services/tts.js";
import { isTtsSpeakerEnabled } from "../services/audioPlayer.js";

const TOGGLEABLE_KEYS = [
  "google_calendar",
  "claude_ai",
  "auto_execute",
  "auto_execute_destructive",
  "scheduler",
  "active_topic_triage_enabled",
  "desktop_notifications",
  "tts",
  "tts_speaker",
] as const;
type ToggleableKey = (typeof TOGGLEABLE_KEYS)[number];

const toggleBodySchema = z.object({ enabled: z.boolean() });

function isCredentialsConfigured(): boolean {
  return fs.existsSync(GOOGLE_CLIENT_SECRET_PATH) && fs.existsSync(GOOGLE_TOKEN_PATH);
}

function buildSettingsPayload() {
  return {
    settings: [
      {
        key: "claude_ai",
        label: "Claude AI",
        enabled: isClaudeAiEnabled(),
        configured: true,
        description:
          "เปิดหรือปิด runtime เหตุผลของ Claude สำหรับแชต คำสั่ง AI และบรีฟ " +
          "ทุกงานเขียนยังต้องผ่านคิวอนุมัติเหมือนเดิม",
      },
      {
        key: "google_calendar",
        label: "Google Calendar",
        enabled: isGoogleCalendarEnabled(),
        configured: isCredentialsConfigured(),
        description: isCredentialsConfigured()
          ? "อ่าน Google Calendar และให้ Friday เสนอสร้าง แก้ไข หรือลบอีเวนต์ผ่านคิวอนุมัติ"
          : "ยังไม่พบ credentials ให้รัน `npm run google-auth` ก่อน",
      },
      {
        key: "auto_execute",
        label: "ทำงานอัตโนมัติ",
        enabled: isAutoExecuteEnabled(),
        configured: true,
        description:
          "ให้รายการที่ย้อนกลับได้ทำงานทันทีโดยไม่ต้องกดอนุมัติ " +
          "งานเสี่ยง เช่น ลบ Google, archive, หรือแทนที่ memory ยังต้องยืนยันก่อน",
      },
      {
        key: "auto_execute_destructive",
        label: "ลบ Google อัตโนมัติ",
        enabled: isAutoExecuteDestructiveEnabled(),
        configured: true,
        description:
          "ให้การแก้ไขหรือลบ Google Calendar ทำงานทันทีเมื่อเปิดทำงานอัตโนมัติ " +
          "การลบจะเก็บ snapshot ไว้ก่อนเพื่อกู้คืนได้ ส่วน archive และ memory replace ยังต้องยืนยัน",
      },
      {
        key: "scheduler",
        label: "ตัวตั้งเวลาเบื้องหลัง",
        enabled: isSchedulerEnabled(),
        configured: true,
        description:
          "แจ้งเตือน reminder ที่ถึงเวลาและอีเวนต์ที่ใกล้เริ่ม " +
          "ไม่เรียก Claude ไม่เขียนปฏิทิน และไม่ข้ามคิวอนุมัติ",
      },
      {
        key: "active_topic_triage_enabled",
        label: "ติดตามหัวข้อจาก LINE",
        enabled: isActiveTopicTriageEnabled(),
        configured: true,
        description:
          "ให้ Friday เช็กหัวข้อที่ติดตามจาก LINE export เป็นรอบ ๆ แล้วแจ้งเมื่อมีหลักฐานใหม่ " +
          "อ่านจากไฟล์ export เท่านั้น ไม่ส่งหรืออ่านข้อความใน LINE แทนคุณ",
      },
      {
        key: "desktop_notifications",
        label: "แจ้งเตือนบนเดสก์ท็อป",
        enabled: isDesktopNotificationsEnabled(),
        configured: true,
        description:
          "แสดง toast ของ Windows สำหรับ reminder หรืออีเวนต์ แม้ปิด dashboard อยู่ " +
          "ต้องเปิดตัวตั้งเวลาเบื้องหลังก่อน",
      },
      {
        key: "tts",
        label: "เสียงพูด (TTS)",
        enabled: isTtsEnabled(),
        configured: true,
        description:
          "เปิดเสียงพูดของ Friday สำหรับคำตอบในแชตและ `/api/tts` " +
          "ใช้ Microsoft Edge endpoint จึงต้องใช้อินเทอร์เน็ต และจะกลับเป็นข้อความถ้าเสียงไม่พร้อม",
      },
      {
        key: "tts_speaker",
        label: "อ่านแจ้งเตือนออกลำโพง",
        enabled: isTtsSpeakerEnabled(),
        configured: true,
        description:
          "ให้ backend อ่าน reminder หรืออีเวนต์ผ่านลำโพงเครื่องนี้ แม้ปิด dashboard อยู่ " +
          "ต้องเปิดเสียงพูดและตัวตั้งเวลาเบื้องหลังก่อน",
      },
    ],
  };
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", async () => buildSettingsPayload());

  app.post("/api/settings/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    if (!TOGGLEABLE_KEYS.includes(key as ToggleableKey)) {
      return reply.code(404).send({ error: `Unknown setting: ${key}` });
    }

    const body = toggleBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: body.error.issues[0]?.message ?? "Invalid body" });
    }

    const { enabled } = body.data;

    if (key === "google_calendar") {
      if (enabled && !isCredentialsConfigured()) {
        return reply.code(400).send({
          error:
            "ยังไม่พบ Google Calendar credentials ให้รัน `npm run google-auth` ก่อน",
        });
      }
      setConfigBool("google_calendar_enabled", enabled);
    }

    if (key === "claude_ai") {
      setConfigBool("claude_ai_enabled", enabled);
    }

    if (key === "auto_execute") {
      setConfigBool("auto_execute_enabled", enabled);
    }

    if (key === "auto_execute_destructive") {
      setConfigBool("auto_execute_destructive_enabled", enabled);
    }

    if (key === "scheduler") {
      setConfigBool("scheduler_enabled", enabled);
    }

    if (key === "active_topic_triage_enabled") {
      setConfigBool("active_topic_triage_enabled", enabled);
    }

    if (key === "desktop_notifications") {
      setConfigBool("desktop_notifications_enabled", enabled);
    }

    if (key === "tts") {
      setConfigBool("tts_enabled", enabled);
    }

    if (key === "tts_speaker") {
      setConfigBool("tts_speaker_enabled", enabled);
    }

    return reply.code(200).send({ key, enabled });
  });
}
