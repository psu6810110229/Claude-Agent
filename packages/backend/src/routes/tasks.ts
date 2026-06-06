import type { FastifyInstance } from "fastify";
import { idParamSchema } from "../schemas/common.js";
import {
  createTaskBodySchema,
  updateTaskBodySchema,
  taskSchema,
  taskListResponseSchema,
} from "../schemas/task.js";
import {
  listTasks,
  getTaskById,
  createTask,
  updateTask,
  archiveTask,
} from "../db/repositories/taskRepo.js";
import { logActivity } from "../db/repositories/activityRepo.js";

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/tasks", async () => {
    return taskListResponseSchema.parse({ tasks: listTasks() });
  });

  app.post("/api/tasks", async (req, reply) => {
    const body = createTaskBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0].message });
    }
    const task = createTask(body.data.title, body.data.status);
    logActivity("task.create", `task #${task.id} "${task.title}"`);
    return reply.code(201).send(taskSchema.parse(task));
  });

  app.get("/api/tasks/:id", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Invalid task id" });
    }
    const task = getTaskById(params.data.id);
    if (!task) return reply.code(404).send({ error: "Task not found" });
    return taskSchema.parse(task);
  });

  app.patch("/api/tasks/:id", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Invalid task id" });
    }
    const body = updateTaskBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0].message });
    }
    const task = updateTask(params.data.id, body.data);
    if (!task) return reply.code(404).send({ error: "Task not found" });
    logActivity("task.update", `task #${task.id}`);
    return taskSchema.parse(task);
  });

  app.post("/api/tasks/:id/archive", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Invalid task id" });
    }
    const task = archiveTask(params.data.id);
    if (!task) return reply.code(404).send({ error: "Task not found" });
    logActivity("task.archive", `task #${task.id}`);
    return taskSchema.parse(task);
  });
}
