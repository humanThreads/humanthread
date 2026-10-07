import { vi } from "vitest";

const iso = "2026-09-18T06:00:00.000Z";

export const loginFixture = {
  ok: true,
  data: {
    accessToken: "access-token",
    accessExpiresAt: "2099-01-01T00:00:00.000Z",
    refreshToken: "refresh-token",
    sessionId: "session-1",
    user: {
      id: "user-1",
      email: "person@example.com",
      name: "测试用户",
      avatarUrl: null,
    },
    device: {
      id: "desktop-preview-test",
      status: "authorized",
      deviceToken: "device-token",
    },
  },
};

export const bootstrapFixture = {
  ok: true,
  data: {
    spaces: [{ key: "personal", kind: "personal", name: "个人空间" }],
    activeSpaceKey: "personal",
    currentTask: { id: "task-1", title: "实现客户端开箱向导", status: "进行中" },
    capabilities: { nativeExecution: false },
  },
};

const taskSummary = {
  id: "task-1",
  title: "实现客户端开箱向导",
  status: "进行中",
  projectId: "project-1",
  projectName: "Desktop 重设计",
  assigneeName: "测试用户",
  updatedAt: iso,
  route: "/tasks/task-1",
};

export const dashboardFixture = {
  ok: true,
  data: {
    currentTask: taskSummary,
    stats: [
      { key: "open", label: "进行中", count: 1, description: "当前活动任务" },
      { key: "pending", label: "待确认", count: 2, description: "等待人工决策" },
      { key: "blocked", label: "阻塞", count: 1, description: "需要处理风险" },
    ],
    actionSignals: [
      { key: "approval", label: "待审批", count: 1, description: "Agent 请求人工确认" },
      { key: "risk", label: "项目风险", count: 1, description: "项目健康度需要关注" },
    ],
    tasks: [taskSummary],
    devices: [{
      id: "desktop-preview-test",
      name: "Design Preview",
      platform: "macos",
      status: "online",
      lastSeenAt: iso,
      userName: "测试用户",
    }],
  },
};

export const taskFixture = {
  id: "task-1",
  shortId: "HT-1",
  title: "实现客户端开箱向导",
  statusCategory: "in_progress",
  status: { id: "status-1", name: "进行中", category: "in_progress", color: "#2563a7" },
  visibility: "project",
  priority: 2,
  startAt: null,
  dueAt: null,
  overdue: false,
  version: 1,
  createdAt: iso,
  updatedAt: iso,
  createdById: "user-1",
  assignee: { id: "user-1", name: "测试用户", avatarUrl: null },
  project: { id: "project-1", name: "Desktop 重设计" },
  blocker: null,
  labels: [],
  childCount: 0,
  automation: null,
};

export const taskCollectionFixture = {
  ok: true,
  data: {
    collection: {
      listRows: [taskFixture],
      boardGroups: [{ key: "in_progress", tasks: [taskFixture] }],
      calendar: {
        entries: [{
          taskId: "task-1",
          shortId: "HT-1",
          title: "实现客户端开箱向导",
          kind: "due",
          at: iso,
          dateKey: "2026-09-18",
          overdue: false,
        }],
        unscheduled: [],
      },
      relationCounts: { all: 1, assigned: 1 },
      total: 1,
    },
  },
};

export const taskDetailFixture = {
  ok: true,
  data: {
    detail: {
      task: {
        ...taskFixture,
        contentMarkdown: "按设计稿实现任务详情与只读约束。",
        acceptanceMode: "manual",
        archivedAt: null,
        createdBy: { id: "user-1", name: "测试用户", avatarUrl: null },
        acceptanceReviewer: null,
        members: [],
        blockers: [],
        comments: [],
        activities: [],
        reminders: [],
        attachments: [],
        documentLinks: [],
        childTasks: [],
      },
      capabilities: {
        read: true,
        comment: false,
        edit: false,
        changeStatus: false,
        manageMembers: false,
        manageVisibility: false,
        dispatchAgent: false,
        govern: false,
        nativeExecute: false,
      },
      collaboration: { availableMembers: [], availableLabels: [] },
      execution: {
        projectId: "project-1",
        workflowInstanceId: null,
        localPath: null,
        command: null,
        toolSession: null,
      },
    },
  },
};

