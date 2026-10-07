import {
  getTeamOverview,
  getWorkflowTimeline,
  listWorkbenchInboxTasks,
  type TeamOverviewResult,
  type UserTaskOverview,
  type WorkflowTimelineResult,
} from "../overviews/task-overviews";
import {
  getWorkbenchDevices,
  type WorkbenchDeviceOverview,
} from "./workbench-devices";
import {
  getWorkbenchProjects,
  type WorkbenchProjectOverview,
} from "./workbench-projects";
import {
  listAccessibleProjectDocuments,
  type WorkbenchAccessibleProjectDocumentSummary,
} from "./workbench-documents";
import {
  listWorkbenchMcpCredentials,
  type WorkbenchMcpCredentialSettings,
} from "./workbench-settings";

export const WORKBENCH_DASHBOARD_FILTER_KEYS = [
  "all",
  "today",
  "overdue",
  "blocked",
  "queue",
  "context",
] as const;

export type WorkbenchDashboardFilterKey =
  (typeof WORKBENCH_DASHBOARD_FILTER_KEYS)[number];

export const WORKBENCH_DASHBOARD_VIEW_KEYS = [
  "time",
  "owner",
  "phase",
  "risk",
] as const;

export type WorkbenchDashboardViewKey =
  (typeof WORKBENCH_DASHBOARD_VIEW_KEYS)[number];

export interface WorkbenchDashboardTask extends UserTaskOverview {
  riskIds: string[];
  contextMissingKeys: string[];
  isToday: boolean;
  isQueued: boolean;
  requiresAttention: boolean;
  timeBucket: "overdue" | "today" | "next_7" | "later";
  timeBucketLabel: string;
  priority: "high" | "medium" | "low";
  displayQueueOrder: number | null;
  displayQueueLabel: string | null;
}

export interface WorkbenchDashboardStat {
  key: "today" | "overdue" | "blocked" | "queue" | "devices";
  label: string;
  count: number;
  description: string;
}

export interface WorkbenchDashboardActionSignal {
  key: "assigned" | "blocked";
  label: string;
  count: number;
  description: string;
}

export interface WorkbenchDashboardTaskGroup {
  key: string;
  title: string;
  description: string;
  tasks: WorkbenchDashboardTask[];
}

export interface WorkbenchDashboardExecutionLink {
  label: string;
  href: string;
  description: string;
}

export interface WorkbenchDashboardContextItem {
  key: "description" | "documents" | "local_path" | "default_command" | "mcp_credentials";
  label: string;
  complete: boolean;
  detail: string;
}

export interface WorkbenchDashboardRiskItem {
  id: string;
  tone: "default" | "success" | "danger" | "warning" | "blue";
  title: string;
  description: string;
}

export interface WorkbenchDashboardNextAction {
  label: string;
  description: string;
}

export interface WorkbenchDashboardDetail {
  task: WorkbenchDashboardTask;
  metadata: {
    ownerLabel: string;
    agentLabel: string;
    priorityLabel: string;
    dueLabel: string;
    phaseLabel: string;
    projectLabel: string;
  };
  workflowDescription: string | null;
  context: {
    complete: number;
    total: number;
    items: WorkbenchDashboardContextItem[];
  };
  risks: WorkbenchDashboardRiskItem[];
  nextAction: WorkbenchDashboardNextAction;
  relatedDocuments: WorkbenchAccessibleProjectDocumentSummary[];
  timelineEvents: WorkflowTimelineResult["events"];
  executionLinks: WorkbenchDashboardExecutionLink[];
}

export interface WorkbenchDashboardData {
  currentTask: WorkbenchDashboardTask | null;
  allTasks: WorkbenchDashboardTask[];
  activeFilter: WorkbenchDashboardFilterKey;
  activeView: WorkbenchDashboardViewKey;
  selectedTaskId: string | null;
  stats: WorkbenchDashboardStat[];
  actionSignals: WorkbenchDashboardActionSignal[];
  inboxGroups: WorkbenchDashboardTaskGroup[];
  detail: WorkbenchDashboardDetail | null;
  team: TeamOverviewResult["team"];
  members: TeamOverviewResult["members"];
  devices: WorkbenchDeviceOverview[];
  quickCreateProjects: WorkbenchProjectOverview[];
}

