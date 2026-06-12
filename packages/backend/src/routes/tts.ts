import type { FastifyInstance } from "fastify";
import { ttsRequestSchema } from "../schemas/tts.js";
import { logActivity } from "../db/repositories/activityRepo.js";
import { realTtsSynthesizer, type TtsSynthesizer } from "../services/tts.js";

export interface TtsRouteOptions {
  synthesizer?: TtsSynthesizer;
}

export async function ttsRoutes(
  app: FastifyInstance,
  opts: TtsRouteOptions,
): Promise<void> {
  const synth = opts.synthesizer ?? realTtsSynthesizer;

  app.post("/api/tts", async (req, reply) => {
    const body = ttsRequestSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ kind: "error", error: body.error.issues[0].message });
    }

    const { text, preset } = body.data;
    const wav = await synth.synthesize(text, preset);

    if (wav === null) {
      logActivity("tts.unavailable", "synthesizer returned null");
      return reply.code(204).send();
    }

    return reply
      .header("content-type", "audio/wav")
      .header("cache-control", "no-store")
      .code(200)
      .send(wav);
  });
}
