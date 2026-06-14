import { z } from "zod";

export const driveFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  webViewLink: z.string().optional(),
  modifiedTime: z.string().optional(),
  owners: z.array(z.object({ displayName: z.string() })).optional(),
  size: z.string().optional(),
});
export type DriveFile = z.infer<typeof driveFileSchema>;

export const driveListResponseSchema = z.object({
  files: z.array(driveFileSchema),
  available: z.boolean(),
});
export type DriveListResponse = z.infer<typeof driveListResponseSchema>;

export const driveContentResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string().nullable(),
  truncated: z.boolean(),
  available: z.boolean(),
  message: z.string().optional(),
});
export type DriveContentResponse = z.infer<typeof driveContentResponseSchema>;

export const driveUploadBodySchema = z.object({
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  contentBase64: z.string().min(1),
  folderId: z.string().optional(),
});
export type DriveUploadBody = z.infer<typeof driveUploadBodySchema>;

export const driveUploadResponseSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  webViewLink: z.string().nullable().optional(),
  available: z.boolean(),
  message: z.string().optional(),
});
export type DriveUploadResponse = z.infer<typeof driveUploadResponseSchema>;
