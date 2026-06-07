import { buildServer } from "./server.js";
import { initDb } from "./db/init.js";
import { closeDb } from "./db/connection.js";
import { HOST, PORT, SCHEDULER_ENABLED } from "./config.js";
import { startScheduler } from "./services/scheduler.js";
import { realDesktopNotifier } from "./services/desktopNotifier.js";

async function main(): Promise<void> {
  initDb();
  const app = buildServer();

  // Start background scheduler (off by default — set CLAUDE_AGENT_SCHEDULER_ENABLED=1).
  // Kept outside buildServer so HTTP-only tests are unaffected.
  const scheduler = SCHEDULER_ENABLED
    ? startScheduler(realDesktopNotifier)
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