export interface WorkbenchDashboardInput {
  teamId: string;
  userId: string;
  filterKey?: string;
  viewKey?: string;
  selectedTaskId?: string;
  companyId?: string;
  ownerType?: "company" | "personal";
}

interface WorkbenchDashboardDependencies {
  listWorkbenchInboxTasks: typeof listWorkbenchInboxTasks;
  getTeamOverview: typeof getTeamOverview;
  getWorkbenchDevices: typeof getWorkbenchDevices;
  listAccessibleProjectDocuments: typeof listAccessibleProjectDocuments;
  listWorkbenchMcpCredentials: typeof listWorkbenchMcpCredentials;
  getWorkflowTimeline: typeof getWorkflowTimeline;
  getWorkbenchProjects: typeof getWorkbenchProjects;
  getNow: () => Date;
}

const DEFAULT_DEPENDENCIES: WorkbenchDashboardDependencies = {
  listWorkbenchInboxTasks,
  getTeamOverview,
  getWorkbenchDevices,
  listAccessibleProjectDocuments,
  listWorkbenchMcpCredentials,
  getWorkflowTimeline,
  getWorkbenchProjects,
  getNow: () => new Date(),
};

function normalizeDashboardFilterKey(
  value: string | undefined,
): WorkbenchDashboardFilterKey {
  const normalized = value?.trim();

  if (
    normalized &&
    WORKBENCH_DASHBOARD_FILTER_KEYS.includes(
      normalized as WorkbenchDashboardFilterKey,
    )
  ) {
    return normalized as WorkbenchDashboardFilterKey;
  }

  return "all";
}

function normalizeDashboardViewKey(
  value: string | undefined,
): WorkbenchDashboardViewKey {
  const normalized = value?.trim();

  if (
    normalized &&
    WORKBENCH_DASHBOARD_VIEW_KEYS.includes(
      normalized as WorkbenchDashboardViewKey,
    )
  ) {
    return normalized as WorkbenchDashboardViewKey;
  }

  return "time";
}

function isSameLocalDay(left: Date | undefined, right: Date): boolean {
  if (!left) {
    return false;
  }

  return left.toDateString() === right.toDateString();
}

function hasRecentTaskActivity(task: UserTaskOverview, now: Date): boolean {
  return isSameLocalDay(task.task.updatedAt, now);
}

function getDashboardTimeBucket(task: UserTaskOverview, now: Date) {
  if (hasRecentTaskActivity(task, now) || task.task.status === "active") {
    return { key: "today" as const, label: "今天" };
  }

  if (
    task.task.status === "blocked" ||
    task.task.status === "follow_up" ||
    task.task.status === "interrupted"
  ) {
    return { key: "overdue" as const, label: "已逾期" };
  }

  if (task.task.queuePosition > 0 && task.task.queuePosition <= 7) {
    return { key: "next_7" as const, label: "未来 7 天" };
  }

  return { key: "later" as const, label: "以后或未安排" };
}

function getDashboardPriority(input: {
  task: UserTaskOverview;
  timeBucket: WorkbenchDashboardTask["timeBucket"];
}): WorkbenchDashboardTask["priority"] {
  if (
    input.timeBucket === "overdue" ||
    input.task.task.status === "active" ||
    input.task.task.status === "blocked"
  ) {
    return "high";
  }

  if (input.timeBucket === "today" || input.task.task.queuePosition <= 3) {
    return "medium";
  }

  return "low";
}

