import { z } from "zod";

export const ttsPresetSchema = z.enum(["warm", "intimate", "calm_female"]);
export type TtsPreset = z.infer<typeof ttsPresetSchema>;

export const ttsRequestSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  preset: ttsPresetSchema.optional(),
});
export type TtsRequest = z.infer<typeof ttsRequestSchema>;
