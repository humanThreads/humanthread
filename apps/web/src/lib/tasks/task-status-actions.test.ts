import { describe, expect, it, vi } from "vitest";
import type { WorkflowTemplate } from "@humanthread/shared";
import { normalizeWorkflowTemplateForActor } from "./task-status-actions";

const compatibilityMocks = vi.hoisted(() => ({
  sync: vi.fn().mockResolvedValue({ synced: false, reason: "writes_disabled" }),
}));

vi.mock("./task-compatibility", () => ({
  bestEffortLegacyUserTaskSync: compatibilityMocks.sync,
}));

vi.mock("./update-task-status", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./update-task-status")>();
  return {
    ...actual,
    interruptTaskForUser: vi.fn().mockResolvedValue({ task: { id: "task_1", status: "interrupted" } }),
    followUpTaskForUser: vi.fn().mockResolvedValue({ task: { id: "task_1", status: "follow_up" } }),
    transferTaskForUser: vi.fn().mockResolvedValue({ task: { id: "task_1", status: "transferred" } }),
  };
});

describe("normalizeWorkflowTemplateForActor", () => {
  it("fills missing human assignees with the actor user id", () => {
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
          nextStepKey: "run_cli",
        },
        {
          id: "step_run_cli",
          key: "run_cli",
          title: "运行 Claude/Codex",
          description: "在本地启动 CLI 执行开发任务。",
          executorType: "human",
        },
      ],
    };

    const normalized = normalizeWorkflowTemplateForActor(template, "user_owner");

    expect(normalized.steps[0]?.assigneeUserId).toBe("user_owner");
    expect(normalized.steps[1]?.assigneeUserId).toBe("user_owner");
  });
});

describe("task status action exports", () => {
  it("exposes block and interrupt task actions", async () => {
    const actions = await import("./task-status-actions");

    expect(typeof actions.blockTaskAction).toBe("function");
    expect(typeof actions.interruptTaskAction).toBe("function");
    expect(typeof actions.followUpTaskAction).toBe("function");
    expect(typeof actions.transferTaskAction).toBe("function");
  });

  it("records interrupt, follow-up and transfer compatibility writes after legacy success", async () => {
    const actions = await import("./task-status-actions");

    await actions.interruptTaskAction({ taskId: "task_1", actorUserId: "user_1", reason: "Stopped" });
    await actions.followUpTaskAction({ taskId: "task_1", actorUserId: "user_1", reason: "More work" });
    await actions.transferTaskAction({
      taskId: "task_1",
      actorUserId: "user_1",
      targetUserId: "user_2",
      reason: "Reassigned",
    });

    expect(compatibilityMocks.sync).toHaveBeenNthCalledWith(1, {
      taskId: "task_1",
      actorUserId: "user_1",
      legacyStatus: "interrupted",
      reason: "Stopped",
    });
    expect(compatibilityMocks.sync).toHaveBeenNthCalledWith(2, {
      taskId: "task_1",
      actorUserId: "user_1",
      legacyStatus: "follow_up",
      reason: "More work",
    });
    expect(compatibilityMocks.sync).toHaveBeenNthCalledWith(3, {
      taskId: "task_1",
      actorUserId: "user_1",
      legacyStatus: "transferred",
      reason: "Reassigned",
    });
  });
});
