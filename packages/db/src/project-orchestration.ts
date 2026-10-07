import { validateTaskDependency } from "@humanthread/orchestration-core";
import { OrchestrationPersistenceError } from "./orchestration-events";

export async function updateProjectGovernance(input: {
  tx: { project: { updateMany(args: unknown): Promise<{ count: number }> } };
  projectId: string;
  expectedVersion: number;
  data: Record<string, unknown>;
}): Promise<void> {
  const result = await input.tx.project.updateMany({
    where: { id: input.projectId, version: input.expectedVersion },
    data: { ...input.data, version: { increment: 1 } },
  });
  if (result.count !== 1) {
    throw new OrchestrationPersistenceError("version_conflict", `Project version conflict: ${input.projectId}`);
  }
}

export async function addTaskDependencyRecord(input: {
  tx: {
    taskDependency: {
      findMany(args: unknown): Promise<Array<{ predecessorTaskId: string; successorTaskId: string; type: string }>>;
      create(args: unknown): Promise<unknown>;
    };
  };
  dependency: {
    id: string;
    projectId: string;
    predecessorTaskId: string;
    successorTaskId: string;
    type: "blocks" | "relates";
    createdByActor: string;
  };
}): Promise<void> {
  const existingDependencies = await input.tx.taskDependency.findMany({
    where: { projectId: input.dependency.projectId },
    select: { predecessorTaskId: true, successorTaskId: true, type: true },
  });
  const validation = validateTaskDependency({
    predecessorTaskId: input.dependency.predecessorTaskId,
    successorTaskId: input.dependency.successorTaskId,
    existingDependencies,
  });
  if (!validation.ok) {
    throw new OrchestrationPersistenceError("validation_failed", validation.reason);
  }
  await input.tx.taskDependency.create({ data: input.dependency });
}