export const agentsFixture = {
  ok: true,
  data: {
    canManage: false,
    profiles: [{
      id: "profile-1",
      name: "桌面 Codex",
      provider: "codex",
      status: "ready",
      model: "gpt-5",
      route: "/agents/profile-1",
    }],
    workers: [{
      id: "worker-1",
      name: "Codex Worker",
      runtimeType: "kubernetes",
      agentVersion: "0.1.4",
      status: "online",
      activeRunCount: 1,
      maxConcurrentRuns: 3,
      lastHeartbeatAt: iso,
    }],
    runs: [{
      id: "run-1",
      taskId: "task-1",
      taskTitle: "实现客户端开箱向导",
      status: "running",
      attempt: 1,
      provider: "codex",
      workerName: "Codex Worker",
      createdAt: iso,
      lastHeartbeatAt: iso,
      route: "/tasks/task-1",
    }],
    loops: [],
    approvals: [{
      id: "approval-1",
      type: "tool",
      status: "pending",
      taskTitle: "实现客户端开箱向导",
      createdAt: iso,
      action: "允许执行测试命令",
      scope: "当前 Workspace",
      policyReason: "命令涉及写入工作树",
    }],
  },
};

export const projectSummaryFixture = {
  id: "project-1",
  name: "Desktop 重设计",
  spaceLabel: "个人空间",
  objective: "完成客户端全量设计稿",
  owner: { id: "user-1", name: "测试用户" },
  status: "active",
  health: "healthy",
  progress: { completed: 1, total: 3, percent: 33 },
  taskCounts: { open: 2, overdue: 0, blocked: 1 },
  nextMilestone: { id: "milestone-1", name: "设计评审", targetAt: iso, status: "in_progress" },
  updatedAt: iso,
};

export const projectsFixture = {
  ok: true,
  data: { projects: [projectSummaryFixture] },
};

export const projectDetailFixture = {
  ok: true,
  data: {
    detail: {
      project: {
        ...projectSummaryFixture,
        description: "覆盖全量客户端与开箱设置。",
        startAt: iso,
        targetAt: iso,
        visibility: "private",
        capabilities: {
          edit: false,
          manageMembers: false,
          changeLifecycle: false,
          manageRoadmap: false,
          nativeWorkspace: false,
        },
      },
      health: {
        objectiveState: "complete",
        currentStageName: "设计与原型",
        nextAction: "确认设计稿",
        blockers: 1,
        overdueTasks: 0,
      },
      resources: { documents: 1, members: 1, activities: 3, automationState: "idle" },
      taskSummary: { total: 3, open: 2, overdue: 0, blocked: 1, completed: 1 },
      roadmap: [{
        id: "stage-1",
        version: 1,
        sortOrder: 0,
        name: "设计",
        status: "in_progress",
        startAt: iso,
        targetAt: iso,
        completedMilestones: 0,
        totalMilestones: 1,
        milestones: [{
          id: "milestone-1",
          version: 1,
          sortOrder: 0,
          name: "设计评审",
          status: "in_progress",
          targetAt: iso,
          taskCount: 1,
          riskSummary: null,
          tasks: [{ id: "task-1", title: "实现客户端开箱向导", status: "进行中", version: 1 }],
        }],
      }],
      tasks: [{
        id: "task-1",
        title: "实现客户端开箱向导",
        status: "进行中",
        priority: 2,
        assigneeName: "测试用户",
        milestoneId: "milestone-1",
        updatedAt: iso,
        route: "/tasks/task-1",
      }],
      documents: [{
        id: "document-1",
        title: "设计说明",
        path: "项目/设计说明",
        version: 1,
        updatedAt: iso,
        route: "/documents/document-1",
      }],
      risks: [{ id: "risk-1", name: "范围较大", status: "open", summary: "需要分批评审" }],
      agents: [{
        id: "agent-1",
        title: "设计检查",
        status: "running",
        currentStepKey: "review",
        updatedAt: iso,
        route: "/agents/agent-1",
      }],
      workspace: {
        bindingId: "binding-1",
        status: "ready",
        pathFingerprint: "hmac-sha256:abcdefgh",
        configurationVersion: 1,
        lastValidatedAt: iso,
      },
    },
  },
};

