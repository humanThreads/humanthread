import { describe, expect, it, vi } from "vitest";
import type { Task, WorkflowInstance, WorkflowTemplate } from "@humanthread/shared";
import { reportCliTaskStatus } from "./report-cli-task-status";

function createWorkflow(): WorkflowInstance {
  return {
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
}

function createTask(): Task {
  return {
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
}

function createTemplate(): WorkflowTemplate {
  return {
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
}

describe("reportCliTaskStatus", () => {
  it("completes the task and prepends a cli_reported event", async () => {
    const persistCompleted = vi.fn().mockResolvedValue(undefined);

    const result = await reportCliTaskStatus(
      {
        status: "completed",
        exitCode: 0,
        durationSeconds: 120,
        outputSummary: "CLI 已顺利完成",
        payload: {
          command: "codex",
        },
        now: new Date("2026-05-19T00:05:00.000Z"),
      },
      {
        loadTaskContext: vi.fn().mockResolvedValue({
          teamId: "team_1",
          actorUserId: "user_owner",
          workflow: createWorkflow(),
          task: createTask(),
          template: createTemplate(),
        }),
        persistCompleted,
        persistInterrupted: vi.fn(),
        persistBlocked: vi.fn(),
        persistFollowUp: vi.fn(),
      },
    );

    expect(result.reportedStatus).toBe("completed");
    expect(result.task.status).toBe("completed");
    expect(result.nextTask?.id).toBe("workflow_1:run_cli");
    expect(result.events[0]).toMatchObject({
      type: "cli_reported",
      message: "CLI 已顺利完成",
      payload: expect.objectContaining({
        status: "completed",
        exitCode: 0,
        durationSeconds: 120,
        command: "codex",
      }),
    });
    expect(persistCompleted).toHaveBeenCalledTimes(1);
    const completedPersistCall = persistCompleted.mock.calls[0]?.[0];
    expect(completedPersistCall?.teamId).toBe("team_1");
    expect(completedPersistCall?.result.events[0]).toMatchObject({
      type: "cli_reported",
      message: "CLI 已顺利完成",
    });
    expect(completedPersistCall?.result.events[1]).toMatchObject({
      type: "task_completed",
    });
  });

  it("submits every migrated user Task CLI completion for review instead of completing it", async () => {
    const persistCandidate = vi.fn().mockResolvedValue(undefined);
    const persistCompleted = vi.fn();
    const result = await reportCliTaskStatus({
      status: "completed", exitCode: 0, outputSummary: "候选结果已生成", now: new Date("2026-05-19T00:05:00.000Z"),
    }, {
      loadTaskContext: vi.fn().mockResolvedValue({
        teamId: "team_1", actorUserId: "user_owner", workflow: createWorkflow(), task: createTask(), template: createTemplate(),
        userTask: { statusCategory: "in_progress", acceptanceMode: "none", version: 4 },
      }),
      persistCompleted, persistInterrupted: vi.fn(), persistBlocked: vi.fn(), persistFollowUp: vi.fn(), persistCandidate,
    });
    expect(result.task.status).toBe("active");
    expect(result.nextTask).toBeNull();
    expect(result.events.map((event) => event.type)).toEqual(["cli_reported"]);
    expect(persistCompleted).not.toHaveBeenCalled();
    expect(persistCandidate).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "workflow_1:confirm_requirement", actorUserId: "user_owner",
      requestedCommand: "submit_for_review", expectedVersion: 4,
    }));
  });

  it("marks the task interrupted when cli reports non-zero exit without summary", async () => {
    const persistInterrupted = vi.fn().mockResolvedValue(undefined);

    const result = await reportCliTaskStatus(
      {
        status: "interrupted",
        exitCode: 1,
        durationSeconds: 30,
        now: new Date("2026-05-19T00:05:00.000Z"),
      },
      {
        loadTaskContext: vi.fn().mockResolvedValue({
          teamId: "team_1",
          actorUserId: "user_owner",
          workflow: createWorkflow(),
          task: createTask(),
        }),
        persistCompleted: vi.fn(),
        persistInterrupted,
        persistBlocked: vi.fn(),
        persistFollowUp: vi.fn(),
      },
    );

    expect(result.reportedStatus).toBe("interrupted");
    expect(result.task.status).toBe("interrupted");
    expect(result.events[1]).toMatchObject({
      type: "task_interrupted",
      message: "CLI exited with code 1",
    });
    expect(persistInterrupted).toHaveBeenCalledTimes(1);
    expect(persistInterrupted).toHaveBeenCalledWith({
      result: expect.objectContaining({
        events: [
          expect.objectContaining({
            type: "cli_reported",
          }),
          expect.objectContaining({
            type: "task_interrupted",
            message: "CLI exited with code 1",
          }),
        ],
      }),
    });
  });

  it("marks the task as follow_up and records the summary", async () => {
    const persistFollowUp = vi.fn().mockResolvedValue(undefined);

    const result = await reportCliTaskStatus(
      {
        status: "follow_up",
        durationSeconds: 48,
        outputSummary: "需要补充验收边界",
        now: new Date("2026-05-19T00:05:00.000Z"),
      },
      {
        loadTaskContext: vi.fn().mockResolvedValue({
          teamId: "team_1",
          actorUserId: "user_owner",
          workflow: createWorkflow(),
          task: createTask(),
        }),
        persistCompleted: vi.fn(),
        persistInterrupted: vi.fn(),
        persistBlocked: vi.fn(),
        persistFollowUp,
      },
    );

    expect(result.reportedStatus).toBe("follow_up");
    expect(result.task.status).toBe("follow_up");
    expect(result.events.map((event) => event.type)).toEqual([
      "cli_reported",
      "task_follow_up_created",
    ]);
    expect(persistFollowUp).toHaveBeenCalledTimes(1);
    expect(persistFollowUp).toHaveBeenCalledWith({
      result: expect.objectContaining({
        events: [
          expect.objectContaining({
            type: "cli_reported",
            message: "需要补充验收边界",
          }),
          expect.objectContaining({
            type: "task_follow_up_created",
          }),
        ],
      }),
    });
  });
});
