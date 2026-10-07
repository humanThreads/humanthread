import { createKnowledgeGenerationTask, prisma } from "@humanthread/db";

const DEFAULT_TEMPLATE_ENV = "HUMANTHREAD_KNOWLEDGE_TEMPLATE_VERSION_ID";

export async function handleKnowledgeGenerationEvent(
  payload: unknown,
  dependencies: {
    createTask: typeof createKnowledgeGenerationTask;
    templateVersionId?: string;
    now?: () => Date;
  } = {
    createTask: createKnowledgeGenerationTask,
    ...(process.env[DEFAULT_TEMPLATE_ENV] ? { templateVersionId: process.env[DEFAULT_TEMPLATE_ENV]! } : {}),
  },
): Promise<{ created: boolean; jobId?: string }> {
  const event = requireRecord(payload, "Knowledge generation event is invalid");
  if (event.aggregateType !== "task" || event.eventType !== "task.completed") return { created: false };
  const taskId = requiredString(event.aggregateId, "taskId");
  const templateVersionId = dependencies.templateVersionId?.trim();
  if (!templateVersionId) return { created: false };
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true, spaceId: true, title: true, contentMarkdown: true, assigneeUserId: true },
  });
  if (!task?.projectId) return { created: false };
  const actorUserId = task.assigneeUserId ?? "system";
  const result = await dependencies.createTask({
    projectId: task.projectId,
    actorUserId,
    mode: "task_completion",
    dedupeIdentity: `task-completion:${task.id}`,
    templateVersionId,
    sourceSnapshot: {
      observedAt: (dependencies.now?.() ?? new Date()).toISOString(),
      sourceRefs: [{ kind: "task", sourceType: "task_completion", ref: `task:${task.id}` }],
    },
    title: `归纳任务知识：${task.title}`,
    contentMarkdown: task.contentMarkdown,
  });
  return { created: !result.duplicate, jobId: result.jobId };
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}