function createDashboardTask(input: {
  task: UserTaskOverview;
  hasDocuments: boolean;
  hasCredentials: boolean;
  now: Date;
}): WorkbenchDashboardTask {
  const contextMissingKeys: string[] = [];

  if (!input.hasDocuments) {
    contextMissingKeys.push("documents");
  }

  if (!input.task.project.localPath) {
    contextMissingKeys.push("local_path");
  }

  if (!input.task.project.defaultCommand) {
    contextMissingKeys.push("default_command");
  }

  if (!input.hasCredentials) {
    contextMissingKeys.push("mcp_credentials");
  }

  const timeBucket = getDashboardTimeBucket(input.task, input.now);
  const isQueued =
    input.task.task.status === "pending" && input.task.task.queuePosition > 0;
  const isToday = timeBucket.key === "today";
  const requiresAttention =
    timeBucket.key === "overdue" ||
    input.task.task.status === "active" ||
    input.task.task.status === "blocked" ||
    input.task.task.status === "follow_up" ||
    input.task.task.status === "interrupted" ||
    input.task.task.queuePosition === 0;
  const riskIds = [
    ...(timeBucket.key === "overdue" ? ["overdue"] : []),
    ...(input.task.task.status === "blocked" ? ["blocked"] : []),
    ...(input.task.task.status === "follow_up" ? ["follow_up"] : []),
    ...(input.task.task.status === "interrupted" ? ["interrupted"] : []),
    ...contextMissingKeys.map((key) => `missing_${key}`),
  ];

  return {
    ...input.task,
    riskIds,
    contextMissingKeys,
    isToday,
    isQueued,
    requiresAttention,
    timeBucket: timeBucket.key,
    timeBucketLabel: timeBucket.label,
    priority: getDashboardPriority({
      task: input.task,
      timeBucket: timeBucket.key,
    }),
    displayQueueOrder: null,
    displayQueueLabel: null,
  };
}

function selectCurrentTask(tasks: WorkbenchDashboardTask[]): WorkbenchDashboardTask | null {
  return tasks.find((task) => task.task.status === "active")
    ?? tasks.find((task) => task.task.queuePosition === 0)
    ?? tasks[0]
    ?? null;
}

function filterDashboardTasks(
  tasks: WorkbenchDashboardTask[],
  filterKey: WorkbenchDashboardFilterKey,
): WorkbenchDashboardTask[] {
  switch (filterKey) {
    case "today":
      return tasks.filter((task) => task.isToday);
    case "overdue":
      return tasks.filter((task) => task.timeBucket === "overdue");
    case "blocked":
      return tasks.filter((task) =>
        ["blocked", "follow_up", "interrupted"].includes(task.task.status),
      );
    case "queue":
      return tasks.filter((task) => task.task.status === "pending");
    case "context":
      return tasks.filter((task) => task.contextMissingKeys.length > 0);
    case "all":
    default:
      return tasks;
  }
}

function groupDashboardTasksByTime(
  tasks: WorkbenchDashboardTask[],
  filterKey: WorkbenchDashboardFilterKey,
): WorkbenchDashboardTaskGroup[] {
  if (tasks.length === 0) {
    return [];
  }

  const groupMeta: Record<
    WorkbenchDashboardTask["timeBucket"],
    Pick<WorkbenchDashboardTaskGroup, "title" | "description">
  > = {
    overdue: {
      title: "已逾期",
      description: "已经超过当前处理窗口，建议优先清理。",
    },
    today: {
      title: "今天",
      description: "今天适合确认、执行或继续推进的事项。",
    },
    next_7: {
      title: "未来 7 天",
      description: "即将进入处理窗口，适合提前准备上下文。",
    },
    later: {
      title: "以后或未安排",
      description: "暂未进入近期处理窗口，可以先保持观察。",
    },
  };

  const groups: WorkbenchDashboardTaskGroup[] = [];

  for (const bucketKey of ["overdue", "today", "next_7", "later"] as const) {
    const bucketTasks = tasks.filter((task) => task.timeBucket === bucketKey);

    if (bucketTasks.length === 0) {
      continue;
    }

    groups.push({
      key: bucketKey,
      title: groupMeta[bucketKey].title,
      description:
        filterKey === "context"
          ? "这些事项还需要先补齐说明、文档或执行配置。"
          : groupMeta[bucketKey].description,
      tasks: bucketTasks,
    });
  }

  return groups;
}

