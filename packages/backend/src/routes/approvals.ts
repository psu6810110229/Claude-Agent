import type { FastifyInstance } from "fastify";
import { idParamSchema } from "../schemas/common.js";
import {
  createApprovalBodySchema,
  approvalSchema,
  approvalListResponseSchema,
} from "../schemas/approval.js";
import {
  listApprovals,
  getApprovalById,
  createApproval,
  setApprovalStatus,
  markApprovalExecutionFailed,
  markApprovalExecutionSucceeded,
} from "../db/repositories/approvalRepo.js";
import { logActivity } from "../db/repositories/activityRepo.js";
import { executeAction, ExecutorError } from "../services/executor.js";
import {
  makeCreateConflictChecker,
  type CreateConflictInput,
  type EventConflict,
} from "../services/eventConflicts.js";
import {
  realGoogleEventsFetcher,
  type GoogleEventsFetcher,
} from "../services/googleCalendar.js";

/** Plugin options. `calendarFetcher` is injectable so tests can stub Google. */
export interface ApprovalRouteOptions {
  calendarFetcher?: GoogleEventsFetcher;
}

export async function approvalRoutes(
  app: FastifyInstance,
  opts: ApprovalRouteOptions = {},
): Promise<void> {
  // Recompute create-time clashes for PENDING google_event.create rows on read,
  // so the queue can warn "this overlaps with X" without persisting the warning.
  // Fail-closed per row (checker returns [] on any calendar error).
  const conflictChecker = makeCreateConflictChecker(
    opts.calendarFetcher ?? realGoogleEventsFetcher,
  );

  app.get("/api/approvals", async () => {
    const approvals = listApprovals();
    const conflicts: Record<number, EventConflict[]> = {};
    await Promise.all(
      approvals.map(async (a) => {
        if (
          a.status === "pending" &&
          a.action_type === "google_event.create" &&
          a.payload != null
        ) {
          const found = await conflictChecker(a.payload as CreateConflictInput);
          if (found.length > 0) conflicts[a.id] = found;
        }
      }),
    );
    return {
      ...approvalListResponseSchema.parse({ approvals }),
      conflicts,
    };
  });

  app.post("/api/approvals", async (req, reply) => {
    const body = createApprovalBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0].message });
    }
    const approval = createApproval(body.data.action_type, body.data.payload);
    logActivity("approval.create", `approval #${approval.id} (${approval.action_type})`);
    return reply.code(201).send(approvalSchema.parse(approval));
  });

  app.post("/api/approvals/:id/approve", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Invalid approval id" });
    }
    const approval = getApprovalById(params.data.id);
    if (!approval) return reply.code(404).send({ error: "Approval not found" });
    if (approval.status !== "pending") {
      return reply
        .code(409)
        .send({ error: `Approval already ${approval.status}` });
    }

    // Execute the approved action. Failure leaves the approval pending so it can
    // be retried or rejected — it is NOT marked approved.
    try {
      const result = await executeAction(approval.action_type, approval.payload);
      const updated = markApprovalExecutionSucceeded(
        approval.id,
        result.summary,
        result.undoJson ?? null,
      );
      logActivity(
        "approval.approve",
        `approval #${approval.id}: ${result.summary}`,
      );
      return approvalSchema.parse(updated);
    } catch (err) {
      if (err instanceof ExecutorError) {
        const updated = markApprovalExecutionFailed(approval.id, err.message);
        logActivity(
          "approval.execute_failed",
          `approval #${approval.id}: ${err.message}`,
        );
        return reply
          .code(422)
          .send({ error: err.message, approval: approvalSchema.parse(updated) });
      }
      throw err;
    }
  });

  app.post("/api/approvals/:id/reject", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Invalid approval id" });
    }
    const approval = getApprovalById(params.data.id);
    if (!approval) return reply.code(404).send({ error: "Approval not found" });
    if (approval.status !== "pending") {
      return reply
        .code(409)
        .send({ error: `Approval already ${approval.status}` });
    }
    const updated = setApprovalStatus(approval.id, "rejected");
    logActivity("approval.reject", `approval #${approval.id}`);
    return approvalSchema.parse(updated);
  });
}
