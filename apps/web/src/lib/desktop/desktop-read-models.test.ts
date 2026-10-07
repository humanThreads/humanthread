import { describe, expect, it, vi } from "vitest";
import { desktopAgentsResponseSchema } from "@humanthread/workbench-client";

import {
  readDesktopProjectDetail,
  readDesktopProjects,
  readDesktopAgents,
  readDesktopSearch,
  readDesktopSettings,
  readDesktopTaskDetail,
  readDesktopTasks,
  resolveDesktopReadContext,
} from "./desktop-read-models";

const actor = { userId: "user_1", authKind: "desktop_token", sessionId: "session_1" } as const;
const personalSpace = {
  id: "space:personal:user_1",
  type: "personal",
  name: "Personal",
  role: "owner",
  ownerUserId: "user_1",
  companyId: null,
} as const;
const companySpace = {
  id: "space:company:company_1",
  type: "company",
  name: "Acme",
  role: "admin",
  ownerUserId: null,
  companyId: "company_1",
} as const;
const workbenchContext = {
  teamId: "team_1",
  userId: "user_1",
  projectId: "project_1",
  matterTypeId: "matter_1",
};

function contextDependencies() {
  return {
    resolveWorkbenchApiActor: vi.fn().mockResolvedValue(actor),
    listWorkbenchSpaces: vi.fn().mockResolvedValue([personalSpace, companySpace]),
    getWorkbenchContext: vi.fn().mockResolvedValue(workbenchContext),
    resolveDesktopNativeExecution: vi.fn().mockResolvedValue({
      authorized: true,
      localDeviceId: "device_1",
    }),
  };
}

function taskDetailView() {
  return {
    task: {
      id: "task_1",
      shortId: "HT100001",
      title: "完成桌面任务详情",
      statusCategory: "todo",
      statusDefinition: null,
      visibility: "company",
      priority: 2,
      startAt: null,
      dueAt: new Date("2026-07-30T10:00:00.000Z"),
      version: 3,
      createdAt: new Date("2026-07-26T08:00:00.000Z"),
      updatedAt: new Date("2026-07-27T08:00:00.000Z"),
      createdById: "user_1",
      assigneeUserId: "user_1",
      assignee: { id: "user_1", name: "Owner", avatarUrl: null },
      project: {
        id: "project_1",
        name: "HumanThread",
        localPath: "/workspace/humanthread",
        defaultCommand: "codex",
      },
      workflowInstanceId: "workflow_1",
      localPath: null,
      command: null,
      blockers: [],
      labelAssignments: [],
      _count: { childTasks: 0 },
      agentRuns: [],
      contentMarkdown: "## 验收",
      acceptanceMode: "human",
      archivedAt: null,
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
      toolSessions: [{
        id: "tool_session_1",
        sessionType: "tmux",
        sessionName: "ht-task-1-device-1",
        status: "active",
        lastOutputSummary: null,
      }],
    },
    capabilities: {
      read: true,
      comment: true,
      edit: true,
      changeStatus: true,
      manageMembers: true,
      manageVisibility: true,
      dispatchAgent: true,
      govern: true,
    },
  };
}

