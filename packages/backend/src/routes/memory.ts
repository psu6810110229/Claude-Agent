import type { FastifyInstance } from "fastify";
import {
  memoryListResponseSchema,
  memoryContentResponseSchema,
  memoryTargetParamSchema,
  createMemoryProposalBodySchema,
} from "../schemas/memory.js";
import { approvalSchema } from "../schemas/approval.js";
import { listMemoryEntries } from "../db/repositories/memoryRepo.js";
import { createApproval } from "../db/repositories/approvalRepo.js";
import { logActivity } from "../db/repositories/activityRepo.js";
import { readMemory, memoryRelPath } from "../services/memoryStore.js";

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  // List indexed memory entries (what has been written/approved so far).
  app.get("/api/memory", async () => {
    return memoryListResponseSchema.parse({ entries: listMemoryEntries() });
  });

  // Read one whitelisted memory file. Unknown target -> 404 (no path escape).
  app.get("/api/memory/:target/content", async (req, reply) => {
    const params = memoryTargetParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(404).send({ error: "Unknown memory target" });
    }
    const { target } = params.data;
    const { exists, content } = readMemory(target);
    return memoryContentResponseSchema.parse({
      target,
      path: memoryRelPath(target),
      exists,
      content,
    });
  });

  // Propose a memory write/edit -> goes into the existing approval queue as a
  // `memory.write` action. Nothing is written until that approval is approved.
  app.post("/api/memory/proposals", async (req, reply) => {
    const body = createMemoryProposalBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0].message });
    }
    const approval = createApproval("memory.write", body.data);
    logActivity(
      "memory.propose",
      `approval #${approval.id}: ${body.data.mode} memory '${body.data.target}'`,
    );
    return reply.code(201).send(approvalSchema.parse(approval));
  });
}
