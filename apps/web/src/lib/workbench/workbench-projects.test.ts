import { describe, expect, it, vi } from "vitest";
import {
  getProjectHubView,
  getProjectListItems,
  getWorkbenchProjectDetail,
  getWorkbenchProjects,
} from "./workbench-projects";

describe("getWorkbenchProjects", () => {
  it("loads projects for a team with active workflow counts", async () => {
    const updatedAt = new Date("2026-05-19T00:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "project_1",
        spaceId: "space_1",
        name: "HumanThread",
        description: "人机协同工作流",
        localPath: "/Users/alice/IdeaProjects/humanThread",
        defaultCommand: "codex",
        updatedAt,
        milestones: [{ id: "milestone_1", name: "MVP" }],
        workflowInstances: [{ id: "workflow_1" }, { id: "workflow_2" }],
      },
    ]);

    const result = await getWorkbenchProjects({
      teamId: "team_1",
      db: {
        project: {
          findMany,
        },
      },
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          teamId: "team_1",
        },
      }),
    );
    expect(result).toEqual([
      {
        id: "project_1",
        spaceId: "space_1",
        name: "HumanThread",
        description: "人机协同工作流",
        localPath: "/Users/alice/IdeaProjects/humanThread",
        defaultCommand: "codex",
        updatedAt,
        milestones: [{ id: "milestone_1", name: "MVP" }],
        activeWorkflowCount: 2,
      },
    ]);
  });

  it("loads projects accessible to a user and company filter", async () => {
    const updatedAt = new Date("2026-05-19T00:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "project_1",
        spaceId: "space_1",
        name: "HumanThread",
        description: "人机协同工作流",
        localPath: "/Users/alice/IdeaProjects/humanThread",
        defaultCommand: "codex",
        updatedAt,
        milestones: [],
        workflowInstances: [{ id: "workflow_1" }],
      },
    ]);

    const result = await getWorkbenchProjects({
      userId: "user_owner",
      companyId: "company_1",
      db: {
        project: {
          findMany,
        },
      },
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ OR: expect.any(Array) }),
          ]),
        }),
      }),
    );
    expect(result).toEqual([
      {
        id: "project_1",
        spaceId: "space_1",
        name: "HumanThread",
        description: "人机协同工作流",
        localPath: "/Users/alice/IdeaProjects/humanThread",
        defaultCommand: "codex",
        updatedAt,
        milestones: [],
        activeWorkflowCount: 1,
      },
    ]);
  });

  it("loads a project detail only when the user can access the project", async () => {
    const updatedAt = new Date("2026-05-19T00:00:00.000Z");
    const findFirst = vi.fn().mockResolvedValue({
      id: "project_1",
      name: "HumanThread",
      description: "人机协同工作流",
      ownerType: "company",
      visibility: "private",
      localPath: "/Users/alice/IdeaProjects/humanThread",
      defaultCommand: "codex",
      updatedAt,
      company: {
        id: "company_1",
        name: "HumanThread Company",
      },
      ownerUser: null,
      workflowInstances: [
        {
          id: "workflow_1",
          title: "交付工作流",
          status: "active",
          currentStepKey: "implementation",
          updatedAt,
        },
      ],
      stages: [{ id: "stage:legacy:project_1", key: "legacy_delivery", name: "Legacy Delivery", status: "active", milestones: [{ status: "active" }] }],
      milestones: [{ id: "milestone:legacy:project_1", name: "Legacy Backlog", status: "active", riskSummary: "待拆分" }],
      tasks: [
        {
          id: "task_1",
          title: "实现文档页",
          status: "pending",
          updatedAt,
          assignee: {
            id: "user_owner",
            name: "Owner",
          },
          workflowInstance: null,
        },
      ],
    });

    const result = await getWorkbenchProjectDetail({
      projectId: "project_1",
      userId: "user_owner",
      db: {
        project: {
          findFirst,
        },
      },
    });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "project_1",
          AND: expect.any(Array),
        }),
      }),
    );
    expect(result).toMatchObject({
      id: "project_1",
      name: "HumanThread",
      company: {
        id: "company_1",
        name: "HumanThread Company",
      },
      activeWorkflowCount: 1,
      recentTasks: [
        {
          id: "task_1",
          title: "实现文档页",
        },
      ],
      stages: [expect.objectContaining({ name: "当前交付阶段" })],
      milestones: [expect.objectContaining({ name: "待规划工作" })],
    });
    expect(result?.recentTasks[0]).not.toHaveProperty("workflowTitle");
    expect(result?.recentTasks[0]).not.toHaveProperty("workflowId");
  });
});

