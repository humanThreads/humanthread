import { describe, expect, it, vi } from "vitest";
import {
  filterWorkbenchSearchResults,
  searchWorkbenchTasks,
} from "./workbench-search";

describe("workbench search helper", () => {
  it("filters projects, documents, tasks, and members by the query", () => {
    const result = filterWorkbenchSearchResults({
      query: "alpha",
      projects: [
        {
          id: "project_1",
          name: "Alpha 控制台",
          description: "主项目",
          updatedAt: new Date("2026-05-20T00:00:00.000Z"),
        },
        {
          id: "project_2",
          name: "Beta 采集",
          description: "数据采集",
          updatedAt: new Date("2026-05-20T00:00:00.000Z"),
        },
      ],
      documents: [
        {
          id: "doc_1",
          projectId: "project_1",
          projectName: "Alpha 控制台",
          title: "接口说明",
          path: "docs/api.md",
          updatedAt: new Date("2026-05-20T00:00:00.000Z"),
          version: 1,
        },
      ],
      tasks: [
        {
          id: "task_1",
          projectId: "project_1",
          projectName: "Alpha 控制台",
          title: "修复 Alpha 登录",
          status: "active",
          updatedAt: new Date("2026-05-20T00:00:00.000Z"),
          assigneeName: "张三",
          workflowTitle: "主流程",
          href: "/tasks/task_1",
        },
      ],
      members: [
        {
          id: "user_1",
          name: "Alpha 维护者",
          email: "alpha@example.com",
          status: "active",
          lastSeenAt: new Date("2026-05-20T00:00:00.000Z"),
        },
      ],
    });

    expect(result.projects.map((item) => item.id)).toEqual(["project_1"]);
    expect(result.documents.map((item) => item.id)).toEqual(["doc_1"]);
    expect(result.tasks.map((item) => item.id)).toEqual(["task_1"]);
    expect(result.members.map((item) => item.id)).toEqual(["user_1"]);
  });

  it("keeps all records when the query is empty", () => {
    const result = filterWorkbenchSearchResults({
      query: "",
      projects: [
        {
          id: "project_1",
          name: "Alpha",
          description: null,
          updatedAt: new Date("2026-05-20T00:00:00.000Z"),
        },
      ],
      documents: [],
      tasks: [],
      members: [],
    });

    expect(result.projects).toHaveLength(1);
  });

  it("does not treat a legacy Workflow title as the Task identity", () => {
    const result = filterWorkbenchSearchResults({
      query: "legacy-only",
      projects: [],
      documents: [],
      tasks: [{
        id: "task_1",
        projectId: "project_1",
        projectName: "HumanThread",
        title: "用户任务标题",
        status: "todo",
        updatedAt: new Date("2026-07-22T00:00:00.000Z"),
        assigneeName: null,
        workflowTitle: "legacy-only workflow",
        href: "/tasks/task_1",
      }],
      members: [],
    });

    expect(result.tasks).toEqual([]);
  });

  it("queries only visible Task title and Markdown and returns Task links", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      id: "task_private_visible",
      title: "安全发布",
      statusCategory: "todo",
      updatedAt: new Date("2026-07-22T00:00:00.000Z"),
      assignee: null,
      project: null,
    }]);

    await expect(searchWorkbenchTasks({
      userId: "user_1",
      query: "安全",
      db: { task: { findMany } },
    })).resolves.toEqual([expect.objectContaining({
      id: "task_private_visible",
      href: "/tasks/task_private_visible",
      title: "安全发布",
    })]);

    const query = findMany.mock.calls[0]?.[0];
    const serialized = JSON.stringify(query.where);
    expect(serialized).toContain('"space"');
    expect(serialized).toContain('"contentMarkdown"');
    expect(serialized).not.toContain('"workflowInstance"');
  });
});
