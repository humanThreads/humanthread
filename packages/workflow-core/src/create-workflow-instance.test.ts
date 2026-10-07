import { describe, expect, it } from "vitest";
import type { WorkflowTemplate } from "@humanthread/shared";
import { createWorkflowInstance } from "./index";

describe("createWorkflowInstance", () => {
  it("creates a workflow instance, first task, and initial events from a template", () => {
    const template: WorkflowTemplate = {
      id: "template_dev",
      name: "AI 辅助开发任务",
      version: 1,
      firstStepKey: "confirm_requirement",
      steps: [
        {
          id: "step_confirm_requirement",
          key: "confirm_requirement",
          title: "确认需求",
          description: "人类确认需求边界和验收标准。",
          executorType: "human",
          assigneeUserId: "user_owner",
          nextStepKey: "run_cli",
        },
      ],
    };

    const result = createWorkflowInstance({
      id: "workflow_1",
      projectId: "project_1",
      matterTypeId: "matter_dev",
      title: "实现登录页",
      description: "完成登录页和基础校验。",
      createdById: "user_owner",
      template,
      now: new Date("2026-05-18T12:00:00.000Z"),
    });

    expect(result.workflow).toMatchObject({
      id: "workflow_1",
      projectId: "project_1",
      matterTypeId: "matter_dev",
      workflowTemplateId: "template_dev",
      title: "实现登录页",
      status: "running",
      currentStepKey: "confirm_requirement",
    });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({
      id: "workflow_1:confirm_requirement",
      workflowInstanceId: "workflow_1",
      projectId: "project_1",
      stepTemplateId: "step_confirm_requirement",
      title: "确认需求",
      status: "pending",
      executorType: "human",
      assigneeUserId: "user_owner",
      queuePosition: 0,
    });
    expect(result.events.map((event) => event.type)).toEqual([
      "workflow_created",
      "task_created",
    ]);
  });
});