describe("project delivery projections", () => {
  it("builds a health-first project list without execution-only fields", async () => {
    const updatedAt = new Date("2026-07-23T00:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "project_1",
        spaceId: "space_1",
        name: "文档重构",
        description: "交付文档中心",
        objective: "让团队能快速找到并维护知识",
        ownerType: "company",
        orchestrationStatus: "active",
        managerUserId: "user_manager",
        space: { name: "产品公司空间" },
        updatedAt,
        stages: [
          { id: "stage_1", key: "legacy_delivery", name: "Legacy Delivery", status: "active", sortOrder: 0, milestones: [
            { id: "milestone_done", name: "已完成", status: "completed", sortOrder: 0, targetAt: null },
            { id: "milestone_cancelled", name: "已取消", status: "cancelled", sortOrder: 1, targetAt: new Date("2026-07-25T00:00:00.000Z") },
            { id: "milestone:legacy:project_1", name: "Legacy Backlog", status: "at_risk", sortOrder: 2, targetAt: new Date("2026-07-30T00:00:00.000Z") },
          ] },
          { id: "stage_2", key: "release", name: "发布", status: "planned", sortOrder: 1, milestones: [
            { id: "milestone_early_date", name: "后续发布", status: "planned", sortOrder: 0, targetAt: new Date("2026-07-24T00:00:00.000Z") },
          ] },
        ],
        milestones: [{ id: "milestone:legacy:project_1", name: "Legacy Backlog", status: "at_risk", targetAt: new Date("2026-07-30T00:00:00.000Z") }],
        tasks: [
          { statusCategory: "in_progress", dueAt: new Date("2026-07-20T00:00:00.000Z"), blockers: [{ status: "active" }] },
          { statusCategory: "completed", dueAt: null, blockers: [] },
        ],
      },
    ]);

    const result = await getProjectListItems({
      userId: "user_manager",
      db: { project: { findMany }, user: { findMany: vi.fn().mockResolvedValue([{ id: "user_manager", name: "项目负责人" }]) } },
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: "project_1",
        spaceLabel: "产品公司空间",
        objectiveExcerpt: "让团队能快速找到并维护知识",
        health: "blocked",
        stageProgress: { completed: 1, total: 4, percent: 25 },
        openTaskCount: 1,
        overdueTaskCount: 1,
        blockedTaskCount: 1,
        nextMilestone: expect.objectContaining({ id: "milestone:legacy:project_1", name: "待规划工作" }),
      }),
    ]);
    expect(result[0]).not.toHaveProperty("workflowTitle");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.any(Object) }));
  });

  it("builds a roadmap-centered hub and returns null for an inaccessible project", async () => {
    const updatedAt = new Date("2026-07-23T00:00:00.000Z");
    const findFirst = vi.fn().mockResolvedValueOnce({
      id: "project_1",
      spaceId: "space_1",
      name: "文档重构",
      description: "交付文档中心",
      objective: null,
      ownerType: "personal",
      visibility: "private",
      orchestrationStatus: "active",
      managerUserId: "user_owner",
      space: { name: "个人空间" },
      startAt: null,
      targetAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt,
      version: 7,
      repositoryConfiguration: {
        schemaVersion: 1,
        provider: "github",
        creationMode: "existing",
        privateBaseUrl: null,
        privateWebUrl: null,
        privateTokenHelpUrl: null,
        authMode: "project_token",
        verification: { status: "passed", verifiedAt: "2026-09-29T08:54:35.870Z", defaultBranch: "main", headSha: "a".repeat(40), failureCode: null, apiChecked: false },
      },
      stages: [{ id: "stage_1", key: "legacy_delivery", name: "Legacy Delivery", status: "active", sortOrder: 0, startAt: null, targetAt: null, milestones: [{ id: "milestone:legacy:project_1", name: "Legacy Backlog", status: "planned", sortOrder: 0, targetAt: null, tasks: [{ statusCategory: "todo" }] }] }],
      milestones: [{ id: "milestone_1", name: "MVP", status: "planned", targetAt: null, riskSummary: null }],
      tasks: [{ statusCategory: "todo", dueAt: null, blockers: [] }],
      members: [{ id: "member_1" }],
      documents: [{ id: "document_1" }],
      activities: [{ id: "activity_1" }],
    }).mockResolvedValueOnce(null);

    const canWriteProject = vi.fn().mockResolvedValue(false);
    const db = { project: { findFirst }, user: { findMany: vi.fn().mockResolvedValue([{ id: "user_owner", name: "Owner" }]) } };
    const result = await getProjectHubView({ projectId: "project_1", userId: "user_owner", db, canWriteProject });
    const hidden = await getProjectHubView({ projectId: "hidden", userId: "user_owner", db, canWriteProject });

    expect(result).toEqual(expect.objectContaining({
      project: expect.objectContaining({ id: "project_1", version: 7, health: "healthy", owner: { id: "user_owner", name: "Owner" }, repositoryConfiguration: expect.objectContaining({ verification: expect.objectContaining({ status: "passed" }) }), capabilities: { edit: false, manageMembers: false, changeLifecycle: false, manageRoadmap: false }, nextMilestone: expect.objectContaining({ name: "待规划工作" }) }),
      health: expect.objectContaining({ objectiveState: "missing", currentStageName: "当前交付阶段" }),
      roadmap: [expect.objectContaining({ id: "stage_1", name: "当前交付阶段", milestones: [expect.objectContaining({ name: "待规划工作", taskCount: 1 })] })],
      taskSummary: { total: 1, open: 1, overdue: 0, blocked: 0, completed: 0 },
      resources: { documents: 1, members: 1, activities: 0, automationState: "未自动化" },
    }));
    expect(hidden).toBeNull();
    expect(canWriteProject).toHaveBeenCalledWith({ userId: "user_owner", projectId: "project_1" });
  });
});
