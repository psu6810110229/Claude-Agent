import type { FastifyInstance } from "fastify";
import { sniffFileKind, sourceKindOf } from "../services/fileExtractor.js";
import {
  saveUpload,
  purgeExpiredUploads,
} from "../services/uploadStore.js";
import { logActivity } from "../db/repositories/activityRepo.js";
import { UPLOAD_MAX_BYTES } from "../config.js";

/**
 * Upload route — accepts ONE image/PDF for the schedule import, validated by
 * MAGIC BYTES (not the client MIME), size-capped by the multipart plugin, and
 * stored under a server-generated UUID. Returns an opaque id the client then
 * hands to POST /api/schedule-imports. NEVER logs file bytes or the filename.
 */
export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/uploads", async (req, reply) => {
    // Opportunistic TTL sweep so the staging dir never grows unbounded.
    purgeExpiredUploads();

    let part: Awaited<ReturnType<typeof req.file>>;
    try {
      part = await req.file();
    } catch {
      return reply.code(400).send({ error: "อัปโหลดไม่ถูกต้อง" });
    }
    if (!part) {
      return reply.code(400).send({ error: "ไม่พบไฟล์ที่อัปโหลด" });
    }

    let buf: Buffer;
    try {
      buf = await part.toBuffer();
    } catch (err) {
      // @fastify/multipart throws when the per-file size limit is exceeded.
      const code = (err as { code?: string }).code;
      if (code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.code(413).send({
          error: `ไฟล์ใหญ่เกินไป (เกิน ${Math.round(UPLOAD_MAX_BYTES / (1024 * 1024))}MB)`,
        });
      }
      return reply.code(400).send({ error: "อ่านไฟล์ไม่สำเร็จ" });
    }

    const kind = sniffFileKind(buf);
    if (!kind) {
      return reply
        .code(415)
        .send({ error: "รองรับเฉพาะรูปภาพ (PNG/JPG) หรือ PDF" });
    }

    const id = saveUpload(buf);
    logActivity("upload.received", `id=${id} kind=${sourceKindOf(kind)} bytes=${buf.length}`);
    return reply.code(201).send({ id, kind: sourceKindOf(kind), mime: kind });
  });
}
