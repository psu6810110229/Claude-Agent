import { buildServer } from "./server.js";
import { initDb } from "./db/init.js";
import { closeDb } from "./db/connection.js";
import { HOST, PORT, SCHEDULER_ENABLED, TTS_ENABLED, TTS_SPEAKER_ENABLED } from "./config.js";
import { startScheduler } from "./services/scheduler.js";
import { realDesktopNotifier } from "./services/desktopNotifier.js";
import { realTtsSynthesizer } from "./services/tts.js";
import { realAudioPlayer } from "./services/audioPlayer.js";
import type { SchedulerVoice } from "./services/scheduler.js";

async function main(): Promise<void> {
  initDb();
  const app = buildServer();

  // Voice bundle: only wired when both TTS flags are enabled.
  // Flag gating lives here, not inside scheduler, so tests can inject stubs freely.
  const voice: SchedulerVoice | undefined =
    TTS_ENABLED && TTS_SPEAKER_ENABLED
      ? { synthesizer: realTtsSynthesizer, player: realAudioPlayer }
      : undefined;

  // Start background scheduler (off by default — set CLAUDE_AGENT_SCHEDULER_ENABLED=1).
  // Kept outside buildServer so HTTP-only tests are unaffected.
  const scheduler = SCHEDULER_ENABLED
    ? startScheduler(realDesktopNotifier, voice)
    : null;
  if (SCHEDULER_ENABLED) {
    app.log.info("Scheduler started (reminder/event firing active)");
  }

  const shutdown = async (): Promise<void> => {
    scheduler?.stop();
    await app.close();
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ host: HOST, port: PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
