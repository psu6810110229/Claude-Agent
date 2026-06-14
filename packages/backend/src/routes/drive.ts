import type { FastifyInstance } from "fastify";
import {
  searchDriveFiles,
  getDriveFileContent,
  uploadToDrive,
  isDriveEnabled,
  DriveError,
} from "../services/googleDrive.js";
import { driveUploadBodySchema } from "../schemas/googleDrive.js";

/**
 * Google Drive routes (Step 19).
 *
 * - GET  /api/drive/files?q=&sharedWith=  — search files (fail-closed)
 * - GET  /api/drive/files/:id/content     — read text content (fail-closed)
 * - POST /api/drive/upload                — upload file as base64 JSON (10 MB limit)
 *
 * All read routes degrade to available:false on any error. Upload returns 503
 * when disabled and 400/500 for validation/API errors.
 */
export async function driveRoutes(app: FastifyInstance): Promise<void> {
  // Search / list recent files
  app.get<{ Querystring: { q?: string; sharedWith?: string } }>(
    "/api/drive/files",
    async (req, reply) => {
      if (!isDriveEnabled()) {
        return reply.send({ available: false, files: [] });
      }
      try {
        const files = await searchDriveFiles(
          req.query.q ?? "",
          req.query.sharedWith,
        );
        return reply.send({ available: true, files });
      } catch (err) {
        if (err instanceof DriveError) {
          app.log.warn({ reason: err.reason }, "Drive search failed");
        }
        return reply.send({ available: false, files: [] });
      }
    },
  );

  // Read text content of a single file
  app.get<{ Params: { id: string } }>(
    "/api/drive/files/:id/content",
    async (req, reply) => {
      if (!isDriveEnabled()) {
        return reply.status(503).send({
          available: false,
          message: "Google Drive ยังไม่ได้เปิดใช้งาน",
        });
      }
      try {
        const { name, content, truncated } = await getDriveFileContent(
          req.params.id,
        );
        return reply.send({
          id: req.params.id,
          name,
          content,
          truncated,
          available: true,
        });
      } catch (err) {
        if (err instanceof DriveError) {
          app.log.warn({ reason: err.reason }, "Drive content read failed");
          const status =
            err.reason === "unsupported" || err.reason === "too_large"
              ? 422
              : 503;
          return reply.status(status).send({
            available: false,
            message: err.message,
          });
        }
        return reply.status(503).send({
          available: false,
          message: "ไม่สามารถอ่านไฟล์ได้ในขณะนี้",
        });
      }
    },
  );

  // Upload a file (body limit 10 MB; base64 in JSON)
  app.post(
    "/api/drive/upload",
    { bodyLimit: 10_485_760 },
    async (req, reply) => {
      if (!isDriveEnabled()) {
        return reply.status(503).send({
          available: false,
          message: "Google Drive ยังไม่ได้เปิดใช้งาน",
        });
      }

      const parsed = driveUploadBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          available: false,
          message: "ข้อมูลไม่ถูกต้อง: " + parsed.error.issues[0]?.message,
        });
      }

      // Guard against oversized base64 payloads (10 MB decoded ≈ 13.3 MB base64)
      if (parsed.data.contentBase64.length > 13_000_000) {
        return reply.status(413).send({
          available: false,
          message: "ไฟล์ใหญ่เกินไป (สูงสุด 10 MB)",
        });
      }

      try {
        const result = await uploadToDrive(parsed.data);
        return reply.status(201).send({
          available: true,
          id: result.id,
          name: result.name,
          webViewLink: result.webViewLink,
          message: "อัปโหลดสำเร็จ",
        });
      } catch (err) {
        if (err instanceof DriveError) {
          app.log.warn({ reason: err.reason }, "Drive upload failed");
        }
        return reply.status(503).send({
          available: false,
          message: "อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้งได้",
        });
      }
    },
  );
}
