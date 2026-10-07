import type { WorkbenchDashboardTask } from "./workbench-dashboard";
import { recordLegacyTaskUsage } from "../tasks/task-rollout";

export const TASK_CENTER_SAVED_VIEW_DEFINITIONS = [
  {
    key: "today",
    label: "今日",
    description: "只看今天需要推进的事项。",
  },
  {
    key: "unscheduled",
    label: "未安排",
    description: "筛出还没有明确处理窗口的待办。",
  },
  {
    key: "missing_context",
    label: "缺上下文",
    description: "筛出说明、目录、命令或凭据不完整的任务。",
  },
  {
    key: "agent_ready",
    label: "Agent 可派单",
    description: "上下文和执行配置已齐备，可直接派给 Agent。",
  },
  {
    key: "blocked",
    label: "阻塞",
    description: "只看阻塞、跟进和中断事项。",
  },
] as const;

export type TaskCenterSavedViewKey =
  (typeof TASK_CENTER_SAVED_VIEW_DEFINITIONS)[number]["key"];

export function normalizeTaskCenterSavedViewKey(
  value: string | undefined,
): TaskCenterSavedViewKey | null {
  const normalized = value?.trim();

  if (
    normalized &&
    TASK_CENTER_SAVED_VIEW_DEFINITIONS.some((view) => view.key === normalized)
  ) {
    return normalized as TaskCenterSavedViewKey;
  }

  return null;
}

export function isTaskAgentReady(task: WorkbenchDashboardTask): boolean {
  return (
    task.task.status === "pending" &&
    task.contextMissingKeys.length === 0 &&
    Boolean(task.project.localPath) &&
    Boolean(task.project.defaultCommand)
  );
}

export function getTaskPrimaryAction(task: Pick<
  WorkbenchDashboardTask,
  "task" | "project" | "contextMissingKeys"
>): {
  label: string;
  action: "start" | "fix_context" | "configure_environment" | "review_blocker" | "resume";
  enabled: boolean;
} {
  if (task.task.status === "blocked") {
    return {
      label: "解除阻塞",
      action: "review_blocker",
      enabled: true,
    };
  }

  if (task.task.status === "follow_up" || task.task.status === "interrupted") {
    return {
      label: "重新确认",
      action: "resume",
      enabled: true,
    };
  }

  if (task.contextMissingKeys.includes("local_path")) {
    return {
      label: "配置执行环境",
      action: "configure_environment",
      enabled: true,
    };
  }

  if (
    task.contextMissingKeys.includes("default_command") ||
    task.contextMissingKeys.includes("mcp_credentials")
  ) {
    return {
      label: "配置执行环境",
      action: "configure_environment",
      enabled: true,
    };
  }

  if (task.contextMissingKeys.length > 0) {
    return {
      label: "补齐上下文",
      action: "fix_context",
      enabled: true,
    };
  }

  if (task.task.status === "pending") {
    return {
      label: "开始",
      action: "start",
      enabled: true,
    };
  }

  return {
    label: "继续执行",
    action: "resume",
    enabled: true,
  };
}

export function getTaskContextCompleteness(task: WorkbenchDashboardTask): {
  complete: number;
  total: number;
} {
  const total = 5;

  return {
    complete: total - task.contextMissingKeys.length,
    total,
  };
}

export function buildTaskRiskSummary(task: WorkbenchDashboardTask): string {
  if (task.task.status === "blocked") {
    return "阻塞中";
  }

  if (task.task.status === "follow_up") {
    return "待跟进";
  }

  if (task.task.status === "interrupted") {
    return "已中断";
  }

  if (task.contextMissingKeys.includes("local_path")) {
    return "缺目录";
  }

  if (task.contextMissingKeys.includes("default_command")) {
    return "缺默认命令";
  }

  if (task.contextMissingKeys.includes("mcp_credentials")) {
    return "缺凭据";
  }

  if (task.contextMissingKeys.includes("documents")) {
    return "缺文档";
  }

  if (task.timeBucket === "overdue") {
    return "已逾期";
  }

  return "可执行";
}

export function buildTaskNextStepLabel(task: WorkbenchDashboardTask): string {
  if (task.task.status === "blocked") {
    return "解除阻塞";
  }

  if (task.task.status === "follow_up") {
    return "补跟进说明";
  }

  if (task.task.status === "interrupted") {
    return "重新确认";
  }

  if (task.contextMissingKeys.includes("local_path")) {
    return "配置目录";
  }

  if (task.contextMissingKeys.includes("default_command")) {
    return "配置命令";
  }

  if (task.contextMissingKeys.includes("documents")) {
    return "补任务文档";
  }

  if (task.contextMissingKeys.includes("mcp_credentials")) {
    return "签发凭据";
  }

  if (task.task.status === "pending") {
    return "开始处理";
  }

  return "继续执行";
}