function buildGroupedTaskSections(input: {
  tasks: WorkbenchDashboardTask[];
  resolveGroup: (task: WorkbenchDashboardTask) => {
    key: string;
    title: string;
    description: string;
  };
  order?: string[];
}): WorkbenchDashboardTaskGroup[] {
  if (input.tasks.length === 0) {
    return [];
  }

  const groups = new Map<string, WorkbenchDashboardTaskGroup>();

  for (const task of input.tasks) {
    const group = input.resolveGroup(task);
    const existing = groups.get(group.key);

    if (existing) {
      existing.tasks.push(task);
      continue;
    }

    groups.set(group.key, {
      key: group.key,
      title: group.title,
      description: group.description,
      tasks: [task],
    });
  }

  const orderedGroups = [...groups.values()];

  if (!input.order || input.order.length === 0) {
    return orderedGroups;
  }

  const rankedGroups = new Map(
    input.order.map((key, index) => [key, index] as const),
  );

  return orderedGroups.sort((left, right) => {
    const leftRank = rankedGroups.get(left.key) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rankedGroups.get(right.key) ?? Number.MAX_SAFE_INTEGER;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.title.localeCompare(right.title, "zh-CN");
  });
}

function groupDashboardTasksByOwner(
  tasks: WorkbenchDashboardTask[],
): WorkbenchDashboardTaskGroup[] {
  const distinctAssigneeCount = new Set(tasks.map((task) => task.assignee.id)).size;

  if (distinctAssigneeCount > 1) {
    return buildGroupedTaskSections({
      tasks,
      resolveGroup: (task) => ({
        key: `assignee:${task.assignee.id}`,
        title: task.assignee.name,
        description: "按负责人查看当前收件箱事项。",
      }),
    });
  }

  return buildGroupedTaskSections({
    tasks,
    order: ["current", "agent", "queued", "attention", "owned"],
    resolveGroup: (task) => {
      if (
        task.task.status === "blocked" ||
        task.task.status === "follow_up" ||
        task.task.status === "interrupted"
      ) {
        return {
          key: "attention",
          title: "等待我处理",
          description: "这些事项需要人工确认、解除阻塞或补充反馈。",
        };
      }

      if (task.toolSession?.status === "active") {
        return {
          key: "agent",
          title: "Agent 协同中",
          description: "Agent 正在协同执行，适合跟进结果和下一步动作。",
        };
      }

      if (task.task.status === "active" || task.task.queuePosition === 0) {
        return {
          key: "current",
          title: "我当前推进",
          description: "优先关注我正在推进或下一个就要处理的事项。",
        };
      }

      if (task.isQueued) {
        return {
          key: "queued",
          title: "等待我处理",
          description: "这些事项已在我的队列中，适合排定处理顺序。",
        };
      }

      return {
        key: "owned",
        title: "我负责",
        description: "当前工作台下由我负责的其他事项。",
      };
    },
  });
}

function groupDashboardTasksByPhase(
  tasks: WorkbenchDashboardTask[],
): WorkbenchDashboardTaskGroup[] {
  return buildGroupedTaskSections({
    tasks,
    resolveGroup: (task) => ({
      key: `phase:${task.task.title}`,
      title: task.task.title,
      description: "同一执行阶段的事项会聚合到一起，方便批量扫描。",
    }),
  });
}

function hasStaleTaskActivity(task: WorkbenchDashboardTask, now: Date): boolean {
  return Boolean(
    task.task.updatedAt && now.getTime() - task.task.updatedAt.getTime() > 1000 * 60 * 60 * 48,
  );
}

