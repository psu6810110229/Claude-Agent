import type { FastifyInstance } from "fastify";
import { idParamSchema } from "../schemas/common.js";
import {
  createClassBlockSchema,
  updateClassBlockSchema,
  freeSlotsQuerySchema,
} from "../schemas/classBlock.js";
import {
  listActiveClassBlocks,
  getClassBlockById,
  createClassBlock,
  updateClassBlock,
  archiveClassBlock,
} from "../db/repositories/classBlockRepo.js";
import { logActivity } from "../db/repositories/activityRepo.js";
import { resolveScheduleConstraints } from "../services/scheduleConstraints.js";
import { findFreeSlotsForDay } from "../services/freeSlotFinder.js";
import { listEvents } from "../db/repositories/eventRepo.js";
import { bucketEvents } from "../services/agenda.js";
import { type GoogleEventsFetcher } from "../services/googleCalendar.js";
import { cachedGoogleEventsFetcher } from "../services/googleCalendarCache.js";
import { BANGKOK_OFFSET_MS } from "../config.js";

/**
 * class_block management routes — the LOCAL timetable store (never Google).
 *
 * Full CRUD because this is a new local domain (NOT one of the approval-gated
 * action domains); writes are soft, reversible (archive), and bound to the local
 * box. Plus a read-only free-slot endpoint that powers "find me open time today".
 */
export interface ClassBlocksRouteOptions {
  /** Inject a stub Google fetcher (tests). Defaults to the cached real fetcher. */
  calendarFetcher?: GoogleEventsFetcher;
}

export async function classBlockRoutes(
  app: FastifyInstance,
  opts: ClassBlocksRouteOptions = {},
): Promise<void> {
  const fetchGoogle = opts.calendarFetcher ?? cachedGoogleEventsFetcher;

  app.get("/api/class-blocks", async () => {
    return { blocks: listActiveClassBlocks() };
  });

  app.post("/api/class-blocks", async (req, reply) => {
    const body = createClassBlockSchema.safeParse(req.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: body.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" });
    }
    const block = createClassBlock(body.data);
    logActivity("class_block.created", `class_block #${block.id} (${block.source})`);
    return reply.code(201).send({ block });
  });

  app.put("/api/class-blocks/:id", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "id ไม่ถูกต้อง" });
    const body = updateClassBlockSchema.safeParse(req.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: body.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" });
    }
    // Cross-field guard: a patch that ends up with end <= start is rejected.
    const existing = getClassBlockById(params.data.id);
    if (!existing) return reply.code(404).send({ error: "ไม่พบรายการ" });
    const start = body.data.start_local ?? existing.start_local;
    const end = body.data.end_local ?? existing.end_local;
    if (end <= start) {
      return reply.code(400).send({ error: "end_local must be after start_local" });
    }
    const block = updateClassBlock(params.data.id, body.data);
    if (!block) return reply.code(404).send({ error: "ไม่พบรายการ" });
    logActivity("class_block.updated", `class_block #${block.id}`);
    return reply.code(200).send({ block });
  });

  app.delete("/api/class-blocks/:id", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "id ไม่ถูกต้อง" });
    const block = archiveClassBlock(params.data.id);
    if (!block) return reply.code(404).send({ error: "ไม่พบรายการ" });
    logActivity("class_block.archived", `class_block #${block.id}`);
    return reply.code(200).send({ block });
  });

  // Read-only free-slot finder: open gaps on a Bangkok day across Google + local
  // events + class blocks/protected windows. Fails SOFT on Google errors → []
  // (the local sources still produce a useful answer).
  app.get("/api/free-slots", async (req, reply) => {
    const q = freeSlotsQuerySchema.safeParse(req.query ?? {});
    if (!q.success) {
      return reply.code(400).send({ error: "พารามิเตอร์ไม่ถูกต้อง" });
    }
    const targetDay = resolveTargetDay(q.data.date);

    let googleEvents: Awaited<ReturnType<GoogleEventsFetcher>> = [];
    try {
      const dayStartUtc = new Date(targetDay.getTime() - 12 * 3600_000).toISOString();
      const dayEndUtc = new Date(targetDay.getTime() + 36 * 3600_000).toISOString();
      googleEvents = await fetchGoogle(dayStartUtc, dayEndUtc);
    } catch {
      googleEvents = [];
    }

    const eb = bucketEvents(listEvents(), new Date());
    const localEvents = [...eb.today, ...eb.upcoming].map((e) => ({
      id: e.id,
      title: e.title,
      starts_at: e.starts_at,
      ends_at: e.ends_at,
    }));

    const slots = findFreeSlotsForDay(
      targetDay,
      {
        googleEvents,
        localEvents,
        constraints: resolveScheduleConstraints(),
      },
      q.data.minMinutes ? { minMinutes: q.data.minMinutes } : {},
    );
    return reply.code(200).send({ date: q.data.date ?? null, slots });
  });
}

/**
 * Resolve a "YYYY-MM-DD" Bangkok date param to an instant inside that Bangkok
 * day (noon local, robust against DST-free +7h math). Missing date → now (today).
 */
function resolveTargetDay(date: string | undefined): Date {
  if (!date) return new Date();
  const [y, m, d] = date.split("-").map(Number);
  // Bangkok noon for that calendar day, expressed as a UTC instant.
  return new Date(Date.UTC(y, m - 1, d, 12, 0) - BANGKOK_OFFSET_MS);
}
