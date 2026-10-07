import { describe, expect, it, vi } from "vitest";
import type { Task, WorkflowInstance, WorkflowTemplate } from "@humanthread/shared";
import {
  blockTask,
  completeTask,
  interruptTask,
  startTask,
} from "../../workflow-core/src/index";
import {
  persistBlockedTaskResult,
  persistCompletedTaskResult,
  persistInterruptedTaskResult,
  persistStartedTaskResult,
} from "./task-state-records";

describe("persistStartedTaskResult", () => {
  it("updates the task, workflow timestamp, and creates a task_started event in one transaction", async () => {
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

    const workflowUpdate = vi.fn().mockResolvedValue(undefined);
    const taskUpdate = vi.fn().mockResolvedValue(undefined);
    const eventCreateMany = vi.fn().mockResolvedValue(undefined);
    const orchestrationEventCreateMany = vi.fn().mockResolvedValue(undefined);
    const outboxCreateMany = vi.fn().mockResolvedValue(undefined);
    const sequenceUpsert = vi.fn().mockResolvedValue({ sequence: 1 });
    const transaction = vi.fn(async (callback) =>
      callback({
        workflowInstance: { update: workflowUpdate },
        task: { update: taskUpdate },
        taskEvent: { createMany: eventCreateMany },
        orchestrationAggregateSequence: { upsert: sequenceUpsert },
        orchestrationEvent: { createMany: orchestrationEventCreateMany },
        outboxMessage: { createMany: outboxCreateMany },
      }),
    );

    await persistStartedTaskResult({
      db: { $transaction: transaction },
      result,
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(workflowUpdate).toHaveBeenCalledWith({
      where: { id: "workflow_1" },
      data: expect.objectContaining({
        updatedAt: new Date("2026-05-18T12:01:00.000Z"),
      }),
    });
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: "workflow_1:confirm_requirement" },
      data: expect.objectContaining({
        status: "active",
        startedAt: new Date("2026-05-18T12:01:00.000Z"),
        updatedAt: new Date("2026-05-18T12:01:00.000Z"),
      }),
    });
    expect(eventCreateMany).toHaveBeenCalledWith({
      data: [
        {
          id: "workflow_1:confirm_requirement:task_started",
          taskId: "workflow_1:confirm_requirement",
          workflowInstanceId: "workflow_1",
          type: "task_started",
          actorType: "human",
          actorUserId: "user_owner",
          createdAt: new Date("2026-05-18T12:01:00.000Z"),
        },
      ],
    });
    expect(sequenceUpsert).toHaveBeenCalledTimes(1);
    expect(orchestrationEventCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        id: "legacy:workflow_1:confirm_requirement:task_started",
        eventType: "task.started",
        sequence: 1,
      })],
    });
    expect(outboxCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ id: "outbox:legacy:workflow_1:confirm_requirement:task_started" })],
    });
  });
});

describe("persistCompletedTaskResult", () => {
  it("updates workflow and completed task, creates next task, and appends events in one transaction", async () => {
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
      status: "active",
      executorType: "human",
      assigneeUserId: "user_owner",
      queuePosition: 0,
      startedAt: new Date("2026-05-18T12:01:00.000Z"),
      createdAt: new Date("2026-05-18T12:00:00.000Z"),
      updatedAt: new Date("2026-05-18T12:01:00.000Z"),
    };

    const result = completeTask({
      workflow,
      task,
      template,
      actorUserId: "user_owner",
      now: new Date("2026-05-18T12:05:00.000Z"),
    });

    const workflowUpdate = vi.fn().mockResolvedValue(undefined);
    const taskUpdate = vi.fn().mockResolvedValue(undefined);
    const taskCreate = vi.fn().mockResolvedValue(undefined);
    const eventCreateMany = vi.fn().mockResolvedValue(undefined);
    const transaction = vi.fn(async (callback) =>
      callback({
        workflowInstance: { update: workflowUpdate },
        task: { update: taskUpdate, create: taskCreate },
        taskEvent: { createMany: eventCreateMany },
      }),
    );

    await persistCompletedTaskResult({
      db: { $transaction: transaction },
      teamId: "team_1",
      result,
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(workflowUpdate).toHaveBeenCalledWith({
      where: { id: "workflow_1" },
      data: {
        currentStepKey: "run_cli",
        status: "running",
        updatedAt: new Date("2026-05-18T12:05:00.000Z"),
      },
    });
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: "workflow_1:confirm_requirement" },
      data: {
        status: "completed",
        completedAt: new Date("2026-05-18T12:05:00.000Z"),
        updatedAt: new Date("2026-05-18T12:05:00.000Z"),
      },
    });
    expect(taskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "workflow_1:run_cli",
        teamId: "team_1",
        workflowInstanceId: "workflow_1",
        status: "pending",
      }),
    });
    expect(eventCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          id: "workflow_1:confirm_requirement:task_completed",
          type: "task_completed",
        }),
        expect.objectContaining({
          id: "workflow_1:run_cli:task_created",
          type: "task_created",
        }),
      ],
    });
  });
});

