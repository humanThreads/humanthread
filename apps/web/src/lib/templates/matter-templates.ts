import type { WorkflowTemplate } from "@humanthread/shared";

const developmentWorkflowTemplate: WorkflowTemplate = {
  id: "template_dev_v1",
  name: "AI 辅助开发任务",
  version: 1,
  firstStepKey: "confirm_requirement",
  steps: [
    {
      id: "step_confirm_requirement",
      key: "confirm_requirement",
      title: "确认需求",
      description: "确认需求边界、约束和验收标准。",
      executorType: "human",
      nextStepKey: "run_cli",
    },
    {
      id: "step_run_cli",
      key: "run_cli",
      title: "运行 Claude/Codex",
      description: "在本地启动 CLI 执行开发任务。",
      executorType: "human",
      nextStepKey: "review_result",
    },
    {
      id: "step_review_result",
      key: "review_result",
      title: "人工验收结果",
      description: "检查结果是否满足验收标准。",
      executorType: "human",
    },
  ],
};

const matterTemplates: Record<string, WorkflowTemplate> = {
  matter_dev: developmentWorkflowTemplate,
};

export function getWorkflowTemplateByMatterType(
  matterTypeId: string,
): WorkflowTemplate {
  const template = matterTemplates[matterTypeId];

  if (!template) {
    throw new Error(`Unsupported matter type: ${matterTypeId}`);
  }

  return template;
}
