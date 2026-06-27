import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { idParamSchema } from "../schemas/common.js";
import {
  patchCalendarPlanItemSchema,
  approveCalendarPlanSchema,
} from "../schemas/calendarPlan.js";
import {
  getCalendarPlanById,
  listCalendarPlanItems,
  getCalendarPlanItemById,
  updateCalendarPlanItem,
  setCalendarPlanItemConflict,
} from "../db/repositories/calendarPlanRepo.js";
import {
  approveCalendarPlan,
  discardCalendarPlan,
  CalendarPlanError,
} from "../services/calendarPlanService.js";
import {
  makeCreateConflictChecker,
  type CreateConflictInput,
} from "../services/eventConflicts.js";
import {
  realGoogleEventsFetcher,
  type GoogleEventsFetcher,
} from "../services/googleCalendar.js";
import { logActivity } from "../db/repositories/activityRepo.js";

/**
 * Calendar plan routes — review/edit a staged bulk Google Calendar add, then
 * approve the selected items (creating real events) or discard the whole plan.
 * `calendarFetcher` is injectable so tests can stub Google with no live call.
 */
export interface CalendarPlanRouteOptions {
  calendarFetcher?: GoogleEventsFetcher;
}

const itemParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  itemId: z.coerce.number().int().positive(),
});

export async function calendarPlanRoutes(
  app: FastifyInstance,
  opts: CalendarPlanRouteOptions = {},
): Promise<void> {
  const fetchGoogle = opts.calendarFetcher ?? realGoogleEventsFetcher;
  const conflictChecker = makeCreateConflictChecker(fetchGoogle);

  app.get("/api/calendar-plans/:id", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "id ไม่ถูกต้อง" });
    const plan = getCalendarPlanById(params.data.id);
    if (!plan) return reply.code(404).send({ error: "ไม่พบแผนปฏิทิน" });
    return reply
      .code(200)
      .send({ plan, items: listCalendarPlanItems(plan.id) });
  });

  app.patch("/api/calendar-plans/:id/items/:itemId", async (req, reply) => {
    const params = itemParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "id ไม่ถูกต้อง" });
    const body = patchCalendarPlanItemSchema.safeParse(req.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: body.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" });
    }
    const item = getCalendarPlanItemById(params.data.itemId);
    if (!item || item.plan_id !== params.data.id) {
      return reply.code(404).send({ error: "ไม่พบรายการ" });
    }
    let updated = updateCalendarPlanItem(params.data.itemId, body.data);
    // When the time changed, re-scan this item's clash so the card reflects an
    // edit that resolves (or introduces) a conflict — keeps display truthful.
    if ((body.data.starts_at || body.data.ends_at) && updated) {
      const conflicts = await conflictChecker({
        title: updated.title,
        starts_at: updated.starts_at,
        ends_at: updated.ends_at,
        location: updated.location ?? undefined,
        notes: updated.notes ?? undefined,
      } as CreateConflictInput);
      const titles = Array.from(
        new Set(conflicts.map((c) => c.withTitle).filter((t) => t.length > 0)),
      );
      setCalendarPlanItemConflict(
        updated.id,
        conflicts.length > 0
          ? { with: titles.join(", ") || null, detail: conflicts.map((c) => c.detail).join("; ") || null }
          : null,
      );
      updated = getCalendarPlanItemById(updated.id);
    }
    return reply.code(200).send({ item: updated });
  });

  app.post("/api/calendar-plans/:id/approve", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "id ไม่ถูกต้อง" });
    const body = approveCalendarPlanSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "ข้อมูลไม่ถูกต้อง" });
    try {
      const out = await approveCalendarPlan(params.data.id, fetchGoogle);
      logActivity(
        "calendar_plan.approved",
        `plan #${params.data.id}: ${out.created.length} created, ${out.skippedConflict.length} skipped(conflict), ${out.rejected} rejected, ${out.failed.length} failed`,
      );
      return reply.code(200).send(out);
    } catch (err) {
      return handlePlanError(err, reply);
    }
  });

  app.post("/api/calendar-plans/:id/discard", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "id ไม่ถูกต้อง" });
    try {
      discardCalendarPlan(params.data.id);
      logActivity("calendar_plan.discarded", `plan #${params.data.id}`);
      return reply.code(200).send({ ok: true });
    } catch (err) {
      return handlePlanError(err, reply);
    }
  });
}

function handlePlanError(err: unknown, reply: FastifyReply) {
  if (err instanceof CalendarPlanError) {
    const code = err.code === "not-found" ? 404 : 409;
    return reply.code(code).send({ error: err.message });
  }
  throw err;
}
