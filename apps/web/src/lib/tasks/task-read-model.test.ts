import { describe, expect, it, vi } from "vitest";
import {
  deleteTaskSavedView,
  deriveLoopRunProgress,
  getTaskCollection,
  getTaskDetailView,
  listTaskSavedViews,
  saveTaskView,
  updateTaskSavedView,
} from "./task-read-model";
import { parseTaskQuery } from "./task-query";

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "task_1",
    title: "登录改造",
    statusCategory: "in_progress",
    visibility: "project",
    priority: 2,
    startAt: null,
    dueAt: new Date("2026-07-23T08:00:00.000Z"),
    version: 3,
    archivedAt: null,
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    updatedAt: new Date("2026-07-22T00:00:00.000Z"),
    createdById: "user_1",
    assigneeUserId: "user_1",
    assignee: { id: "user_1", name: "Owner", avatarUrl: null },
    project: { id: "project_1", name: "HumanThread" },
    statusDefinition: { id: "status_1", name: "开发中", category: "in_progress", color: "#1f883d" },
    members: [],
    blockers: [],
    labelAssignments: [],
    _count: { childTasks: 0 },
    agentRuns: [],
    ...overrides,
  };
}

describe("Task read model", () => {
  it("requests one page and reports whether another page exists", async () => {
    const findMany = vi.fn().mockResolvedValue([taskRow()]);
    const count = vi.fn().mockResolvedValue(101);
    const result = await getTaskCollection({ userId: "user_1", timeZone: "Asia/Shanghai", now: new Date("2026-07-22T00:00:00.000Z"), page: 2, pageSize: 50, query: parseTaskQuery(), db: { task: { findMany, count } } as never });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50, skip: 50 }));
    expect(count).toHaveBeenCalled();
    expect(result).toMatchObject({ total: 101, page: 2, pageSize: 50, hasNextPage: true, hasPreviousPage: true });
  });
  it("builds list and board projections from one visibility-filtered query", async () => {
    const findMany = vi.fn().mockResolvedValue([
      taskRow(),
      taskRow({
        id: "task_2",
        title: "部署说明",
        statusCategory: "todo",
        priority: 0,
        dueAt: null,
        updatedAt: new Date("2026-07-21T00:00:00.000Z"),
      }),
    ]);
    const count = vi.fn().mockResolvedValue(2);
    const result = await getTaskCollection({
      userId: "user_1",
      spaceId: "space_1",
      timeZone: "Asia/Shanghai",
      now: new Date("2026-07-22T00:00:00.000Z"),
      query: parseTaskQuery({
        relation: "assigned",
        status: "todo,in_progress",
        assignee: "user_1",
        priority: "0,2",
        project: "project_1",
        dateFrom: "2026-07-01",
        dateTo: "2026-07-31",
        group: "status",
        sort: "updated_desc",
        search: "发布",
      }),
      db: { task: { findMany, count } },
    });

    const serializedWhere = JSON.stringify(findMany.mock.calls[0]?.[0].where);
    expect(serializedWhere).toContain('"spaceId":"space_1"');
    expect(serializedWhere).toContain('"assigneeUserId":"user_1"');
    expect(serializedWhere).toContain('"statusCategory"');
    expect(serializedWhere).toContain('"archivedAt":null');
    expect(count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ archivedAt: { not: null } })]) }),
    }));
    expect(serializedWhere).toContain('"contentMarkdown"');
    expect(serializedWhere).toContain('"contains":"发布"');
    expect(result.listRows.map((row) => row.id)).toEqual(["task_1", "task_2"]);
    expect(result.boardGroups.map((group) => group.key)).toEqual(["in_progress", "todo"]);
    expect(result.boardGroups.flatMap((group) => group.tasks)).toEqual(result.listRows);
  });

  it("filters blocked tasks through active blocker facts", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);

    await getTaskCollection({
      userId: "user_1",
      timeZone: "Asia/Shanghai",
      query: parseTaskQuery({ relation: "blocked" }),
      db: { task: { findMany, count } },
    });

    expect(JSON.stringify(findMany.mock.calls[0]?.[0].where)).toContain(
      '"blockers":{"some":{"status":"active"}}',
    );
  });

  it("lists archived tasks only for the archived relation while counting them separately", async () => {
    const findMany = vi.fn().mockResolvedValue([
      taskRow({ id: "task_archived_1", title: "已归档发布", archivedAt: new Date("2026-08-01T00:00:00.000Z") }),
    ]);
    const count = vi.fn().mockResolvedValue(1);

    const result = await getTaskCollection({
      userId: "user_1",
      timeZone: "Asia/Shanghai",
      query: parseTaskQuery({ relation: "archived" }),
      db: { task: { findMany, count } },
    });

    const serializedWhere = JSON.stringify(findMany.mock.calls[0]?.[0].where);
    expect(serializedWhere).toContain('"archivedAt":{"not":null}');
    expect(serializedWhere).not.toContain('"archivedAt":null');
    expect(result.listRows).toHaveLength(1);
    expect(result.listRows[0]).toMatchObject({ id: "task_archived_1", archivedAt: new Date("2026-08-01T00:00:00.000Z") });
    expect(result.relationCounts.archived).toBe(1);
  });

  it("supports an unassigned-project option in project filters", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);

    await getTaskCollection({
      userId: "user_1",
      timeZone: "Asia/Shanghai",
      query: parseTaskQuery({ project: ["project_1", "__none__"] }),
      db: { task: { findMany, count } },
    });

    const serializedWhere = JSON.stringify(findMany.mock.calls[0]?.[0].where);
    expect(serializedWhere).toContain('"projectId":{"in":["project_1"]}');
    expect(serializedWhere).toContain('"projectId":null');
  });

  it("reads archived details when requested and freezes their capabilities", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      ...taskRow({ archivedAt: new Date("2026-08-01T00:00:00.000Z") }),
      contentMarkdown: "## 归档正文",
      acceptanceMode: "human",
      createdBy: { id: "user_1", name: "Owner", avatarUrl: null },
      acceptanceReviewer: null,
      members: [],
      childTasks: [],
      predecessorDependencies: [],
      successorDependencies: [],
      documentLinks: [],
      attachments: [],
      comments: [],
      activities: [],
      reminders: [],
      loopRuns: [],
    });

    const result = await getTaskDetailView({
      userId: "user_1",
      taskId: "task_archived_1",
      includeArchived: true,
      db: { task: { findFirst } },
      authorizeGovern: vi.fn().mockResolvedValue({ role: "creator" }),
    });

    expect(JSON.stringify(findFirst.mock.calls[0]?.[0].where)).not.toContain('"archivedAt":null');
    expect(result?.task.archivedAt).toBeInstanceOf(Date);
    expect(result?.capabilities).toEqual({
      read: true,
      comment: false,
      edit: false,
      changeStatus: false,
      manageMembers: false,
      manageVisibility: false,
      dispatchAgent: false,
      govern: true,
    });
  });

  it("derives detail capabilities without exposing raw runtime fields", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      ...taskRow(),
      contentMarkdown: "## 验收",
      acceptanceMode: "human",
      createdBy: { id: "user_1", name: "Owner", avatarUrl: null },
      acceptanceReviewer: null,
      members: [],
      childTasks: [],
      predecessorDependencies: [],
      successorDependencies: [],
      documentLinks: [],
      attachments: [{ id: "attachment_1", originalName: "report.pdf", mimeType: "application/pdf", byteSize: 1024n, createdAt: new Date("2026-07-22T00:00:00.000Z") }],
      comments: [],
      activities: [],
      reminders: [],
      loopRuns: [],
    });

    const result = await getTaskDetailView({
      userId: "user_1",
      taskId: "task_1",
      spaceId: "space_1",
      db: { task: { findFirst } },
      authorizeGovern: vi.fn().mockResolvedValue({ role: "creator" }),
    });

    expect(result).toMatchObject({
      task: { id: "task_1", contentMarkdown: "## 验收", attachments: [{ id: "attachment_1", byteSize: 1024 }] },
      capabilities: {
        edit: true,
        changeStatus: true,
        manageMembers: true,
        dispatchAgent: true,
      },
    });
    expect(JSON.stringify(findFirst.mock.calls[0]?.[0].where)).toContain('"space"');
    expect(JSON.stringify(findFirst.mock.calls[0]?.[0].where)).toContain('"spaceId":"space_1"');
  });

  it("projects automated acceptance readiness from Task-scoped evidence", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      ...taskRow({ statusCategory: "in_review" }),
      contentMarkdown: "## 验收",
      acceptanceMode: "automated",
      acceptancePolicy: { requiredChecks: ["test", "typecheck"] },
      createdBy: { id: "user_1", name: "Owner", avatarUrl: null },
      acceptanceReviewer: null,
      members: [],
      childTasks: [],
      predecessorDependencies: [],
      successorDependencies: [],
      documentLinks: [],
      attachments: [],
      comments: [],
      activities: [],
      reminders: [],
      loopRuns: [],
      checkDefinitions: [{
        projectId: "project_1",
        name: "test",
        configuration: { acceptanceCheckKey: "test" },
        results: [{
          id: "evidence_test",
          status: "passed",
          summary: "Tests passed",
          evidence: { source: "mcp" },
          finishedAt: new Date("2026-08-01T09:00:00.000Z"),
        }],
      }],
    });

    const result = await getTaskDetailView({
      userId: "user_1",
      taskId: "task_1",
      db: { task: { findFirst } },
      authorizeGovern: vi.fn().mockResolvedValue({ role: "creator" }),
    });

    expect(result?.task.acceptanceReadiness).toEqual({
      ready: false,
      requiredChecks: ["test", "typecheck"],
      missingChecks: ["typecheck"],
      blockingChecks: [],
      policyErrors: [],
      latestEvidence: [{
        id: "evidence_test",
        checkKey: "test",
        status: "passed",
        summary: "Tests passed",
        source: "mcp",
        finishedAt: "2026-08-01T09:00:00.000Z",
      }],
    });
    expect(result?.task).not.toHaveProperty("acceptancePolicy");
    expect(result?.task).not.toHaveProperty("checkDefinitions");
    expect(findFirst.mock.calls[0]?.[0].select).toHaveProperty("checkDefinitions");
    expect(findFirst.mock.calls[0]?.[0].select.checkDefinitions.select.results.where).toEqual({
      taskId: "task_1",
    });
  });

  it("excludes acceptance evidence definitions from a Task's previous Project", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      ...taskRow({ statusCategory: "in_review" }),
      contentMarkdown: "## 验收",
      acceptanceMode: "automated",
      acceptancePolicy: { requiredChecks: ["test"] },
      createdBy: { id: "user_1", name: "Owner", avatarUrl: null },
      acceptanceReviewer: null,
      members: [],
      childTasks: [],
      predecessorDependencies: [],
      successorDependencies: [],
      documentLinks: [],
      attachments: [],
      comments: [],
      activities: [],
      reminders: [],
      loopRuns: [],
      checkDefinitions: [{
        projectId: "project_old",
        name: "test",
        configuration: { acceptanceCheckKey: "test" },
        results: [{
          id: "evidence_old_project",
          status: "passed",
          summary: "Old project passed",
          evidence: { source: "mcp" },
          finishedAt: new Date("2026-08-01T09:00:00.000Z"),
        }],
      }],
    });

    const result = await getTaskDetailView({
      userId: "user_1",
      taskId: "task_1",
      db: { task: { findFirst } },
      authorizeGovern: vi.fn().mockResolvedValue({ role: "creator" }),
    });

    expect(result?.task.acceptanceReadiness).toMatchObject({
      ready: false,
      missingChecks: ["test"],
      latestEvidence: [],
    });
  });

  it("uses shared TaskPolicy governance for the evidence form capability", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      ...taskRow({ createdById: "user_creator", assigneeUserId: "user_assignee" }),
      contentMarkdown: "## 验收",
      acceptanceMode: "automated",
      acceptancePolicy: null,
      createdBy: { id: "user_creator", name: "Creator", avatarUrl: null },
      acceptanceReviewer: null,
      members: [],
      childTasks: [],
      predecessorDependencies: [],
      successorDependencies: [],
      documentLinks: [],
      attachments: [],
      comments: [],
      activities: [],
      reminders: [],
      loopRuns: [],
      checkDefinitions: [],
    });

    const result = await getTaskDetailView({
      userId: "user_admin",
      taskId: "task_1",
      db: { task: { findFirst } },
      authorizeGovern: vi.fn().mockResolvedValue({ role: "company_admin" }),
    });

    expect(result?.capabilities.govern).toBe(true);
  });
});

