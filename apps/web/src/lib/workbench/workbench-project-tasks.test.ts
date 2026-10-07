import { describe, expect, it, vi } from "vitest";
import { listRecentTasksForProjects } from "./workbench-project-tasks";

describe("workbench project task queries", () => {
  it("loads recent tasks for multiple projects in a single query", async () => {
    const updatedAt = new Date("2026-05-20T00:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "task_1",
        title: "修复登录页",
        status: "active",
        updatedAt,
        project: {
          id: "project_1",
          name: "Alpha 项目",
        },
        assignee: {
          name: "张三",
        },
        workflowInstance: {
          title: "主流程",
        },
      },
    ]);

    const result = await listRecentTasksForProjects({
      projectIds: ["project_1", "project_2"],
      db: {
        task: {
          findMany,
        },
      },
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        projectId: {
          in: ["project_1", "project_2"],
        },
      },
      orderBy: [
        {
          updatedAt: "desc",
        },
        {
          createdAt: "desc",
        },
      ],
      take: 16,
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        project: {
          select: {
            id: true,
            name: true,
          },
        },
        assignee: {
          select: {
            name: true,
          },
        },
        workflowInstance: {
          select: {
            title: true,
          },
        },
      },
    });
    expect(result).toEqual([
      {
        id: "task_1",
        projectId: "project_1",
        projectName: "Alpha 项目",
        title: "修复登录页",
        status: "active",
        updatedAt,
        assigneeName: "张三",
        workflowTitle: "主流程",
      },
    ]);
  });

  it("returns an empty list when there are no projects", async () => {
    const findMany = vi.fn();

    const result = await listRecentTasksForProjects({
      projectIds: [],
      db: {
        task: {
          findMany,
        },
      },
    });

    expect(findMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