export const documentTreeFixture = {
  ok: true,
  data: {
    groups: [{
      key: "personal",
      label: "个人空间",
      projectId: null,
      canWrite: false,
      directories: [{
        id: "directory-1",
        parentId: null,
        name: "产品设计",
        path: "产品设计",
        sortOrder: 0,
      }],
      documents: [{
        id: "document-1",
        directoryId: "directory-1",
        title: "设计说明",
        path: "产品设计/设计说明",
        sortOrder: 0,
        route: "/documents/document-1",
      }],
    }],
    trash: [{
      id: "document-trash-1",
      groupKey: "personal",
      directoryId: null,
      title: "旧版说明",
      path: "旧版说明",
      sortOrder: 0,
      deletedAt: iso,
    }],
  },
};

export const documentDetailFixture = {
  ok: true,
  data: {
    detail: {
      id: "document-1",
      projectId: null,
      title: "设计说明",
      path: "产品设计/设计说明",
      contentMarkdown: "# 设计说明\n\n这是桌面客户端设计稿的说明文档。\n\n- 默认只读\n- 支持 Markdown",
      version: 2,
      createdAt: iso,
      updatedAt: iso,
      capabilities: { edit: false },
    },
  },
};

export const documentRevisionsFixture = {
  ok: true,
  data: {
    revisions: [{
      id: "revision-1",
      documentId: "document-1",
      version: 2,
      contentMarkdown: "# 设计说明",
      source: "desktop",
      createdAt: iso,
      createdById: "user-1",
    }],
  },
};

export const notificationsFixture = {
  ok: true,
  data: {
    summary: { unreadCount: 1, todayCount: 1 },
    items: [{
      id: "notification-1",
      kind: "agent",
      title: "审批等待处理",
      description: "Codex Worker 请求执行测试命令。",
      occurredAt: iso,
      timeLabel: "刚刚",
      tone: "warning",
      isUnread: true,
      target: {
        resourceType: "approval",
        resourceId: "approval-1",
        route: "/agents?approvalId=approval-1",
        label: "打开审批",
      },
    }],
  },
};

export const reportsFixture = {
  ok: true,
  data: {
    range: "30d",
    generatedAt: iso,
    metrics: {
      completedTasks: 12,
      overdueTasks: 2,
      blockerMedianAgeHours: 6,
      humanWaitMedianAgeHours: 3,
      automationSuccess: { state: "known", succeeded: 9, total: 10, rate: 90 },
    },
    trend: {
      state: "ready",
      points: [
        { label: "第 1 周", completed: 3, blockers: 1 },
        { label: "第 2 周", completed: 4, blockers: 0 },
        { label: "第 3 周", completed: 5, blockers: 1 },
      ],
    },
    projects: [{
      id: "project-1",
      name: "Desktop 重设计",
      status: "active",
      health: "healthy",
      openTaskCount: 2,
      overdueTaskCount: 0,
      blockedTaskCount: 1,
      updatedAt: iso,
      route: "/projects/project-1",
    }],
    insights: [{ label: "阻塞任务", count: 1, tone: "warning", route: "/tasks?relation=blocked" }],
  },
};

export const templatesFixture = {
  ok: true,
  data: {
    templates: [{
      key: "task-template-1",
      title: "功能开发模板",
      description: "用于创建带验收标准的功能任务。",
      savedView: "default",
      quickCreate: {
        titlePrefix: "实现",
        phase: "development",
        priority: "medium",
        acceptanceCriteria: ["功能测试通过"],
        requiredDocs: ["设计说明"],
        agentPrerequisites: ["Workspace 已绑定"],
      },
      route: "/tasks?template=task-template-1",
    }],
  },
};

