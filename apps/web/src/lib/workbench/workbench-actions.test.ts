import { describe, expect, it, vi } from "vitest";
import type { WorkflowTemplate } from "@humanthread/shared";
import {
  createWorkbenchWorkflow,
  performWorkbenchTaskAction,
} from "./workbench-actions";
import type { WorkbenchContext } from "./workbench-context";

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
      },
    ],
  };
}

function createTaskActionDependencies() {
  return {
    startTaskAction: vi.fn().mockResolvedValue({ ok: true }),
    completeTaskAction: vi.fn().mockResolvedValue({ ok: true }),
    blockTaskAction: vi.fn().mockResolvedValue({ ok: true }),
    interruptTaskAction: vi.fn().mockResolvedValue({ ok: true }),
    followUpTaskAction: vi.fn().mockResolvedValue({ ok: true }),
    transferTaskAction: vi.fn().mockResolvedValue({ ok: true }),
  };
}

const workbenchContext: WorkbenchContext = {
  teamId: "team_1",
  userId: "user_owner",
  projectId: "project_1",
  matterTypeId: "matter_dev",
};

describe("createWorkbenchWorkflow", () => {
  it("creates a workflow with the default workbench context", async () => {
    const getWorkflowTemplateByMatterType = vi.fn().mockReturnValue(createTemplate());
    const createWorkflowFromTemplate = vi.fn().mockResolvedValue({
      workflow: {
        id: "workflow_1",
      },
      tasks: [],
      events: [],
    });

    const result = await createWorkbenchWorkflow(
      {
        title: "  实现登录页  ",
        description: "  完成登录页和基础校验。  ",
        context: workbenchContext,
      },
      {
        getWorkflowTemplateByMatterType,
        createWorkflowFromTemplate,
        createId: () => "workflow_1",
        persist: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(getWorkflowTemplateByMatterType).toHaveBeenCalledWith("matter_dev");
    expect(createWorkflowFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team_1",
        projectId: "project_1",
        matterTypeId: "matter_dev",
        title: "实现登录页",
        description: "完成登录页和基础校验。",
        createdById: "user_owner",
      }),
      {
        createId: expect.any(Function),
        persist: expect.any(Function),
      },
    );
    expect(result.workflow.id).toBe("workflow_1");
  });

  it("rejects an empty title", async () => {
    await expect(
      createWorkbenchWorkflow(
        {
          title: "   ",
          context: workbenchContext,
        },
        {
          getWorkflowTemplateByMatterType: vi.fn(),
          createWorkflowFromTemplate: vi.fn(),
          createId: () => "workflow_1",
          persist: vi.fn(),
        },
      ),
    ).rejects.toThrow("Title is required");
  });
});

describe("performWorkbenchTaskAction", () => {
  it("dispatches complete actions with the default team context", async () => {
    const dependencies = createTaskActionDependencies();

    await performWorkbenchTaskAction(
      {
        taskId: "workflow_1:run_cli",
        actionType: "complete",
        context: workbenchContext,
      },
      dependencies,
    );

    expect(dependencies.completeTaskAction).toHaveBeenCalledWith({
      taskId: "workflow_1:run_cli",
      actorUserId: "user_owner",
      now: expect.any(Date),
    });
  });

  it("trims reason values for reason-based actions", async () => {
    const dependencies = createTaskActionDependencies();

    await performWorkbenchTaskAction(
      {
        taskId: "workflow_1:run_cli",
        actionType: "block",
        reason: "  等待产品确认  ",
        context: workbenchContext,
      },
      dependencies,
    );

    expect(dependencies.blockTaskAction).toHaveBeenCalledWith({
      taskId: "workflow_1:run_cli",
      actorUserId: "user_owner",
      reason: "等待产品确认",
      now: expect.any(Date),
    });
  });

  it("rejects transfer actions without a target user", async () => {
    const dependencies = createTaskActionDependencies();

    await expect(
      performWorkbenchTaskAction(
        {
          taskId: "workflow_1:run_cli",
          actionType: "transfer",
          reason: "转给同组同学继续处理",
          context: workbenchContext,
        },
        dependencies,
      ),
    ).rejects.toThrow("Target user is required");
  });

  it("rejects transfer actions when target user matches actor", async () => {
    const dependencies = createTaskActionDependencies();

    await expect(
      performWorkbenchTaskAction(
        {
          taskId: "workflow_1:run_cli",
          actionType: "transfer",
          reason: "转给同组同学继续处理",
          targetUserId: "user_owner",
          context: workbenchContext,
        },
        dependencies,
      ),
    ).rejects.toThrow("Target user must be different from actor");
  });
});
