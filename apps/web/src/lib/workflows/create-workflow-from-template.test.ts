import { describe, expect, it, vi } from "vitest";
import type { WorkflowTemplate } from "@humanthread/shared";
import { createWorkflowFromTemplate } from "./create-workflow-from-template";

describe("createWorkflowFromTemplate", () => {
  it("creates a workflow instance from template and persists it", async () => {
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
        },
      ],
    };

    const persist = vi.fn().mockResolvedValue(undefined);

    const result = await createWorkflowFromTemplate(
      {
        teamId: "team_1",
        projectId: "project_1",
        matterTypeId: "matter_dev",
        title: "实现登录页",
        description: "完成登录页和基础校验。",
        createdById: "user_owner",
        template,
        now: new Date("2026-05-18T12:00:00.000Z"),
      },
      {
        createId: () => "workflow_1",
        persist,
      },
    );

    expect(result.workflow.id).toBe("workflow_1");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.assigneeUserId).toBe("user_owner");
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith({
      teamId: "team_1",
      result,
    });
  });
});
