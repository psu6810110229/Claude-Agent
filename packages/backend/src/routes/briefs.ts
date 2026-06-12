import type { FastifyInstance, FastifyReply } from "fastify";
import { approvalSchema } from "../schemas/approval.js";
import type { BriefType } from "../schemas/brief.js";
import { createApproval } from "../db/repositories/approvalRepo.js";
import { logActivity } from "../db/repositories/activityRepo.js";
import { runBrief } from "../services/brief.js";
import type { ClaudeInvoker } from "../services/claudeClient.js";
import { defaultInvoker } from "../services/aiProvider.js";
import {
  realGoogleEventsFetcher,
  type GoogleEventsFetcher,
} from "../services/googleCalendar.js";

/** Plugin options. Both injectables let tests stub Claude / Google Calendar. */
export interface BriefRouteOptions {
  aiInvoker?: ClaudeInvoker;
  calendarFetcher?: GoogleEventsFetcher;
}

/**
 * Brief routes (Step 8) — Daily Brief and Evening Review.
 *
 * Both are PROPOSAL-ONLY and AI-gated, reusing the Step 6 Claude runtime and the
 * existing approval queue. A brief returns a human-readable summary; any
 * suggested change becomes a *pending* approval via `createApproval`. Nothing
 * executes here, briefs are never persisted, and full brief text is never
 * written to the activity log. The action allowlist is unchanged.
 */
export async function briefRoutes(
  app: FastifyInstance,
  opts: BriefRouteOptions,
): Promise<void> {
  const invoke = opts.aiInvoker ?? defaultInvoker();
  const fetchGoogle = opts.calendarFetcher ?? realGoogleEventsFetcher;

  app.post("/api/briefs/daily", (_req, reply) =>
    handleBrief("daily", invoke, fetchGoogle, reply),
  );
  app.post("/api/briefs/evening", (_req, reply) =>
    handleBrief("evening", invoke, fetchGoogle, reply),
  );
}

async function handleBrief(
  type: BriefType,
  invoke: ClaudeInvoker,
  fetchGoogle: GoogleEventsFetcher,
  reply: FastifyReply,
): Promise<unknown> {
  logActivity(`brief.${type}.requested`);

  const result = await runBrief(type, invoke, fetchGoogle);

  // Spawn/timeout/disabled/empty errors: fail closed, create zero approvals.
  if (result.kind === "failed") {
    logActivity(`brief.${type}.failed`, `${result.reason}: ${result.message}`);
    const code =
      result.reason === "timeout"
        ? 504
        : result.reason === "disabled"
          ? 503
          : 502;
    return reply.code(code).send({ kind: "error", error: result.message });
  }

  // Invalid JSON / schema failure / unknown action type: reject, zero approvals.
  if (result.kind === "rejected") {
    logActivity(`brief.${type}.rejected`, result.message);
    return reply.code(400).send({ kind: "error", error: result.message });
  }

  // Valid brief. Any proposed actions become pending approvals (the output was
  // already validated against the strict brief schema, which reuses the
  // canonical action payload schemas). The brief text itself is returned only —
  // it is never persisted and never written to the activity log.
  const approvals = result.actions.map((action) => {
    const approval = createApproval(action.action_type, action.payload);
    logActivity(
      `brief.${type}.proposed`,
      `approval #${approval.id} (${approval.action_type}) from brief`,
    );
    return approvalSchema.parse(approval);
  });

  // Detail is a count only — never the summary text.
  logActivity(
    `brief.${type}.generated`,
    `${approvals.length} proposal(s)`,
  );

  return reply.code(200).send({
    kind: "brief",
    type,
    summary: result.summary,
    notes: result.notes,
    approvals,
  });
}
