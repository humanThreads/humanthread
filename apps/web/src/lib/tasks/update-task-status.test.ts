import { describe, expect, it, vi } from "vitest";
import type { Task, WorkflowInstance, WorkflowTemplate } from "@humanthread/shared";
import {
  blockTaskForUser,
  completeTaskForUser,
  interruptTaskForUser,
  startTaskForUser,
} from "./update-task-status";
import { resetLegacyTaskUsage, getLegacyTaskUsageSnapshot } from "./task-rollout";

describe("startTaskForUser", () => {
  it("starts a task and persists the status transition", async () => {
    resetLegacyTaskUsage();
    const workflow: WorkflowInstance = {
      id: "workflow_1",
      projectId: "project_1",
      matterTypeId: "matter_dev",
      workflowTemplateId: "template_dev_v1",
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

    const persist = vi.fn().mockResolvedValue(undefined);

    const result = await startTaskForUser(
      {
        actorUserId: "user_owner",
        now: new Date("2026-05-18T12:01:00.000Z"),
      },
      {
        loadTaskContext: vi.fn().mockResolvedValue({
          workflow,
          task,
        }),
        persist,
      },
    );

    expect(result.task.status).toBe("active");
    expect(result.events.map((event) => event.type)).toEqual(["task_started"]);
    expect(persist).toHaveBeenCalledWith({
      result,
    });
    expect(getLegacyTaskUsageSnapshot().writes).toBe(1);
  });
});

describe("completeTaskForUser", () => {
  it("completes a task, advances workflow, and persists the transition", async () => {
    const workflow: WorkflowInstance = {
      id: "workflow_1",
      projectId: "project_1",
      matterTypeId: "matter_dev",
      workflowTemplateId: "template_dev_v1",
      title: "实现登录页",
      description: "完成登录页和基础校验。",
      status: "running",
      currentStepKey: "confirm_requirement",
      createdById: "user_owner",
      createdAt: new Date("2026-05-18T12:00:00.000Z"),
      updatedAt: new Date("2026-05-18T12:01:00.000Z"),
    };
    const task: Task = {
      id: "workflow_1:confirm_requirement",
      workflowInstanceId: "workflow_1",
      projectId: "project_1",
      stepTemplateId: "step_confirm_requirement",
      title: "确认需求",
      description: "确认需求边界、约束和验收标准。",
      status: "active",
      executorType: "human",
      assigneeUserId: "user_owner",
      queuePosition: 0,
      startedAt: new Date("2026-05-18T12:01:00.000Z"),
      createdAt: new Date("2026-05-18T12:00:00.000Z"),
      updatedAt: new Date("2026-05-18T12:01:00.000Z"),
    };
    const template: WorkflowTemplate = {
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

    const persist = vi.fn().mockResolvedValue(undefined);

    const result = await completeTaskForUser(
      {
        teamId: "team_1",
        actorUserId: "user_owner",
        now: new Date("2026-05-18T12:05:00.000Z"),
      },
      {
        loadTaskContext: vi.fn().mockResolvedValue({
          workflow,
          task,
          template,
        }),
        persist,
      },
    );

    expect(result.completedTask.status).toBe("completed");
    expect(result.nextTask?.id).toBe("workflow_1:run_cli");
    expect(result.events.map((event) => event.type)).toEqual([
      "task_completed",
      "task_created",
    ]);
    expect(persist).toHaveBeenCalledWith({
      teamId: "team_1",
      result,
    });
  });
});

describe("blockTaskForUser", () => {
  it("blocks a task and persists the transition", async () => {
    const workflow: WorkflowInstance = {
      id: "workflow_1",
      projectId: "project_1",
      matterTypeId: "matter_dev",
      workflowTemplateId: "template_dev_v1",
      title: "实现登录页",
      description: "完成登录页和基础校验。",
      status: "running",
      currentStepKey: "confirm_requirement",
      createdById: "user_owner",
      createdAt: new Date("2026-05-18T12:00:00.000Z"),
      updatedAt: new Date("2026-05-18T12:01:00.000Z"),
    };
    const task: Task = {
      id: "workflow_1:confirm_requirement",
      workflowInstanceId: "workflow_1",
      projectId: "project_1",
      stepTemplateId: "step_confirm_requirement",
      title: "确认需求",
      description: "确认需求边界、约束和验收标准。",
      status: "active",
      executorType: "human",
      assigneeUserId: "user_owner",
      queuePosition: 0,
      startedAt: new Date("2026-05-18T12:01:00.000Z"),
      createdAt: new Date("2026-05-18T12:00:00.000Z"),
      updatedAt: new Date("2026-05-18T12:01:00.000Z"),
    };

    const persist = vi.fn().mockResolvedValue(undefined);

    const result = await blockTaskForUser(
      {
        actorUserId: "user_owner",
        reason: "等待产品确认",
        now: new Date("2026-05-18T12:03:00.000Z"),
      },
      {
        loadTaskContext: vi.fn().mockResolvedValue({
          workflow,
          task,
        }),
        persist,
      },
    );

    expect(result.task.status).toBe("blocked");
    expect(result.workflow.status).toBe("blocked");
    expect(result.events.map((event) => event.type)).toEqual(["task_blocked"]);
    expect(persist).toHaveBeenCalledWith({
      result,
    });
  });
});

describe("interruptTaskForUser", () => {
  it("interrupts a task and persists the transition", async () => {
    const workflow: WorkflowInstance = {
      id: "workflow_1",
      projectId: "project_1",
      matterTypeId: "matter_dev",
      workflowTemplateId: "template_dev_v1",
      title: "实现登录页",
      description: "完成登录页和基础校验。",
      status: "running",
      currentStepKey: "confirm_requirement",
      createdById: "user_owner",
      createdAt: new Date("2026-05-18T12:00:00.000Z"),
      updatedAt: new Date("2026-05-18T12:01:00.000Z"),
    };
    const task: Task = {
      id: "workflow_1:confirm_requirement",
      workflowInstanceId: "workflow_1",
      projectId: "project_1",
      stepTemplateId: "step_confirm_requirement",
      title: "确认需求",
      description: "确认需求边界、约束和验收标准。",
      status: "active",
      executorType: "human",
      assigneeUserId: "user_owner",
      queuePosition: 0,
      startedAt: new Date("2026-05-18T12:01:00.000Z"),
      createdAt: new Date("2026-05-18T12:00:00.000Z"),
      updatedAt: new Date("2026-05-18T12:01:00.000Z"),
    };

    const persist = vi.fn().mockResolvedValue(undefined);

    const result = await interruptTaskForUser(
      {
        actorUserId: "user_owner",
        reason: "去处理紧急问题",
        now: new Date("2026-05-18T12:03:00.000Z"),
      },
      {
        loadTaskContext: vi.fn().mockResolvedValue({
          workflow,
          task,
        }),
        persist,
      },
    );

    expect(result.task.status).toBe("interrupted");
    expect(result.workflow.status).toBe("running");
    expect(result.events.map((event) => event.type)).toEqual(["task_interrupted"]);
    expect(persist).toHaveBeenCalledWith({
      result,
    });
  });
});
