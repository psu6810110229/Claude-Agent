/**
 * Phase 4.3 - backend read worker adapters smoke.
 *
 * Uses injected stubs only. No real Google API, Gmail, Drive, LINE exports,
 * credentials, provider calls, or filesystem reads.
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

async function main(): Promise<void> {
  console.log("Running Claude_Agent backend read workers smoke test...");

  const { runBackendReadWorker } = await import("../src/services/readOnlyWorkers.js");
  const { verifyWorkerEvidenceBundle } = await import(
    "../src/services/workerVerifier.js"
  );

  const now = () => new Date("2026-06-29T06:00:00.000Z");

  const calendar = await runBackendReadWorker(
    {
      job_id: 10,
      worker_id: "calendar.reader",
      source: "google_calendar",
      task: "Read schedule metadata",
      query: "class",
      since: "2026-06-29T00:00:00.000Z",
      until: "2026-06-30T00:00:00.000Z",
      limit: 5,
    },
    {
      now,
      calendarEvents: async () => [
        {
          id: "evt_1",
          title: "Class",
          start: "2026-06-29T05:00:00.000Z",
          end: "2026-06-29T06:00:00.000Z",
          allDay: false,
          location: null,
          description: null,
          htmlLink: null,
          source: "google",
        },
      ],
    },
  );
  assert(calendar.source === "google_calendar", "calendar worker returns calendar bundle");
  assert(calendar.newest_at === "2026-06-29T05:00:00.000Z", "calendar worker derives newest_at");
  assert(verifyWorkerEvidenceBundle(calendar, { nowIso: now().toISOString() }).accepted, "calendar bundle verifies");

  const gmail = await runBackendReadWorker(
    {
      job_id: 11,
      worker_id: "gmail.reader",
      source: "gmail",
      task: "Read unread mail metadata",
      query: "invoice",
      limit: 1,
    },
    {
      now,
      gmailMessages: async () => [
        {
          id: "msg_1",
          threadId: "thr_1",
          from: "sender@example.com",
          subject: "Invoice",
          snippet: "not returned in bundle",
          receivedAt: "2026-06-29T05:30:00.000Z",
          unread: true,
        },
      ],
    },
  );
  assert(gmail.source === "gmail", "gmail worker returns gmail bundle");
  assert(gmail.capped, "gmail worker marks capped when results reach limit");
  assert(!JSON.stringify(gmail).includes("not returned"), "gmail bundle excludes snippets");

  const drive = await runBackendReadWorker(
    {
      job_id: 12,
      worker_id: "drive.reader",
      source: "google_drive",
      task: "Read Drive file metadata",
      query: "proposal",
      limit: 10,
    },
    {
      now,
      driveFiles: async () => [
        {
          id: "file_1",
          name: "Proposal",
          mimeType: "application/vnd.google-apps.document",
          modifiedTime: "2026-06-29T04:00:00.000Z",
        },
      ],
    },
  );
  assert(drive.source === "google_drive", "drive worker returns drive bundle");
  assert(drive.limitations.some((line) => line.includes("file content")), "drive bundle states no file content");

  const line = await runBackendReadWorker(
    {
      job_id: 13,
      worker_id: "line.reader",
      source: "line_export",
      task: "Read LINE export evidence metadata",
      query: "payment",
      limit: 10,
    },
    {
      now,
      lineMessages: async () => [
        {
          chat: "Work",
          date: "2026-06-29",
          time: "12:20",
          atUtc: "2026-06-29T05:20:00.000Z",
          sender: "A",
          text: "secret body must stay out",
          system: false,
        },
      ],
    },
  );
  assert(line.source === "line_export", "line worker returns LINE export bundle");
  assert(!JSON.stringify(line).includes("secret body"), "line bundle excludes message bodies");

  const unavailable = await runBackendReadWorker(
    {
      job_id: 14,
      worker_id: "gmail.reader",
      source: "gmail",
      task: "Read unavailable Gmail",
      limit: 1,
    },
    {
      now,
      gmailMessages: async () => {
        throw new Error("stub unavailable");
      },
    },
  );
  assert(unavailable.partial && unavailable.confidence === "low", "adapter failures return partial low-confidence bundles");

  console.log("\nAll backend read worker smoke assertions passed.");
}

main().catch((err: unknown) => {
  console.error(
    "\nBackend read worker smoke FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
