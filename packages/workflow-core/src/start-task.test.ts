import { describe, expect, it } from "vitest";
import type { Task, WorkflowInstance } from "@humanthread/shared";
import { startTask } from "./index";

describe("startTask", () => {
  it("marks a pending task as active and records a task_started event", () => {
    const workflow: WorkflowInstance = {
      id: "workflow_1",
      projectId: "project_1",
      matterTypeId: "matter_dev",
      workflowTemplateId: "template_dev",
      title: "实现登录页",
      description: "完成登录页和基础校验。",
      status: "running",
      currentStepKey: "confirm_requirement",
      createdById: "user_owner",
      createdAt: new Date("2026-05-18T12:00:00.000Z"),
      updatedAt: new Date("2026-05-18T12:00:00.000Z"),
    };

    const task: Task = {
      id: "workflow_1:confirm_requirement",
      workflowInstanceId: "workflow_1",
      projectId: "project_1",
      stepTemplateId: "step_confirm_requirement",
      title: "确认需求",
      description: "确认需求边界、约束和验收标准。",
      status: "pending",
      executorType: "human",
      assigneeUserId: "user_owner",
      queuePosition: 0,
      createdAt: new Date("2026-05-18T12:00:00.000Z"),
      updatedAt: new Date("2026-05-18T12:00:00.000Z"),
    };

    const result = startTask({
      workflow,
      task,
      actorUserId: "user_owner",
      now: new Date("2026-05-18T12:01:00.000Z"),
    });

    expect(result.workflow).toMatchObject({
      id: "workflow_1",
      status: "running",
      currentStepKey: "confirm_requirement",
      updatedAt: new Date("2026-05-18T12:01:00.000Z"),
    });
    expect(result.task).toMatchObject({
      id: "workflow_1:confirm_requirement",
      status: "active",
      startedAt: new Date("2026-05-18T12:01:00.000Z"),
      updatedAt: new Date("2026-05-18T12:01:00.000Z"),
    });
    expect(result.events).toEqual([
      expect.objectContaining({
        id: "workflow_1:confirm_requirement:task_started",
        taskId: "workflow_1:confirm_requirement",
        workflowInstanceId: "workflow_1",
        type: "task_started",
        actorType: "human",
        actorUserId: "user_owner",
        createdAt: new Date("2026-05-18T12:01:00.000Z"),
      }),
    ]);
  });
});
