type LegacyWorkflowTaskInput = {
  id: string;
  workflowInstanceId?: string | null;
  projectId?: string | null;
  stepTemplateId?: string | null;
  workflowInstance?: unknown | null;
  project?: unknown | null;
};

type LoadedLegacyWorkflowTask<T extends LegacyWorkflowTaskInput> = T
  & (T extends { workflowInstanceId?: unknown } ? { workflowInstanceId: string } : unknown)
  & (T extends { projectId?: unknown } ? { projectId: string } : unknown)
  & (T extends { stepTemplateId?: unknown } ? { stepTemplateId: string } : unknown)
  & (T extends { workflowInstance?: infer TWorkflow }
    ? { workflowInstance: NonNullable<TWorkflow> }
    : unknown)
  & (T extends { project?: infer TProject }
    ? { project: NonNullable<TProject> }
    : unknown);

export class LegacyWorkflowTaskRequiredError extends Error {
  readonly code = "legacy_workflow_task_required";

  constructor(taskId: string) {
    super(`Task ${taskId} is not linked to a legacy Workflow`);
    this.name = "LegacyWorkflowTaskRequiredError";
  }
}

export function assertLegacyWorkflowTask<T extends LegacyWorkflowTaskInput>(
  task: T,
): asserts task is LoadedLegacyWorkflowTask<T> {
  if (!isLegacyWorkflowTask(task)) {
    throw new LegacyWorkflowTaskRequiredError(task.id);
  }
}

export function isLegacyWorkflowTask<T extends LegacyWorkflowTaskInput>(
  task: T,
): task is LoadedLegacyWorkflowTask<T> {
  const hasLegacyField = "workflowInstanceId" in task
    || "projectId" in task
    || "stepTemplateId" in task
    || "workflowInstance" in task
    || "project" in task;

  return Boolean(hasLegacyField
    && (!("workflowInstanceId" in task) || task.workflowInstanceId)
    && (!("projectId" in task) || task.projectId)
    && (!("stepTemplateId" in task) || task.stepTemplateId)
    && (!("workflowInstance" in task) || task.workflowInstance)
    && (!("project" in task) || task.project));
}
