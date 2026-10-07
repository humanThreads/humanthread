import { describe, expect, it, vi } from "vitest";
import type { WorkflowTemplate } from "@humanthread/shared";
import { createWorkflowInstance } from "../../workflow-core/src/index";
import { createWorkflowInstanceRecords } from "./workflow-instance-records";

describe("createWorkflowInstanceRecords", () => {
  it("persists workflow, tasks, and events inside one transaction", async () => {
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

    const workflowCreate = vi.fn().mockResolvedValue(undefined);
    const taskCreateMany = vi.fn().mockResolvedValue(undefined);
    const eventCreateMany = vi.fn().mockResolvedValue(undefined);
    const transaction = vi.fn(async (callback) =>
      callback({
        workflowInstance: { create: workflowCreate },
        task: { createMany: taskCreateMany },
        taskEvent: { createMany: eventCreateMany },
      }),
    );

    await createWorkflowInstanceRecords({
      db: { $transaction: transaction },
      teamId: "team_1",
      result,
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(workflowCreate).toHaveBeenCalledTimes(1);
    expect(taskCreateMany).toHaveBeenCalledTimes(1);
    expect(eventCreateMany).toHaveBeenCalledTimes(1);
    expect(workflowCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        id: "workflow_1",
        teamId: "team_1",
        workflowTemplateId: "template_dev",
      },
    });
    expect(taskCreateMany.mock.calls[0]?.[0]).toMatchObject({
      data: [
        {
          id: "workflow_1:confirm_requirement",
          teamId: "team_1",
          workflowInstanceId: "workflow_1",
        },
      ],
    });
    expect(eventCreateMany.mock.calls[0]?.[0]).toMatchObject({
      data: [
        {
          id: "workflow_1:workflow_created",
          workflowInstanceId: "workflow_1",
          type: "workflow_created",
        },
        {
          id: "workflow_1:confirm_requirement:task_created",
          workflowInstanceId: "workflow_1",
          type: "task_created",
        },
      ],
    });
  });
});