function groupDashboardTasksByRisk(
  tasks: WorkbenchDashboardTask[],
  now: Date,
): WorkbenchDashboardTaskGroup[] {
  return buildGroupedTaskSections({
    tasks,
    order: [
      "blocked",
      "missing_local_path",
      "missing_default_command",
      "stale_activity",
      "missing_documents",
      "missing_mcp_credentials",
      "ready",
    ],
    resolveGroup: (task) => {
      if (
        task.task.status === "blocked" ||
        task.task.status === "follow_up" ||
        task.task.status === "interrupted"
      ) {
        return {
          key: "blocked",
          title: "阻塞中",
          description: "优先处理阻塞和中断事项，避免它们持续堆积。",
        };
      }

      if (task.contextMissingKeys.includes("local_path")) {
        return {
          key: "missing_local_path",
          title: "缺少目录",
          description: "先补齐本地目录，才能一键打开工程继续执行。",
        };
      }

      if (task.contextMissingKeys.includes("default_command")) {
        return {
          key: "missing_default_command",
          title: "缺少默认命令",
          description: "这些事项还缺默认命令，启动 Agent 前需要先配置。",
        };
      }

      if (hasStaleTaskActivity(task, now)) {
        return {
          key: "stale_activity",
          title: "长时间未更新",
          description: "这些事项超过 48 小时未记录新进展，建议重新确认状态。",
        };
      }

      if (task.contextMissingKeys.includes("documents")) {
        return {
          key: "missing_documents",
          title: "缺少说明文档",
          description: "建议先补需求或验收文档，减少执行来回确认。",
        };
      }

      if (task.contextMissingKeys.includes("mcp_credentials")) {
        return {
          key: "missing_mcp_credentials",
          title: "缺少 MCP 凭据",
          description: "这些事项依赖外部能力前，先补齐可用凭据。",
        };
      }

      return {
        key: "ready",
        title: "可继续执行",
        description: "上下文和执行配置已基本就绪，可以继续推进。",
      };
    },
  });
}

function groupDashboardTasks(input: {
  tasks: WorkbenchDashboardTask[];
  filterKey: WorkbenchDashboardFilterKey;
  viewKey: WorkbenchDashboardViewKey;
  now: Date;
}): WorkbenchDashboardTaskGroup[] {
  switch (input.viewKey) {
    case "owner":
      return groupDashboardTasksByOwner(input.tasks);
    case "phase":
      return groupDashboardTasksByPhase(input.tasks);
    case "risk":
      return groupDashboardTasksByRisk(input.tasks, input.now);
    case "time":
    default:
      return groupDashboardTasksByTime(input.tasks, input.filterKey);
  }
}

function buildDashboardStats(input: {
  tasks: WorkbenchDashboardTask[];
  devices: WorkbenchDeviceOverview[];
}): WorkbenchDashboardStat[] {
  const queuedCount = input.tasks.filter(
    (task) => task.task.status === "pending",
  ).length;

  return [
    {
      key: "today",
      label: "今天",
      count: filterDashboardTasks(input.tasks, "today").length,
      description: "今天要确认或继续推进的任务",
    },
    {
      key: "overdue",
      label: "已逾期",
      count: filterDashboardTasks(input.tasks, "overdue").length,
      description: "已经超过当前处理窗口的事项",
    },
    {
      key: "blocked",
      label: "阻塞",
      count: filterDashboardTasks(input.tasks, "blocked").length,
      description: "等待人工处理的事项",
    },
    {
      key: "queue",
      label: "排队",
      count: queuedCount,
      description:
        queuedCount > 0
          ? "当前收件箱中待调度或待排序的事项"
          : "当前没有待排队事项",
    },
    {
      key: "devices",
      label: "Agent 可用",
      count: input.devices.filter((device) => device.status === "authorized").length,
      description: "已授权设备",
    },
  ];
}

function buildDashboardActionSignals(tasks: WorkbenchDashboardTask[]): WorkbenchDashboardActionSignal[] {
  return [
    { key: "assigned", label: "待我处理", count: tasks.filter((task) => ["pending", "active", "follow_up", "interrupted"].includes(task.task.status)).length, description: "需要确认、推进或重新安排的事项。" },
    { key: "blocked", label: "已阻塞", count: tasks.filter((task) => task.task.status === "blocked").length, description: "等待人工解除或补充关键上下文。" },
  ];
}