export const developmentTemplateMarketFixture = {
  ok: true,
  result: {
    templates: [{
      id: "development-template-1",
      name: "标准功能开发 Loop",
      kind: "development",
      version: 2,
      status: "published",
      origin: "space",
      spaceId: "space:personal:user-1",
      description: "覆盖需求确认、开发、测试和验收的完整 Loop。",
      revision: 3,
      createdByUserId: "user-1",
      isPublic: true,
      industryTags: ["信息技术"],
      starCount: 12,
    }],
    starredTemplateIds: [],
  },
};

export const developmentTemplateCollectionFixture = {
  ok: true,
  result: {
    templates: [{
      id: "development-template-1",
      name: "标准功能开发 Loop",
      kind: "development",
      version: 2,
      status: "published",
      origin: "space",
      spaceId: "space:personal:user-1",
      description: "覆盖需求确认、开发、测试和验收的完整 Loop。",
      revision: 3,
      createdByUserId: "user-1",
      isPublic: true,
      industryTags: ["信息技术"],
      starCount: 12,
    }],
    loopVersions: [],
    agentProfiles: [],
  },
};

export const teamFixture = {
  ok: true,
  data: {
    team: { id: "personal", name: "个人空间" },
    members: [{
      id: "user-1",
      name: "测试用户",
      email: "person@example.com",
      status: "active",
      lastSeenAt: iso,
      queueLength: 1,
      currentTask: taskSummary,
      route: "/team/user-1",
    }],
  },
};

export const settingsFixture = {
  ok: true,
  data: {
    user: {
      id: "user-1",
      name: "测试用户",
      email: "person@example.com",
      avatarUrl: null,
      status: "active",
    },
    companies: [],
    isSiteAdmin: false,
    selectedCompany: null,
  },
};

export const searchFixture = {
  ok: true,
  data: {
    query: "设计",
    tasks: [{ id: "task-1", title: "实现客户端开箱向导", subtitle: "Desktop 重设计", status: "进行中", updatedAt: iso, route: "/tasks/task-1" }],
    projects: [{ id: "project-1", title: "Desktop 重设计", subtitle: "个人空间", status: "active", updatedAt: iso, route: "/projects/project-1" }],
    documents: [{ id: "document-1", title: "设计说明", subtitle: "产品设计", status: null, updatedAt: iso, route: "/documents/document-1" }],
    members: [],
    agents: [],
  },
};

export function createFixtureFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const response = path in overrides
      ? overrides[path]
      : path === "/api/desktop/session"
        ? loginFixture
        : path.startsWith("/api/desktop/session/bootstrap")
          ? bootstrapFixture
          : path.startsWith("/api/desktop/dashboard")
            ? dashboardFixture
            : path.startsWith("/api/desktop/tasks/") && !path.startsWith("/api/desktop/tasks?")
              ? taskDetailFixture
              : path.startsWith("/api/desktop/tasks?")
                ? taskCollectionFixture
                : path.startsWith("/api/desktop/agents")
                  ? agentsFixture
            : path.startsWith("/api/desktop/projects/")
              ? projectDetailFixture
              : path.startsWith("/api/desktop/projects")
                ? projectsFixture
                : path.startsWith("/api/desktop/documents/tree")
                  ? documentTreeFixture
                  : path.includes("/revisions")
                    ? documentRevisionsFixture
                    : path.startsWith("/api/desktop/documents/")
                      ? documentDetailFixture
                      : path.startsWith("/api/desktop/notifications")
                        ? notificationsFixture
                        : path.startsWith("/api/desktop/reports")
                          ? reportsFixture
              : path.startsWith("/api/desktop/templates")
                ? templatesFixture
                : path.startsWith("/api/development-templates/market")
                  ? developmentTemplateMarketFixture
                  : path.startsWith("/api/development-templates")
                    ? developmentTemplateCollectionFixture
                : path.startsWith("/api/desktop/team")
                              ? teamFixture
                              : path.startsWith("/api/desktop/settings")
                                ? settingsFixture
                                : path.startsWith("/api/desktop/search")
                                  ? searchFixture
                                  : { ok: false, code: "not_found", error: `No fixture for ${path}` };

    return new Response(JSON.stringify(response), {
      status: "ok" in (response as Record<string, unknown>) ? 200 : 404,
      headers: { "content-type": "application/json" },
    });
  });
}
