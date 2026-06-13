import { buildServer } from "./server.js";
import { initDb } from "./db/init.js";
import { closeDb } from "./db/connection.js";
import { HOST, PORT } from "./config.js";
import { startScheduler } from "./services/scheduler.js";
import { realDesktopNotifier } from "./services/desktopNotifier.js";
import { realTtsSynthesizer } from "./services/tts.js";
import { realAudioPlayer } from "./services/audioPlayer.js";
import type { SchedulerVoice } from "./services/scheduler.js";

async function main(): Promise<void> {
  initDb();
  const app = buildServer();

  // Voice bundle is always wired now; the real synthesizer/player gate themselves
  // on runtime flags (isTtsEnabled / isTtsSpeakerEnabled — Settings toggles), so
  // voice can be turned on/off without a restart. When disabled the synthesizer
  // returns null and the player no-ops, so the scheduler stays silent.
  const voice: SchedulerVoice = {
    synthesizer: realTtsSynthesizer,
    player: realAudioPlayer,
  };

  // Start the background scheduler interval unconditionally. Each tick gates on
  // the runtime flag (isSchedulerEnabled — Settings toggle, default off), so the
  // user can enable/disable firing without a restart. Kept outside buildServer so
  // HTTP-only tests are unaffected.
  const scheduler = startScheduler(realDesktopNotifier, voice);
  app.log.info("Scheduler interval running (firing gated by runtime flag)");

  const shutdown = async (): Promise<void> => {
    scheduler.stop();
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