function getLatestStatusMessage(
  events: WorkflowTimelineResult["events"],
  taskId: string,
): string | null {
  const matchedEvent = [...events]
    .reverse()
    .find(
      (event) =>
        event.taskId === taskId &&
        ["task_blocked", "task_follow_up_created", "task_interrupted"].includes(
          event.type,
        ) &&
        event.message,
    );

  return matchedEvent?.message ?? null;
}

function buildDashboardDetail(input: {
  task: WorkbenchDashboardTask;
  workflowDescription: string | null;
  relatedDocuments: WorkbenchAccessibleProjectDocumentSummary[];
  credentials: WorkbenchMcpCredentialSettings[];
  timelineEvents: WorkflowTimelineResult["events"];
  now: Date;
}): WorkbenchDashboardDetail {
  const contextItems: WorkbenchDashboardContextItem[] = [
    {
      key: "description",
      label: "需求说明",
      complete: Boolean(input.workflowDescription?.trim()),
      detail: input.workflowDescription?.trim()
        ? "已补充当前工作流说明"
        : "尚未补充需求说明或验收条件",
    },
    {
      key: "documents",
      label: "相关文档",
      complete: input.relatedDocuments.length > 0,
      detail:
        input.relatedDocuments.length > 0
          ? `已绑定 ${input.relatedDocuments.length} 份相关文档`
          : "尚未绑定任务说明文档",
    },
    {
      key: "local_path",
      label: "本地目录",
      complete: Boolean(input.task.project.localPath),
      detail: input.task.project.localPath ?? "未配置",
    },
    {
      key: "default_command",
      label: "默认命令",
      complete: Boolean(input.task.project.defaultCommand),
      detail: input.task.project.defaultCommand ?? "未配置",
    },
    {
      key: "mcp_credentials",
      label: "MCP 凭据",
      complete: input.credentials.length > 0,
      detail:
        input.credentials.length > 0
          ? `已签发 ${input.credentials.length} 个可用凭据`
          : "当前账号还没有可用 MCP 凭据",
    },
  ];

  const risks: WorkbenchDashboardRiskItem[] = [];
  const statusMessage = getLatestStatusMessage(
    input.timelineEvents,
    input.task.task.id,
  );

  if (input.task.task.status === "blocked") {
    risks.push({
      id: "blocked",
      tone: "danger",
      title: "任务已阻塞",
      description: statusMessage ?? "当前任务等待人工解除阻塞。",
    });
  }

  if (input.task.task.status === "follow_up") {
    risks.push({
      id: "follow_up",
      tone: "warning",
      title: "等待跟进",
      description: statusMessage ?? "当前任务需要补充跟进说明后继续。",
    });
  }

  if (input.task.task.status === "interrupted") {
    risks.push({
      id: "interrupted",
      tone: "warning",
      title: "任务已中断",
      description: statusMessage ?? "当前任务需要重新确认后再恢复执行。",
    });
  }

  if (input.task.timeBucket === "overdue") {
    risks.push({
      id: "overdue",
      tone: "danger",
      title: "任务已逾期",
      description: "当前事项已超过建议处理窗口，建议优先清理。",
    });
  }

  if (!input.task.project.localPath) {
    risks.push({
      id: "missing_local_path",
      tone: "warning",
      title: "未配置本地目录",
      description: "当前任务还不能一键打开到本地工程。",
    });
  }

  if (!input.task.project.defaultCommand) {
    risks.push({
      id: "missing_default_command",
      tone: "warning",
      title: "未配置默认命令",
      description: "Agent 还没有默认执行入口。",
    });
  }

  if (input.relatedDocuments.length === 0) {
    risks.push({
      id: "missing_documents",
      tone: "default",
      title: "缺少任务说明文档",
      description: "建议先补一份需求说明或验收文档，减少执行来回确认。",
    });
  }

  if (input.credentials.length === 0) {
    risks.push({
      id: "missing_mcp_credentials",
      tone: "default",
      title: "缺少 MCP 凭据",
      description: "需要先签发凭据，后续才能稳定接入 MCP 能力。",
    });
  }

  const updatedAt = input.task.task.updatedAt;

  if (updatedAt && input.now.getTime() - updatedAt.getTime() > 1000 * 60 * 60 * 48) {
    risks.push({
      id: "stale_activity",
      tone: "default",
      title: "长时间未更新",
      description: "这个任务已经超过 48 小时没有新的活动记录。",
    });
  }

  const complete = contextItems.filter((item) => item.complete).length;
  let nextAction: WorkbenchDashboardNextAction = {
    label: "开始执行当前阶段",
    description: "上下文已足够时，直接进入执行并持续记录结果。",
  };

  if (input.task.task.status === "blocked") {
    nextAction = {
      label: "解除阻塞并继续推进",
      description: statusMessage ?? "先补齐阻塞前置条件，再恢复执行。",
    };
  } else if (!input.task.project.localPath && !input.task.project.defaultCommand) {
    nextAction = {
      label: "补充验收标准并配置本地目录",
      description: "先把需求说明和运行目录补齐，再开始执行。",
    };
  } else if (!input.task.project.localPath) {
    nextAction = {
      label: "配置本地目录",
      description: "补齐工程路径后，当前任务就能直接打开到本地。",
    };
  } else if (!input.task.project.defaultCommand) {
    nextAction = {
      label: "配置默认命令",
      description: "补上默认命令，避免启动 Agent 时反复手填。",
    };
  } else if (input.task.timeBucket === "overdue") {
    nextAction = {
      label: "优先清理逾期事项",
      description: "先确认阻塞点和交付预期，再把逾期任务重新推进到执行状态。",
    };
  } else if (input.relatedDocuments.length === 0) {
    nextAction = {
      label: "补一份任务说明文档",
      description: "先把需求和验收条件沉淀到文档，后续执行更稳定。",
    };
  } else if (input.credentials.length === 0) {
    nextAction = {
      label: "签发 MCP 凭据",
      description: "补齐 MCP 凭据后，再继续需要外部工具的步骤。",
    };
  }

  const priorityLabel =
    input.task.priority === "high"
      ? "高"
      : input.task.priority === "medium"
        ? "中"
        : "低";

  return {
    task: input.task,
    metadata: {
      ownerLabel: input.task.assignee.name,
      agentLabel: input.task.toolSession?.sessionName ?? "待接管",
      priorityLabel,
      dueLabel: input.task.timeBucketLabel,
      phaseLabel: input.task.task.title,
      projectLabel: `${input.task.project.name} · ${input.task.project.spaceLabel ?? "公司空间"}`,
    },
    workflowDescription: input.workflowDescription,
    context: {
      complete,
      total: contextItems.length,
      items: contextItems,
    },
    risks,
    nextAction,
    relatedDocuments: input.relatedDocuments,
    timelineEvents: input.timelineEvents.slice(-8).reverse(),
    executionLinks: [
      {
        label: "任务详情",
        href: `/tasks/${encodeURIComponent(input.task.task.id)}`,
        description: "打开这条事项的独立任务详情页。",
      },
      {
        label: "任务中心",
        href: "/tasks",
        description: "切到任务中心查看相同任务分组和筛选视图。",
      },
      {
        label: "项目详情",
        href: `/projects/${encodeURIComponent(input.task.project.id)}?taskId=${encodeURIComponent(input.task.task.id)}`,
        description: "回到项目空间查看该事项所属项目、文档和最近任务。",
      },
      {
        label: "团队协作",
        href: `/team?taskId=${encodeURIComponent(input.task.task.id)}`,
        description: "查看负责人和团队线程占用，准备转交或协同。",
      },
      {
        label: "通知中心",
        href: `/notifications?taskId=${encodeURIComponent(input.task.task.id)}`,
        description: "查看与当前任务相关的提醒、时间线和文档更新。",
      },
    ],
  };
}

