import { describe, expect, it, vi } from "vitest";
import { getWorkbenchWorkflowDetail } from "./workbench-workflow-detail";

describe("getWorkbenchWorkflowDetail", () => {
  it("loads workflow tasks ordered for the detail page", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "workflow_1",
      title: "实现工作台",
      description: "重做 Web 工作台",
      status: "active",
      currentStepKey: "run_cli",
      createdAt: new Date("2026-05-19T00:00:00.000Z"),
      updatedAt: new Date("2026-05-19T01:00:00.000Z"),
      project: {
        id: "project_1",
        name: "HumanThread",
        localPath: "/repo",
        defaultCommand: "codex",
      },
      matterType: {
        id: "matter_dev",
        name: "开发任务",
      },
      tasks: [
        {
          id: "task_1",
          title: "运行 CLI",
          status: "active",
          queuePosition: 0,
          stepTemplateId: "step_run_cli",
          assignee: {
            id: "user_owner",
            name: "Owner",
          },
          updatedAt: new Date("2026-05-19T01:00:00.000Z"),
        },
      ],
    });

    const result = await getWorkbenchWorkflowDetail({
      workflowId: "workflow_1",
      db: {
        workflowInstance: {
          findUnique,
        },
      },
    });

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "workflow_1",
        },
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.tasks[0]?.title).toBe("运行 CLI");
    expect(result!.project.name).toBe("HumanThread");
  });
});
