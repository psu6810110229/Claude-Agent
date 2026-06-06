import { buildServer } from "./server.js";
import { initDb } from "./db/init.js";
import { closeDb } from "./db/connection.js";
import { HOST, PORT } from "./config.js";

async function main(): Promise<void> {
  initDb();
  const app = buildServer();

  const shutdown = async (): Promise<void> => {
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
