import { describe, expect, it } from "vitest";
import type { Task, WorkflowInstance } from "@humanthread/shared";
import { blockTask, followUpTask, interruptTask, transferTask } from "./index";

describe("blockTask", () => {
  it("marks the task as blocked and records a task_blocked event", () => {
    const workflow: WorkflowInstance = {
      id: "workflow_1",
      projectId: "project_1",
      matterTypeId: "matter_dev",
      workflowTemplateId: "template_dev_v1",
      title: "实现通知页",
      description: "完成通知页和提醒交互。",
      status: "running",
      currentStepKey: "confirm_requirement",
      createdById: "user_owner",
      createdAt: new Date("2026-05-19T00:00:00.000Z"),
      updatedAt: new Date("2026-05-19T00:00:00.000Z"),
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
      startedAt: new Date("2026-05-19T00:01:00.000Z"),
      createdAt: new Date("2026-05-19T00:00:00.000Z"),
      updatedAt: new Date("2026-05-19T00:01:00.000Z"),
    };

    const result = blockTask({
      workflow,
      task,
      actorUserId: "user_owner",
      reason: "等待产品确认",
      now: new Date("2026-05-19T00:02:00.000Z"),
    });

    expect(result.task.status).toBe("blocked");
    expect(result.workflow.status).toBe("blocked");
    expect(result.events[0]).toMatchObject({
      type: "task_blocked",
      actorUserId: "user_owner",
      message: "等待产品确认",
    });
  });
});

describe("interruptTask", () => {
  it("marks the task as interrupted and records a task_interrupted event", () => {
    const workflow: WorkflowInstance = {
      id: "workflow_1",
      projectId: "project_1",
      matterTypeId: "matter_dev",
      workflowTemplateId: "template_dev_v1",
      title: "实现通知页",
      description: "完成通知页和提醒交互。",
      status: "running",
      currentStepKey: "confirm_requirement",
      createdById: "user_owner",
      createdAt: new Date("2026-05-19T00:00:00.000Z"),
      updatedAt: new Date("2026-05-19T00:00:00.000Z"),
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
      startedAt: new Date("2026-05-19T00:01:00.000Z"),
      createdAt: new Date("2026-05-19T00:00:00.000Z"),
      updatedAt: new Date("2026-05-19T00:01:00.000Z"),
    };

    const result = interruptTask({
      workflow,
      task,
      actorUserId: "user_owner",
      reason: "中断去处理紧急问题",
      now: new Date("2026-05-19T00:02:00.000Z"),
    });

    expect(result.task.status).toBe("interrupted");
    expect(result.workflow.status).toBe("running");
    expect(result.events[0]).toMatchObject({
      type: "task_interrupted",
      actorUserId: "user_owner",
      message: "中断去处理紧急问题",
    });
  });
});

describe("followUpTask", () => {
  it("marks the task as follow_up and records a task_follow_up_created event", () => {
    const workflow: WorkflowInstance = {
      id: "workflow_1",
      projectId: "project_1",
      matterTypeId: "matter_dev",
      workflowTemplateId: "template_dev_v1",
      title: "实现通知页",
      description: "完成通知页和提醒交互。",
      status: "running",
      currentStepKey: "confirm_requirement",
      createdById: "user_owner",
      createdAt: new Date("2026-05-19T00:00:00.000Z"),
      updatedAt: new Date("2026-05-19T00:00:00.000Z"),
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
      startedAt: new Date("2026-05-19T00:01:00.000Z"),
      createdAt: new Date("2026-05-19T00:00:00.000Z"),
      updatedAt: new Date("2026-05-19T00:01:00.000Z"),
    };

    const result = followUpTask({
      workflow,
      task,
      actorUserId: "user_owner",
      reason: "需要补充验收边界",
      now: new Date("2026-05-19T00:02:00.000Z"),
    });

    expect(result.task.status).toBe("follow_up");
    expect(result.events[0]).toMatchObject({
      type: "task_follow_up_created",
      message: "需要补充验收边界",
    });
  });
});

describe("transferTask", () => {
  it("marks the task as transferred and reassigns the assignee", () => {
    const workflow: WorkflowInstance = {
      id: "workflow_1",
      projectId: "project_1",
      matterTypeId: "matter_dev",
      workflowTemplateId: "template_dev_v1",
      title: "实现通知页",
      description: "完成通知页和提醒交互。",
      status: "running",
      currentStepKey: "confirm_requirement",
      createdById: "user_owner",
      createdAt: new Date("2026-05-19T00:00:00.000Z"),
      updatedAt: new Date("2026-05-19T00:00:00.000Z"),
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
      startedAt: new Date("2026-05-19T00:01:00.000Z"),
      createdAt: new Date("2026-05-19T00:00:00.000Z"),
      updatedAt: new Date("2026-05-19T00:01:00.000Z"),
    };

    const result = transferTask({
      workflow,
      task,
      actorUserId: "user_owner",
      targetUserId: "user_peer",
      reason: "转交给同组同学继续",
      now: new Date("2026-05-19T00:02:00.000Z"),
    });

    expect(result.task.status).toBe("transferred");
    expect(result.task.assigneeUserId).toBe("user_peer");
    expect(result.events[0]).toMatchObject({
      type: "task_transferred",
      message: "转交给同组同学继续",
    });
  });
});
