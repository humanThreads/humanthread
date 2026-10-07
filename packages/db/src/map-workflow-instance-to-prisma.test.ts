import { describe, expect, it } from "vitest";
import type { WorkflowTemplate } from "@humanthread/shared";
import { createWorkflowInstance } from "../../workflow-core/src/index";
import { mapCreateWorkflowInstanceResultToPrisma } from "./persistence";

describe("mapCreateWorkflowInstanceResultToPrisma", () => {
  it("maps workflow, task, and events into Prisma-friendly create payloads", () => {
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

    const mapped = mapCreateWorkflowInstanceResultToPrisma({
      teamId: "team_1",
      result,
    });

    expect(mapped.workflow).toMatchObject({
      id: "workflow_1",
      teamId: "team_1",
      projectId: "project_1",
      matterTypeId: "matter_dev",
      workflowTemplateId: "template_dev",
      currentStepKey: "confirm_requirement",
    });
    expect(mapped.tasks).toHaveLength(1);
    expect(mapped.tasks[0]).toMatchObject({
      id: "workflow_1:confirm_requirement",
      teamId: "team_1",
      workflowInstanceId: "workflow_1",
      projectId: "project_1",
      title: "确认需求",
      status: "pending",
      executorType: "human",
      assigneeUserId: "user_owner",
    });
    expect(mapped.events).toHaveLength(2);
    expect(mapped.events[0]).toMatchObject({
      id: "workflow_1:workflow_created",
      workflowInstanceId: "workflow_1",
      type: "workflow_created",
    });
  });
});