export async function getWorkbenchDashboardData(
  input: WorkbenchDashboardInput,
  dependencies: Partial<WorkbenchDashboardDependencies> = {},
): Promise<WorkbenchDashboardData> {
  const resolvedDependencies: WorkbenchDashboardDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...dependencies,
  };
  const now = resolvedDependencies.getNow();
  const activeFilter = normalizeDashboardFilterKey(input.filterKey);
  const activeView = normalizeDashboardViewKey(input.viewKey);

  const [inboxTasks, teamOverview, devices, documents, credentials, projects] =
    await Promise.all([
      resolvedDependencies.listWorkbenchInboxTasks({
        teamId: input.teamId,
        userId: input.userId,
        ...(input.companyId ? { companyId: input.companyId } : {}),
        ...(input.ownerType ? { ownerType: input.ownerType } : {}),
      }),
      resolvedDependencies.getTeamOverview({
        teamId: input.teamId,
        userId: input.userId,
        ...(input.companyId ? { companyId: input.companyId } : {}),
        ...(input.ownerType ? { ownerType: input.ownerType } : {}),
      }),
      resolvedDependencies.getWorkbenchDevices({
        teamId: input.teamId,
      }),
      resolvedDependencies.listAccessibleProjectDocuments({
        userId: input.userId,
        ...(input.companyId ? { companyId: input.companyId } : {}),
        ...(input.ownerType ? { ownerType: input.ownerType } : {}),
      }),
      resolvedDependencies.listWorkbenchMcpCredentials({
        userId: input.userId,
      }),
      resolvedDependencies.getWorkbenchProjects({
        userId: input.userId,
        ...(input.companyId ? { companyId: input.companyId } : {}),
        ...(input.ownerType ? { ownerType: input.ownerType } : {}),
      }),
    ]);

  const documentCountByProjectId = new Map<string, number>();

  for (const document of documents) {
    documentCountByProjectId.set(
      document.projectId,
      (documentCountByProjectId.get(document.projectId) ?? 0) + 1,
    );
  }

  let visibleQueueOrder = 0;
  const allTasks = inboxTasks.map((task) => {
    const dashboardTask = createDashboardTask({
      task,
      hasDocuments: (documentCountByProjectId.get(task.project.id) ?? 0) > 0,
      hasCredentials: credentials.length > 0,
      now,
    });

    if (
      dashboardTask.task.status === "active" ||
      dashboardTask.task.status === "pending"
    ) {
      visibleQueueOrder += 1;

      return {
        ...dashboardTask,
        displayQueueOrder: visibleQueueOrder,
        displayQueueLabel: `队列 #${visibleQueueOrder}`,
      };
    }

    return dashboardTask;
  });
  const currentTask = selectCurrentTask(allTasks);
  const filteredTasks = filterDashboardTasks(allTasks, activeFilter);
  const selectedTask =
    filteredTasks.find((task) => task.task.id === input.selectedTaskId)
    ?? filteredTasks[0]
    ?? allTasks.find((task) => task.task.id === input.selectedTaskId)
    ?? currentTask;

  let detail: WorkbenchDashboardDetail | null = null;

  if (selectedTask) {
    const timeline = await resolvedDependencies.getWorkflowTimeline({
      workflowId: selectedTask.workflow.id,
    });
    const relatedDocuments = documents
      .filter((document) => document.projectId === selectedTask.project.id)
      .slice(0, 3);

    detail = buildDashboardDetail({
      task: selectedTask,
      workflowDescription: timeline.workflow?.description ?? null,
      relatedDocuments,
      credentials,
      timelineEvents: timeline.events,
      now,
    });
  }

  return {
    currentTask,
    allTasks,
    activeFilter,
    activeView,
    selectedTaskId: selectedTask?.task.id ?? null,
    stats: buildDashboardStats({
      tasks: allTasks,
      devices,
    }),
    actionSignals: buildDashboardActionSignals(allTasks),
    inboxGroups: groupDashboardTasks({
      tasks: filteredTasks,
      filterKey: activeFilter,
      viewKey: activeView,
      now,
    }),
    detail,
    team: teamOverview.team,
    members: teamOverview.members,
    devices,
    quickCreateProjects: projects,
  };
}