describe("persistBlockedTaskResult", () => {
  it("updates workflow and task to blocked and appends a task_blocked event", async () => {
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

    const result = blockTask({
      workflow,
      task,
      actorUserId: "user_owner",
      reason: "等待产品确认",
      now: new Date("2026-05-18T12:02:00.000Z"),
    });

    const workflowUpdate = vi.fn().mockResolvedValue(undefined);
    const taskUpdate = vi.fn().mockResolvedValue(undefined);
    const eventCreateMany = vi.fn().mockResolvedValue(undefined);
    const transaction = vi.fn(async (callback) =>
      callback({
        workflowInstance: { update: workflowUpdate },
        task: { update: taskUpdate },
        taskEvent: { createMany: eventCreateMany },
      }),
    );

    await persistBlockedTaskResult({
      db: { $transaction: transaction },
      result,
    });

    expect(workflowUpdate).toHaveBeenCalledWith({
      where: { id: "workflow_1" },
      data: {
        currentStepKey: "confirm_requirement",
        status: "blocked",
        updatedAt: new Date("2026-05-18T12:02:00.000Z"),
      },
    });
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: "workflow_1:confirm_requirement" },
      data: expect.objectContaining({
        status: "blocked",
        updatedAt: new Date("2026-05-18T12:02:00.000Z"),
      }),
    });
    expect(eventCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          id: "workflow_1:confirm_requirement:task_blocked",
          type: "task_blocked",
          message: "等待产品确认",
        }),
      ],
    });
  });
});

describe("persistInterruptedTaskResult", () => {
  it("updates the task to interrupted and appends a task_interrupted event", async () => {
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

    const result = interruptTask({
      workflow,
      task,
      actorUserId: "user_owner",
      reason: "去处理紧急问题",
      now: new Date("2026-05-18T12:02:00.000Z"),
    });

    const workflowUpdate = vi.fn().mockResolvedValue(undefined);
    const taskUpdate = vi.fn().mockResolvedValue(undefined);
    const eventCreateMany = vi.fn().mockResolvedValue(undefined);
    const transaction = vi.fn(async (callback) =>
      callback({
        workflowInstance: { update: workflowUpdate },
        task: { update: taskUpdate },
        taskEvent: { createMany: eventCreateMany },
      }),
    );

    await persistInterruptedTaskResult({
      db: { $transaction: transaction },
      result,
    });

    expect(workflowUpdate).toHaveBeenCalledWith({
      where: { id: "workflow_1" },
      data: expect.objectContaining({
        updatedAt: new Date("2026-05-18T12:02:00.000Z"),
      }),
    });
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: "workflow_1:confirm_requirement" },
      data: expect.objectContaining({
        status: "interrupted",
        updatedAt: new Date("2026-05-18T12:02:00.000Z"),
      }),
    });
    expect(eventCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          id: "workflow_1:confirm_requirement:task_interrupted",
          type: "task_interrupted",
          message: "去处理紧急问题",
        }),
      ],
    });
  });
});