export function filterTasksBySavedView(
  tasks: WorkbenchDashboardTask[],
  savedView: TaskCenterSavedViewKey | null,
): WorkbenchDashboardTask[] {
  if (!savedView) {
    return tasks;
  }

  switch (savedView) {
    case "today":
      return tasks.filter((task) => task.isToday);
    case "unscheduled":
      return tasks.filter(
        (task) => task.task.status === "pending" && task.timeBucket === "later",
      );
    case "missing_context":
      return tasks.filter((task) => task.contextMissingKeys.length > 0);
    case "agent_ready":
      return tasks.filter((task) => isTaskAgentReady(task));
    case "blocked":
      return tasks.filter((task) =>
        ["blocked", "follow_up", "interrupted"].includes(task.task.status),
      );
    default:
      return tasks;
  }
}

export function buildTaskCenterSummaries(tasks: WorkbenchDashboardTask[]) {
  const time = [
    { label: "今天", count: tasks.filter((task) => task.timeBucket === "today").length },
    { label: "已逾期", count: tasks.filter((task) => task.timeBucket === "overdue").length },
    { label: "未来 7 天", count: tasks.filter((task) => task.timeBucket === "next_7").length },
    { label: "以后或未安排", count: tasks.filter((task) => task.timeBucket === "later").length },
  ];

  const ownerMap = new Map<string, number>();
  const phaseMap = new Map<string, number>();

  for (const task of tasks) {
    ownerMap.set(task.assignee.name, (ownerMap.get(task.assignee.name) ?? 0) + 1);
    phaseMap.set(task.task.title, (phaseMap.get(task.task.title) ?? 0) + 1);
  }

  const owner = [...ownerMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([label, count]) => ({ label, count }));

  const phase = [...phaseMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([label, count]) => ({ label, count }));

  const risk = [
    { label: "阻塞", count: tasks.filter((task) => task.task.status === "blocked").length },
    { label: "缺上下文", count: tasks.filter((task) => task.contextMissingKeys.length > 0).length },
    { label: "Agent 可派单", count: tasks.filter((task) => isTaskAgentReady(task)).length },
    { label: "已逾期", count: tasks.filter((task) => task.timeBucket === "overdue").length },
  ];

  return {
    time,
    owner,
    phase,
    risk,
  };
}

export function buildTaskReportMetrics(tasks: WorkbenchDashboardTask[]) {
  recordLegacyTaskUsage({ kind: "read", surface: "workbench-task-report" });
  const now = Date.now();
  const blockedTasks = tasks.filter((task) =>
    ["blocked", "follow_up", "interrupted"].includes(task.task.status),
  );

  const blockerAging = [
    {
      label: "24h 内",
      count: blockedTasks.filter(
        (task) =>
          task.task.updatedAt &&
          now - task.task.updatedAt.getTime() < 1000 * 60 * 60 * 24,
      ).length,
    },
    {
      label: "1-3 天",
      count: blockedTasks.filter((task) => {
        if (!task.task.updatedAt) {
          return false;
        }

        const age = now - task.task.updatedAt.getTime();

        return age >= 1000 * 60 * 60 * 24 && age < 1000 * 60 * 60 * 24 * 3;
      }).length,
    },
    {
      label: "3 天以上",
      count: blockedTasks.filter(
        (task) =>
          task.task.updatedAt &&
          now - task.task.updatedAt.getTime() >= 1000 * 60 * 60 * 24 * 3,
      ).length,
    },
  ];

  const contextCompleteness = [
    {
      label: "5/5 完整",
      count: tasks.filter((task) => getTaskContextCompleteness(task).complete === 5).length,
    },
    {
      label: "3-4/5 可执行",
      count: tasks.filter((task) => {
        const complete = getTaskContextCompleteness(task).complete;

        return complete >= 3 && complete <= 4;
      }).length,
    },
    {
      label: "0-2/5 待补齐",
      count: tasks.filter((task) => getTaskContextCompleteness(task).complete <= 2).length,
    },
  ];

  const agentReadiness = [
    { label: "可直接派单", count: tasks.filter((task) => isTaskAgentReady(task)).length },
    {
      label: "缺本地环境",
      count: tasks.filter(
        (task) =>
          task.contextMissingKeys.includes("local_path") ||
          task.contextMissingKeys.includes("default_command"),
      ).length,
    },
    {
      label: "缺凭据",
      count: tasks.filter((task) => task.contextMissingKeys.includes("mcp_credentials")).length,
    },
    {
      label: "缺文档",
      count: tasks.filter((task) => task.contextMissingKeys.includes("documents")).length,
    },
  ];

  const throughput = [
    { label: "进行中", count: tasks.filter((task) => task.task.status === "active").length },
    { label: "待处理", count: tasks.filter((task) => task.task.status === "pending").length },
    {
      label: "受阻",
      count: tasks.filter((task) =>
        ["blocked", "follow_up", "interrupted"].includes(task.task.status),
      ).length,
    },
    { label: "需关注", count: tasks.filter((task) => task.requiresAttention).length },
  ];

  const projectMap = new Map<string, number>();

  for (const task of tasks) {
    projectMap.set(task.project.name, (projectMap.get(task.project.name) ?? 0) + 1);
  }

  const projectDistribution = [...projectMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));

  return {
    blockerAging,
    contextCompleteness,
    agentReadiness,
    throughput,
    projectDistribution,
  };
}