const loopGraph = (nodeKeys: string[]) => ({
  schemaVersion: 1,
  inputSchema: {},
  outputSchema: {},
  limits: { maxStages: 10, maxRepeatCount: 2 },
  nodes: nodeKeys.map((key, index) => ({
    key,
    label: key,
    type: index === 0 ? "start" : index === nodeKeys.length - 1 ? "end" : "human_gate",
    ...(index === 0 || index === nodeKeys.length - 1 ? {} : { executionTarget: "platform" }),
  })),
  edges: [],
});

describe("deriveLoopRunProgress", () => {
  it("counts completed nodes against the bound graph instead of materialized node runs", () => {
    const progress = deriveLoopRunProgress({
      graph: loopGraph(["start", "agent-action-3", "gate", "agent-action-5", "review", "end"]),
      nodeRuns: [
        { nodeKey: "start", status: "succeeded", activationNo: 1 },
        { nodeKey: "agent-action-3", status: "ready", activationNo: 1 },
      ],
    });

    expect(progress).toEqual({ completed: 1, total: 6, percent: 17 });
  });

  it("uses the latest activation per node and treats skipped nodes as completed", () => {
    const progress = deriveLoopRunProgress({
      graph: loopGraph(["start", "a", "b", "end"]),
      nodeRuns: [
        { nodeKey: "start", status: "succeeded", activationNo: 1 },
        { nodeKey: "a", status: "succeeded", activationNo: 1 },
        { nodeKey: "a", status: "running", activationNo: 2 },
        { nodeKey: "b", status: "skipped", activationNo: 1 },
      ],
    });

    expect(progress).toEqual({ completed: 2, total: 4, percent: 50 });
  });

  it("reports 100 percent for a completed run whose graph has no materialized runs", () => {
    const progress = deriveLoopRunProgress({
      graph: null,
      nodeRuns: [],
      runStatus: "completed",
    });

    expect(progress).toEqual({ completed: 0, total: 0, percent: 100 });
  });
});

describe("private Task saved views", () => {
  it("scopes list, create, update, and delete operations to the current user", async () => {
    const db = {
      taskSavedView: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: "view_1" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await listTaskSavedViews({ userId: "user_1", db });
    await saveTaskView({
      userId: "user_1",
      id: "view_1",
      name: "我的待办",
      query: parseTaskQuery({ relation: "assigned" }),
      db,
    });
    await updateTaskSavedView({
      userId: "user_1",
      viewId: "view_1",
      name: "本周待办",
      query: parseTaskQuery({ relation: "assigned", view: "board" }),
      db,
    });
    await deleteTaskSavedView({ userId: "user_1", viewId: "view_1", db });

    expect(db.taskSavedView.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user_1" } }));
    expect(db.taskSavedView.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "user_1" }) }));
    expect(db.taskSavedView.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "view_1", userId: "user_1" } }));
    expect(db.taskSavedView.deleteMany).toHaveBeenCalledWith({ where: { id: "view_1", userId: "user_1" } });
  });
});