describe("desktop read models", () => {
  it("projects task and graph Agent runs through the shared Desktop contract", async () => {
    const getAgentControlPlane = vi.fn().mockResolvedValue({
      canManage: true,
      profiles: [],
      workers: [],
      runs: [
        {
          id: "run_1",
          taskId: "task_1",
          loopRunId: null,
          taskTitle: "Build Agent workspace",
          status: "running",
          attempt: 2,
          provider: "codex",
          workerName: "Mac Studio",
          createdAt: new Date("2026-07-27T10:00:00.000Z"),
          lastHeartbeatAt: new Date("2026-07-27T10:05:00.000Z"),
        },
        {
          id: "run_2",
          taskId: null,
          loopRunId: "loop_1",
          taskTitle: "Build Agent workspace",
          status: "running",
          attempt: 3,
          provider: "codex",
          workerName: "Mac Studio",
          createdAt: new Date("2026-07-27T10:06:00.000Z"),
          lastHeartbeatAt: new Date("2026-07-27T10:07:00.000Z"),
        },
        {
          id: "run_3",
          taskId: null,
          loopRunId: "release_loop_1",
          taskTitle: "临时发布计划",
          status: "running",
          attempt: 1,
          provider: "codex",
          workerName: "Linux Worker",
          createdAt: new Date("2026-07-27T10:08:00.000Z"),
          lastHeartbeatAt: new Date("2026-07-27T10:09:00.000Z"),
        },
      ],
      loops: [{
        id: "loop_1",
        taskId: "task_1",
        taskTitle: "Build Agent workspace",
        status: "paused",
        version: 3,
        currentIteration: 2,
        maxIterations: 5,
        attempt: 2,
        lastHeartbeatAt: null,
        loopName: "Gelsang Project Loop",
        scope: "task",
        parentLoopRunId: null,
        parentLoopName: null,
      }, {
        id: "release_loop_1",
        taskId: null,
        taskTitle: "临时发布计划",
        loopName: "Branch Release",
        scope: "project",
        parentLoopRunId: null,
        parentLoopName: null,
        status: "running",
        version: 1,
        currentIteration: 0,
        maxIterations: 1,
        attempt: 1,
        lastHeartbeatAt: null,
      }],
      approvals: [],
    });

    const result = await readDesktopAgents(
      new Request("http://localhost/api/desktop/agents?space=personal"),
      { ...contextDependencies(), getAgentControlPlane },
    );

    expect(getAgentControlPlane).toHaveBeenCalledWith({
      userId: "user_1",
      ownerType: "personal",
      companyId: null,
    });
    expect(result.runs[0]).toMatchObject({
      taskId: "task_1",
      workerName: "Mac Studio",
      route: "/tasks/task_1",
      createdAt: "2026-07-27T10:00:00.000Z",
    });
    expect(result.runs[1]).toMatchObject({
      taskId: "task_1",
      route: "/tasks/task_1",
    });
    expect(result.runs[2]).toMatchObject({
      taskId: null,
      route: "/loop-runs/release_loop_1",
    });
    expect(result.loops[0]).toMatchObject({ version: 3, route: "/tasks/task_1" });
    expect(result.loops[1]).toMatchObject({
      taskId: null,
      scope: "project",
      route: "/loop-runs/release_loop_1",
    });
    expect(() => desktopAgentsResponseSchema.parse({ ok: true, data: result })).not.toThrow();
    expect(JSON.stringify(result)).not.toContain("spaceId");
  });

  it("projects an authorized Project collection without internal Space identifiers", async () => {
    const getProjectListItems = vi.fn().mockResolvedValue([{
      id: "project_1",
      spaceId: personalSpace.id,
      spaceLabel: "Personal",
      name: "Atlas",
      objectiveExcerpt: "交付桌面项目工作区",
      owner: { id: "user_1", name: "Owner" },
      status: "active",
      health: "healthy",
      stageProgress: { completed: 1, total: 2, percent: 50 },
      openTaskCount: 3,
      overdueTaskCount: 0,
      blockedTaskCount: 0,
      nextMilestone: { id: "milestone_2", name: "Beta", targetAt: null, status: "active" },
      updatedAt: new Date("2026-07-27T08:00:00.000Z"),
    }]);

    const result = await readDesktopProjects(
      new Request("http://localhost/api/desktop/projects?space=personal&search=atlas&health=healthy"),
      { ...contextDependencies(), getProjectListItems },
    );

    expect(getProjectListItems).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user_1",
      ownerType: "personal",
      search: "atlas",
      health: "healthy",
    }));
    expect(result.projects[0]).toMatchObject({
      id: "project_1",
      objective: "交付桌面项目工作区",
      updatedAt: "2026-07-27T08:00:00.000Z",
    });
    expect(JSON.stringify(result)).not.toContain("spaceId");
  });

  it("combines governance, delivery resources and authorized native Project context", async () => {
    const getProjectHubView = vi.fn().mockResolvedValue({
      project: {
        id: "project_1", spaceId: companySpace.id, spaceLabel: "Acme", name: "Atlas",
        objectiveExcerpt: "交付项目工作区", owner: { id: "user_1", name: "Owner" },
        status: "active", health: "blocked", stageProgress: { completed: 1, total: 2, percent: 50 },
        openTaskCount: 3, overdueTaskCount: 1, blockedTaskCount: 1, nextMilestone: null,
        updatedAt: new Date("2026-07-27T08:00:00.000Z"), description: "Desktop delivery",
        startAt: null, targetAt: null, visibility: "company",
        capabilities: { edit: true, manageMembers: true, changeLifecycle: true, manageRoadmap: true },
      },
      roadmap: [{ id: "stage_1", version: 2, sortOrder: 0, name: "Build", status: "active", publicationStatus: "published", startAt: null, targetAt: null, completedMilestones: 1, totalMilestones: 2, milestones: [{ id: "milestone_1", version: 3, sortOrder: 0, name: "Alpha", status: "active", publicationStatus: "published", targetAt: null, riskSummary: null, taskCount: 1, tasks: [{ id: "task_1", title: "实现项目中心", status: "doing", statusCategory: "in_progress", publicationStatus: "published", version: 4 }] }] }],
      health: { objectiveState: "complete", currentStageName: "Build", nextAction: "处理阻塞任务", blockers: 1, overdueTasks: 1 },
      resources: { documents: 1, members: 2, activities: 0, automationState: "已自动化" },
      taskSummary: { total: 4, open: 3, overdue: 1, blocked: 1, completed: 1 },
    });
    const getWorkbenchProjectDetail = vi.fn().mockResolvedValue({
      id: "project_1", spaceId: companySpace.id, name: "Atlas", description: "Desktop delivery",
      objective: "交付项目工作区", orchestrationStatus: "active", localPath: "/workspace/atlas",
      defaultCommand: "codex", updatedAt: new Date("2026-07-27T08:00:00.000Z"),
      activeWorkflowCount: 1, milestones: [{ id: "milestone_2", name: "Beta", status: "at_risk", riskSummary: "依赖未确认" }],
      stages: [], ownerType: "company", visibility: "company", company: { id: "company_1", name: "Acme" }, ownerUser: null,
      activeWorkflows: [{ id: "workflow_1", title: "Codex implementation", status: "active", currentStepKey: "implement", updatedAt: new Date("2026-07-27T08:00:00.000Z") }],
      recentTasks: [{ id: "task_1", title: "实现项目中心", status: "doing", updatedAt: new Date("2026-07-27T08:00:00.000Z"), assigneeName: "Owner", priority: 2, milestoneId: null }],
    });
    const listAccessibleProjectDocuments = vi.fn().mockResolvedValue([{
      id: "doc_1", projectId: "project_1", projectName: "Atlas", title: "Architecture",
      path: "architecture.md", version: 2, updatedAt: new Date("2026-07-27T08:00:00.000Z"),
    }]);
    const listDeviceExecutionConfiguration = vi.fn().mockResolvedValue({
      workspaces: [{
        id: "workspace_binding_1",
        projectId: "project_1",
        userId: "user_1",
        localDeviceId: "device_1",
        status: "ready",
        pathFingerprint: "hmac-sha256:abc123",
        configurationVersion: 2,
        lastValidatedAt: "2026-07-31T08:00:00.000Z",
      }],
      runtimeProfiles: [],
    });

    const result = await readDesktopProjectDetail(
      new Request("http://localhost/api/desktop/projects/project_1?space=company:company_1"),
      "project_1",
      {
        ...contextDependencies(),
        getProjectHubView,
        getWorkbenchProjectDetail,
        listAccessibleProjectDocuments,
        listDeviceExecutionConfiguration,
      },
    );

    expect(result.detail.project.capabilities.nativeWorkspace).toBe(true);
    expect(result.detail.tasks[0]?.route).toBe("/tasks/task_1");
    expect(result.detail.roadmap[0]?.milestones[0]?.tasks[0]?.title).toBe("实现项目中心");
    expect(JSON.stringify(result)).not.toContain("publicationStatus");
    expect(JSON.stringify(result)).not.toContain("statusCategory");
    expect(result.detail.risks[0]?.summary).toBe("依赖未确认");
    expect(result.detail.agents[0]?.route).toBe("/agents?workflow=workflow_1");
    expect(result.detail.workspace).toEqual({
      bindingId: "workspace_binding_1",
      status: "ready",
      pathFingerprint: "hmac-sha256:abc123",
      configurationVersion: 2,
      lastValidatedAt: "2026-07-31T08:00:00.000Z",
    });
    expect(listDeviceExecutionConfiguration).toHaveBeenCalledWith({
      actorUserId: "user_1",
      localDeviceId: "device_1",
      projectId: "project_1",
    });
    expect(JSON.stringify(result)).not.toContain("/workspace/atlas");
    expect(JSON.stringify(result)).not.toContain("defaultCommand");
    expect(JSON.stringify(result)).not.toContain("spaceId");
  });

  it("does not expose an accessible Project from a different selected Space", async () => {
    const getProjectHubView = vi.fn().mockResolvedValue({
      project: { id: "project_other", spaceId: companySpace.id },
    });

    await expect(readDesktopProjectDetail(
      new Request("http://localhost/api/desktop/projects/project_other?space=personal"),
      "project_other",
      { ...contextDependencies(), getProjectHubView },
    )).rejects.toThrow("Project not found");
  });

  it("resolves only public Space keys owned by the authenticated actor", async () => {
    const dependencies = contextDependencies();
    const context = await resolveDesktopReadContext(
      new Request("http://localhost/api/desktop/dashboard?space=company:company_1"),
      dependencies,
    );

    expect(context).toMatchObject({
      actor,
      space: {
        id: "space:company:company_1",
        key: "company:company_1",
        kind: "company",
        companyId: "company_1",
      },
      workbench: workbenchContext,
    });
    expect(dependencies.getWorkbenchContext).toHaveBeenCalledWith({
      selectedUserId: "user_1",
      ownerType: "company",
      companyId: "company_1",
    });

    await expect(
      resolveDesktopReadContext(
        new Request("http://localhost/api/desktop/dashboard?space=space:company:company_1"),
        dependencies,
      ),
    ).rejects.toThrow("Space access denied");
  });

  it("bounds search resources and adds desktop routes for every category", async () => {
    const dependencies = {
      ...contextDependencies(),
      searchWorkbenchTasks: vi.fn().mockResolvedValue(
        Array.from({ length: 25 }, (_, index) => ({
          id: `task_${index}`,
          projectId: "project_1",
          projectName: "Desktop",
          title: `Task ${index}`,
          status: "active",
          updatedAt: new Date("2026-07-27T10:15:00.000Z"),
          assigneeName: "User",
          href: `/tasks/task_${index}`,
        })),
      ),
      getWorkbenchProjects: vi.fn().mockResolvedValue([
        {
          id: "project_1",
          spaceId: personalSpace.id,
          name: "Desktop",
          description: "Desktop workbench",
          localPath: null,
          defaultCommand: null,
          updatedAt: new Date("2026-07-27T10:15:00.000Z"),
          activeWorkflowCount: 1,
          milestones: [],
        },
      ]),
      listAccessibleSpaceDocuments: vi.fn().mockResolvedValue([]),
      listAccessibleProjectDocuments: vi.fn().mockResolvedValue([
        {
          id: "doc_1",
          projectId: "project_1",
          projectName: "Desktop",
          title: "Architecture",
          path: "architecture.md",
          version: 1,
          updatedAt: new Date("2026-07-27T10:15:00.000Z"),
        },
      ]),
      getTeamOverview: vi.fn().mockResolvedValue({
        team: { id: "team_1", name: "Team" },
        members: [
          {
            user: {
              id: "user_1",
              name: "Desktop User",
              email: "user@example.com",
              status: "active",
              lastSeenAt: new Date("2026-07-27T10:15:00.000Z"),
            },
            currentTask: null,
            queueLength: 0,
          },
        ],
      }),
      getAgentControlPlane: vi.fn().mockResolvedValue({
        canManage: true,
        profiles: [{ id: "agent_1", name: "Desktop Codex", provider: "codex", status: "active", model: null }],
        workers: [],
        runs: [],
        loops: [],
        approvals: [],
      }),
    };

    const result = await readDesktopSearch(
      new Request("http://localhost/api/desktop/search?q=desktop"),
      dependencies,
    );

    expect(result.tasks).toHaveLength(20);
    expect(result.tasks[0]).toMatchObject({ route: "/tasks/task_0" });
    expect(result.projects[0]).toMatchObject({ route: "/projects/project_1" });
    expect(result.documents[0]).toMatchObject({ route: "/documents/doc_1" });
    expect(result.members[0]).toMatchObject({ route: "/team?member=user_1" });
    expect(result.agents[0]).toMatchObject({ route: "/agents?profile=agent_1" });
    expect(result.tasks[0]?.updatedAt).toBe("2026-07-27T10:15:00.000Z");
  });

  it("resolves the public Space before reading a filtered Task collection", async () => {
    const getTaskCollection = vi.fn().mockResolvedValue({
      listRows: [],
      boardGroups: [],
      calendar: { entries: [], unscheduled: [] },
      relationCounts: {},
      total: 0,
    });

    await readDesktopTasks(
      new Request("http://localhost/api/desktop/tasks?space=company:company_1&relation=assigned&view=board&status=todo,in_progress"),
      { ...contextDependencies(), getTaskCollection },
    );

    expect(getTaskCollection).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user_1",
      spaceId: "space:company:company_1",
      timeZone: "Asia/Shanghai",
      query: expect.objectContaining({
        relation: "assigned",
        view: "board",
        status: ["todo", "in_progress"],
      }),
      page: 1,
      pageSize: 50,
    }));
  });

  it("projects Task pagination metadata from the requested page", async () => {
    const getTaskCollection = vi.fn().mockResolvedValue({
      listRows: [],
      boardGroups: [],
      calendar: { entries: [], unscheduled: [] },
      relationCounts: {},
      total: 45,
      page: 2,
      pageSize: 20,
      hasNextPage: true,
      hasPreviousPage: true,
    });

    const result = await readDesktopTasks(
      new Request("http://localhost/api/desktop/tasks?space=company:company_1&page=2&pageSize=20"),
      { ...contextDependencies(), getTaskCollection },
    );

    expect(getTaskCollection).toHaveBeenCalledWith(expect.objectContaining({
      page: 2,
      pageSize: 20,
    }));
    expect(result.collection).toMatchObject({
      total: 45,
      page: 2,
      pageSize: 20,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it("projects non-empty Task collections without internal read-model fields", async () => {
    const task = {
      id: "task_1",
      shortId: "HT100001",
      taskNumber: 100001,
      title: "完成桌面任务列表",
      statusCategory: "todo",
      status: { id: null, name: "todo", category: "todo", color: "#57606a" },
      visibility: "project",
      priority: 2,
      startAt: null,
      dueAt: new Date("2026-07-30T10:00:00.000Z"),
      overdue: false,
      version: 3,
      createdAt: new Date("2026-07-26T08:00:00.000Z"),
      updatedAt: new Date("2026-07-27T08:00:00.000Z"),
      createdById: "user_1",
      assignee: { id: "user_1", name: "Owner", avatarUrl: null },
      project: { id: "project_1", name: "HumanThread", shortCode: "HT" },
      customFields: { environment: "production" },
      blocker: null,
      labels: [],
      childCount: 0,
      automation: null,
    };

    const result = await readDesktopTasks(
      new Request("http://localhost/api/desktop/tasks?space=company:company_1"),
      {
        ...contextDependencies(),
        getTaskCollection: vi.fn().mockResolvedValue({
          listRows: [task],
          boardGroups: [],
          calendar: { entries: [], unscheduled: [] },
          relationCounts: { assigned: 1 },
          total: 1,
        }),
      },
    );

    expect(result.collection.listRows[0]).toEqual({
      id: "task_1",
      shortId: "HT100001",
      title: "完成桌面任务列表",
      statusCategory: "todo",
      status: { id: null, name: "todo", category: "todo", color: "#57606a" },
      visibility: "project",
      priority: 2,
      startAt: null,
      dueAt: "2026-07-30T10:00:00.000Z",
      overdue: false,
      version: 3,
      createdAt: "2026-07-26T08:00:00.000Z",
      updatedAt: "2026-07-27T08:00:00.000Z",
      createdById: "user_1",
      assignee: { id: "user_1", name: "Owner", avatarUrl: null },
      project: { id: "project_1", name: "HumanThread" },
      blocker: null,
      labels: [],
      childCount: 0,
      automation: null,
    });
    expect(JSON.stringify(result)).not.toContain("taskNumber");
    expect(JSON.stringify(result)).not.toContain("customFields");
    expect(JSON.stringify(result)).not.toContain("shortCode");
  });

  it("projects a Space-scoped Task detail with native execution facts", async () => {
    const getTaskDetailView = vi.fn().mockResolvedValue(taskDetailView());
    const listTaskLabelDefinitions = vi.fn().mockResolvedValue([
      { id: "label_1", name: "桌面端", color: "#087f73" },
    ]);
    const getWorkbenchCompanyMembers = vi.fn().mockResolvedValue({
      company: { id: "company_1" },
      members: [{ user: { id: "user_1", name: "Owner" } }],
    });

    const result = await readDesktopTaskDetail(
      new Request("http://localhost/api/desktop/tasks/task_1?space=company:company_1"),
      "task_1",
      {
        ...contextDependencies(),
        getTaskDetailView,
        listTaskLabelDefinitions,
        getWorkbenchCompanyMembers,
      },
    );

    expect(getTaskDetailView).toHaveBeenCalledWith({
      userId: "user_1",
      taskId: "task_1",
      spaceId: "space:company:company_1",
    });
    expect(result).toMatchObject({
      detail: {
        task: { id: "task_1", shortId: "HT100001", status: { name: "todo" } },
        capabilities: { nativeExecute: true },
        collaboration: {
          availableMembers: [{ id: "user_1", name: "Owner" }],
          availableLabels: [{ id: "label_1", name: "桌面端" }],
        },
        execution: {
          projectId: "project_1",
          workflowInstanceId: "workflow_1",
          localPath: "/workspace/humanthread",
          command: "codex",
          toolSession: { id: "tool_session_1" },
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("spaceId");
  });

  it("disables native execution after the desktop device authorization is revoked", async () => {
    const result = await readDesktopTaskDetail(
      new Request("http://localhost/api/desktop/tasks/task_1?space=company:company_1"),
      "task_1",
      {
        ...contextDependencies(),
        resolveDesktopNativeExecution: vi.fn().mockResolvedValue({
          authorized: false,
          localDeviceId: null,
        }),
        getTaskDetailView: vi.fn().mockResolvedValue(taskDetailView()),
        listTaskLabelDefinitions: vi.fn().mockResolvedValue([]),
        getWorkbenchCompanyMembers: vi.fn().mockResolvedValue({
          company: { id: "company_1" },
          members: [],
        }),
      },
    );

    expect(result.detail.capabilities.nativeExecute).toBe(false);
  });

  it("keeps the native workspace available when no default command is configured", async () => {
    const detail = taskDetailView();
    const result = await readDesktopTaskDetail(
      new Request("http://localhost/api/desktop/tasks/task_1?space=company:company_1"),
      "task_1",
      {
        ...contextDependencies(),
        getTaskDetailView: vi.fn().mockResolvedValue({
          ...detail,
          task: {
            ...detail.task,
            project: { ...detail.task.project, defaultCommand: null },
          },
        }),
        listTaskLabelDefinitions: vi.fn().mockResolvedValue([]),
        getWorkbenchCompanyMembers: vi.fn().mockResolvedValue({
          company: { id: "company_1" },
          members: [],
        }),
      },
    );

    expect(result.detail.execution.command).toBeNull();
    expect(result.detail.capabilities.nativeExecute).toBe(true);
  });

  it("projects company settings without secret values", async () => {
    const dependencies = {
      ...contextDependencies(),
      getWorkbenchSettingsContext: vi.fn().mockResolvedValue({
        user: {
          id: "user_1",
          name: "User",
          email: "user@example.com",
          avatarUrl: null,
          status: "active",
        },
        companies: [
          { id: "company_1", name: "Acme", logoUrl: null, role: "admin", canManage: true },
        ],
        isSiteAdmin: false,
      }),
      getWorkbenchCompanySettingsDetails: vi.fn().mockResolvedValue({
        context: {
          company: {
            id: "company_1",
            name: "Acme",
            slug: "acme",
            logoUrl: null,
            status: "active",
          },
          membership: {
            role: "admin",
            canManageProfile: true,
            canManageMembers: true,
            canManageIntegrations: true,
            canTransferOwnership: false,
          },
        },
        profile: { description: null, certificationLevel: "standard" },
        members: [],
        integration: {
          emailHost: "smtp.example.com",
          emailPort: 465,
          emailUsername: "mailer@example.com",
          hasPassword: true,
          emailPassword: "must-not-leak",
          token: "must-not-leak",
        },
      }),
    };

    const result = await readDesktopSettings(
      new Request("http://localhost/api/desktop/settings?space=company:company_1"),
      dependencies,
    );
    const serialized = JSON.stringify(result);

    expect(result.selectedCompany?.integration).toEqual({
      emailHost: "smtp.example.com",
      emailPort: 465,
      emailUsername: "mailer@example.com",
      hasPassword: true,
    });
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("emailPassword");
    expect(serialized).not.toContain("token");
  });
});
