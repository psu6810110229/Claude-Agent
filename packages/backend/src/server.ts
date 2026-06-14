import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health.js";
import { taskRoutes } from "./routes/tasks.js";
import { activityRoutes } from "./routes/activity.js";
import { approvalRoutes } from "./routes/approvals.js";
import { memoryRoutes } from "./routes/memory.js";
import { factRoutes } from "./routes/facts.js";
import { eventRoutes } from "./routes/events.js";
import { reminderRoutes } from "./routes/reminders.js";
import { commandRoutes } from "./routes/command.js";
import { briefRoutes } from "./routes/briefs.js";
import { calendarRoutes } from "./routes/calendar.js";
import { notificationRoutes } from "./routes/notifications.js";
import { chatRoutes } from "./routes/chat.js";
import { settingsRoutes } from "./routes/settings.js";
import { ttsRoutes } from "./routes/tts.js";
import { gmailRoutes } from "./routes/gmail.js";
import { contactsRoutes } from "./routes/contacts.js";
import { driveRoutes } from "./routes/drive.js";
import { lineRoutes } from "./routes/line.js";
import type { ClaudeInvoker } from "./services/claudeClient.js";
import type { GoogleEventsFetcher } from "./services/googleCalendar.js";
import type { TtsSynthesizer } from "./services/tts.js";

export interface BuildServerOptions {
  /** Inject a stub Claude invoker (tests). Defaults to the real `claude -p`. */
  aiInvoker?: ClaudeInvoker;
  /**
   * Inject a stub Google Calendar fetcher (tests). Defaults to the real
   * `events.list` fetcher.
   */
  calendarFetcher?: GoogleEventsFetcher;
  /** Inject a stub TTS synthesizer (tests). Defaults to the real Edge synthesizer. */
  ttsSynthesizer?: TtsSynthesizer;
}

/** Builds the Fastify instance (without listening) so it can be reused in tests. */
export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(healthRoutes);
  app.register(taskRoutes);
  app.register(activityRoutes);
  app.register(approvalRoutes);
  app.register(memoryRoutes);
  app.register(factRoutes);
  app.register(eventRoutes);
  app.register(reminderRoutes);
  app.register(commandRoutes, { aiInvoker: options.aiInvoker });
  app.register(briefRoutes, {
    aiInvoker: options.aiInvoker,
    calendarFetcher: options.calendarFetcher,
  });
  app.register(calendarRoutes, { calendarFetcher: options.calendarFetcher });
  app.register(notificationRoutes);
  app.register(chatRoutes, {
    aiInvoker: options.aiInvoker,
    calendarFetcher: options.calendarFetcher,
  });
  app.register(settingsRoutes);
  app.register(ttsRoutes, { synthesizer: options.ttsSynthesizer });
  app.register(gmailRoutes);
  app.register(contactsRoutes);
  app.register(driveRoutes);
  app.register(lineRoutes);
  return app;
}
