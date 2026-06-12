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

const TOGGLEABLE_KEYS = [
  "google_calendar",
  "claude_ai",
  "auto_execute",
  "auto_execute_destructive",
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
          "Toggle the Claude reasoning runtime (chat, AI commands, briefs). " +
          "Proposal-only — every write still goes through the approval queue.",
      },
      {
        key: "google_calendar",
        label: "Google Calendar",
        enabled: isGoogleCalendarEnabled(),
        configured: isCredentialsConfigured(),
        description: isCredentialsConfigured()
          ? "Toggle Google Calendar read + create/update/delete access."
          : "Credentials not found. Run `npm run google-auth` first.",
      },
      {
        key: "auto_execute",
        label: "Auto-execute",
        enabled: isAutoExecuteEnabled(),
        configured: true,
        description:
          "Run reversible actions immediately (no approve click). Destructive " +
          "actions (Google delete, archive, memory replace) still require confirm.",
      },
      {
        key: "auto_execute_destructive",
        label: "Auto-execute Google delete",
        enabled: isAutoExecuteDestructiveEnabled(),
        configured: true,
        description:
          "Also run Google Calendar delete/update immediately without confirm. " +
          "Recoverable — each delete snapshots the event first so it can be " +
          "restored. Archive + memory-replace still require confirm. " +
          "Requires Auto-execute to be on.",
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
            "Google Calendar credentials not found. Run `npm run google-auth` first.",
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

    return reply.code(200).send({ key, enabled });
  });
}
