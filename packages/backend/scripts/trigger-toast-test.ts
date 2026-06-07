import { StubDesktopNotifier, realDesktopNotifier } from "../src/services/desktopNotifier.js";
import { runSchedulerTick } from "../src/services/scheduler.js";
import { initDb, } from "../src/db/init.js";
import { getDb } from "../src/db/connection.js";
import { nowIso } from "../src/config.js";

initDb();

const db = getDb();
const ts = nowIso();
const pastDue = new Date(Date.now() - 5 * 60_000).toISOString();

db.prepare(
  `INSERT INTO reminder (title, due_at, notes, status, created_at, updated_at)
   VALUES ('Toast test reminder', ?, 'Triggered manually', 'active', ?, ?)`,
).run(pastDue, ts, ts);

console.log("Seeded overdue reminder, running scheduler tick...");
runSchedulerTick(new Date(), realDesktopNotifier);
console.log("Done — toast should appear");
