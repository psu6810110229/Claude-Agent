import type { FastifyInstance } from "fastify";
import { idParamSchema } from "../schemas/common.js";
import {
  createScheduleImportSchema,
  patchScheduleImportItemSchema,
  approveScheduleImportSchema,
} from "../schemas/scheduleImport.js";
import {
  getScheduleImportById,
  listScheduleImportItems,
  getScheduleImportItemById,
  updateScheduleImportItem,
} from "../db/repositories/scheduleImportRepo.js";
import {
  createImportFromUpload,
  approveImport,
  ScheduleImportError,
} from "../services/scheduleImportService.js";
import type { ScheduleExtractionDeps } from "../services/scheduleExtractor.js";
import { GeminiError } from "../services/geminiClient.js";
import { ClaudeError } from "../services/claudeClient.js";
import { logActivity } from "../db/repositories/activityRepo.js";
import { z } from "zod";

/**
 * Schedule import routes — create a staging session from an upload, review/edit
 * the parsed items, and approve selected items into the LOCAL class_block store.
 * No Google Calendar write. Extraction deps are injectable for tests (no real
 * Gemini call in smoke).
 */
export interface ScheduleImportRouteOptions {
  extractionDeps?: ScheduleExtractionDeps;
}

const itemParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  itemId: z.coerce.number().int().positive(),
});

export async function scheduleImportRoutes(
  app: FastifyInstance,
  opts: ScheduleImportRouteOptions = {},
): Promise<void> {
  app.post("/api/schedule-imports", async (req, reply) => {
    const body = createScheduleImportSchema.safeParse(req.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: body.error.issues[0]?.message ?? "คำขอไม่ถูกต้อง" });
    }
    try {
      const out = await createImportFromUpload(body.data.uploadId, opts.extractionDeps);
      logActivity(
        "schedule_import.created",
        `import #${out.import.id} kind=${out.import.source_kind} items=${out.items.length}`,
      );
      return reply.code(201).send(out);
    } catch (err) {
      return handleExtractError(err, reply);
    }
  });

  app.get("/api/schedule-imports/:id", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "id ไม่ถูกต้อง" });
    const imp = getScheduleImportById(params.data.id);
    if (!imp) return reply.code(404).send({ error: "ไม่พบรายการนำเข้า" });
    return reply
      .code(200)
      .send({ import: imp, items: listScheduleImportItems(imp.id) });
  });

  app.patch("/api/schedule-imports/:id/items/:itemId", async (req, reply) => {
    const params = itemParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "id ไม่ถูกต้อง" });
    const body = patchScheduleImportItemSchema.safeParse(req.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: body.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" });
    }
    const item = getScheduleImportItemById(params.data.itemId);
    if (!item || item.import_id !== params.data.id) {
      return reply.code(404).send({ error: "ไม่พบรายการ" });
    }
    const updated = updateScheduleImportItem(params.data.itemId, body.data);
    return reply.code(200).send({ item: updated });
  });

  app.post("/api/schedule-imports/:id/approve", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "id ไม่ถูกต้อง" });
    const body = approveScheduleImportSchema.safeParse(req.body ?? {});
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: body.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" });
    }
    try {
      const out = approveImport(params.data.id, body.data);
      logActivity(
        "schedule_import.approved",
        `import #${params.data.id}: ${out.created.length} block(s), ${out.skipped.length} skipped`,
      );
      return reply.code(200).send(out);
    } catch (err) {
      if (err instanceof ScheduleImportError) {
        const code = err.code === "not-found" ? 404 : err.code === "not-pending" ? 409 : 400;
        return reply.code(code).send({ error: err.message });
      }
      throw err;
    }
  });
}

/** Map an extraction/create failure to a clean HTTP response. */
function handleExtractError(err: unknown, reply: import("fastify").FastifyReply) {
  if (err instanceof ScheduleImportError) {
    const code =
      err.code === "upload-missing"
        ? 404
        : err.code === "unsupported-type"
          ? 415
          : 422;
    return reply.code(code).send({ error: err.message });
  }
  if (err instanceof GeminiError || err instanceof ClaudeError) {
    const code =
      err.reason === "disabled"
        ? 503
        : err.reason === "timeout"
          ? 504
          : err.reason === "rate-limit"
            ? 429
            : 502;
    const msg =
      err.reason === "disabled"
        ? "ตัวอ่านไฟล์ยังไม่พร้อม (ต้องเปิด Gemini ก่อน)"
        : err.reason === "timeout"
          ? "อ่านไฟล์นานเกินไป ลองไฟล์ที่เล็กลง"
          : err.reason === "rate-limit"
            ? "ใช้โควต้าครบชั่วคราว ลองใหม่ภายหลัง"
            : "อ่านไฟล์ไม่สำเร็จ";
    return reply.code(code).send({ error: msg });
  }
  // Invalid model output etc.
  return reply.code(422).send({ error: "อ่านตารางจากไฟล์ไม่สำเร็จ ลองอีกครั้ง" });
}
