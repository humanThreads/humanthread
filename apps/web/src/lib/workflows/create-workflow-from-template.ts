import type { WorkflowTemplate } from "@humanthread/shared";
import type { CreateWorkflowInstanceResult } from "../../../../../packages/workflow-core/src/index";
import { createWorkflowInstance } from "../../../../../packages/workflow-core/src/index";

export interface CreateWorkflowFromTemplateInput {
  teamId: string;
  projectId: string;
  matterTypeId: string;
  title: string;
  description: string;
  createdById: string;
  template: WorkflowTemplate;
  now: Date;
}

export interface CreateWorkflowFromTemplateDependencies {
  createId: () => string;
  persist: (input: {
    teamId: string;
    result: CreateWorkflowInstanceResult;
  }) => Promise<void>;
}

export async function createWorkflowFromTemplate(
  input: CreateWorkflowFromTemplateInput,
  dependencies: CreateWorkflowFromTemplateDependencies,
): Promise<CreateWorkflowInstanceResult> {
  const normalizedTemplate: WorkflowTemplate = {
    ...input.template,
    steps: input.template.steps.map((step) =>
      step.executorType === "human" && !step.assigneeUserId
        ? {
            ...step,
            assigneeUserId: input.createdById,
          }
        : step,
    ),
  };

  const result = createWorkflowInstance({
    id: dependencies.createId(),
    projectId: input.projectId,
    matterTypeId: input.matterTypeId,
    title: input.title,
    description: input.description,
    createdById: input.createdById,
    template: normalizedTemplate,
    now: input.now,
  });

  await dependencies.persist({
    teamId: input.teamId,
    result,
  });

  return result;
}
