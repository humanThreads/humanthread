import { describe, expect, it } from "vitest";
import type { Task, WorkflowInstance, WorkflowTemplate } from "@humanthread/shared";
import { completeTask } from "./index";

describe("completeTask", () => {
  it("completes the current task, advances workflow, and creates the next task", () => {
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
        {
          id: "step_run_cli",
          key: "run_cli",
          title: "运行 Claude/Codex",
          description: "在本地启动 CLI 执行开发任务。",
          executorType: "human",
          assigneeUserId: "user_owner",
        },
      ],
    };

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
      description: "人类确认需求边界和验收标准。",
      status: "active",
      executorType: "human",
      assigneeUserId: "user_owner",
      queuePosition: 0,
      createdAt: new Date("2026-05-18T12:00:00.000Z"),
      updatedAt: new Date("2026-05-18T12:00:00.000Z"),
    };

    const result = completeTask({
      workflow,
      task,
      template,
      actorUserId: "user_owner",
      now: new Date("2026-05-18T12:05:00.000Z"),
    });

    expect(result.workflow).toMatchObject({
      id: "workflow_1",
      currentStepKey: "run_cli",
      status: "running",
    });
    expect(result.completedTask).toMatchObject({
      id: "workflow_1:confirm_requirement",
      status: "completed",
      completedAt: new Date("2026-05-18T12:05:00.000Z"),
    });
    expect(result.nextTask).toMatchObject({
      id: "workflow_1:run_cli",
      title: "运行 Claude/Codex",
      status: "pending",
      executorType: "human",
      assigneeUserId: "user_owner",
    });
    expect(result.events.map((event) => event.type)).toEqual([
      "task_completed",
      "task_created",
    ]);
  });
});
