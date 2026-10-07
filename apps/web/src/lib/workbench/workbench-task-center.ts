import type {
  WorkbenchDashboardFilterKey,
  WorkbenchDashboardTask,
  WorkbenchDashboardTaskGroup,
  WorkbenchDashboardViewKey,
} from "./workbench-dashboard";
import {
  filterTasksBySavedView,
  type TaskCenterSavedViewKey,
} from "./workbench-task-analytics";
import { recordLegacyTaskUsage } from "../tasks/task-rollout";

export type TaskCenterTemplateKey =
  | "requirement-review"
  | "agent-dispatch"
  | "knowledge-sync";

export type TaskCenterIntentKey = "dispatch_by_owner" | "clear_risk";

export interface TaskCenterTemplatePreset {
  key: TaskCenterTemplateKey;
  title: string;
  description: string;
  savedView: TaskCenterSavedViewKey;
  quickCreate: {
    titlePrefix: string;
    phase: "确认需求" | "执行中" | "验证中" | "等待反馈";
    priority: "high" | "medium" | "low";
    acceptanceCriteria: string[];
    requiredDocs: string[];
    agentPrerequisites: string[];
  };
}

export interface TaskCenterIntentDefinition {
  key: TaskCenterIntentKey;
  title: string;
  description: string;
}

const TEMPLATE_PRESETS: Record<TaskCenterTemplateKey, TaskCenterTemplatePreset> = {
  "requirement-review": {
    key: "requirement-review",
    title: "需求确认模板",
    description: "适合从任务中心快速发起一个带验收标准的事项。",
    savedView: "missing_context",
    quickCreate: {
      titlePrefix: "需求确认：",
      phase: "确认需求",
      priority: "medium",
      acceptanceCriteria: ["明确目标边界", "列出验收条件", "补齐负责人"],
      requiredDocs: ["需求说明", "验收标准"],
      agentPrerequisites: ["可选，不强依赖 Agent"],
    },
  },
  "agent-dispatch": {
    key: "agent-dispatch",
    title: "Agent 派单模板",
    description: "先检查目录、默认命令和凭据，再派给 Agent 执行。",
    savedView: "agent_ready",
    quickCreate: {
      titlePrefix: "Agent 派单：",
      phase: "执行中",
      priority: "high",
      acceptanceCriteria: ["命令可运行", "本地目录有效", "输出结果可验证"],
      requiredDocs: ["执行说明", "回滚策略"],
      agentPrerequisites: ["本地目录", "默认命令", "MCP 凭据"],
    },
  },
  "knowledge-sync": {
    key: "knowledge-sync",
    title: "文档沉淀模板",
    description: "把任务说明、验收标准和复盘写回文档中心。",
    savedView: "missing_context",
    quickCreate: {
      titlePrefix: "文档沉淀：",
      phase: "等待反馈",
      priority: "medium",
      acceptanceCriteria: ["文档路径明确", "版本更新可追踪", "复盘结论完整"],
      requiredDocs: ["任务说明", "复盘文档", "相关知识库链接"],
      agentPrerequisites: ["如需 Agent 写文档，则补齐 MCP 凭据"],
    },
  },
};

const INTENT_DEFINITIONS: Record<TaskCenterIntentKey, TaskCenterIntentDefinition> = {
  dispatch_by_owner: {
    key: "dispatch_by_owner",
    title: "派单视图",
    description: "当前视图按负责人组织任务，便于确认谁可立即接单、谁还缺前置。",
  },
  clear_risk: {
    key: "clear_risk",
    title: "风险清理视图",
    description: "当前视图按风险聚合任务，优先清理阻塞、缺凭据和缺文档事项。",
  },
};

export interface TaskCenterDerivedState {
  visibleTasks: WorkbenchDashboardTask[];
  visibleSelectedTaskId: string | null;
  visibleDetailTaskId: string | null;
  visibleGroups: WorkbenchDashboardTaskGroup[];
}

export function normalizeTaskCenterTemplateKey(
  value: string | undefined,
): TaskCenterTemplateKey | null {
  const normalized = value?.trim();

  if (normalized && normalized in TEMPLATE_PRESETS) {
    return normalized as TaskCenterTemplateKey;
  }

  return null;
}

export function normalizeTaskCenterIntentKey(
  value: string | undefined,
): TaskCenterIntentKey | null {
  const normalized = value?.trim();

  if (normalized && normalized in INTENT_DEFINITIONS) {
    return normalized as TaskCenterIntentKey;
  }

  return null;
}

export function getTaskCenterTemplateDefinition(
  key: TaskCenterTemplateKey,
): TaskCenterTemplatePreset {
  return TEMPLATE_PRESETS[key];
}

export function getTaskCenterIntentDefinition(
  key: TaskCenterIntentKey,
): TaskCenterIntentDefinition {
  return INTENT_DEFINITIONS[key];
}

export function getAllTaskCenterTemplateDefinitions(): TaskCenterTemplatePreset[] {
  return Object.values(TEMPLATE_PRESETS);
}

export function buildTaskCenterRoute(input: {
  savedView?: TaskCenterSavedViewKey | null;
  filterKey?: WorkbenchDashboardFilterKey;
  viewKey?: WorkbenchDashboardViewKey;
  taskId?: string | null;
  spaceKey?: string | null;
  templateKey?: TaskCenterTemplateKey | null;
  intentKey?: TaskCenterIntentKey | null;
}): string {
  const params = new URLSearchParams();

  if (input.spaceKey && input.spaceKey !== "all") {
    params.set("space", input.spaceKey);
    params.set("spaceKey", input.spaceKey);
  }

  if (input.filterKey && input.filterKey !== "all") {
    params.set("filter", input.filterKey);
  }

  if (input.viewKey && input.viewKey !== "time") {
    params.set("view", input.viewKey);
  }

  if (input.taskId) {
    params.set("taskId", input.taskId);
  }

  if (input.savedView) {
    params.set("savedView", input.savedView);
  }

  if (input.templateKey) {
    params.set("template", input.templateKey);
  }

  if (input.intentKey) {
    params.set("intent", input.intentKey);
  }

  const query = params.toString();
  return query ? `/tasks?${query}` : "/tasks";
}

export function deriveTaskCenterState(input: {
  allTasks: WorkbenchDashboardTask[];
  inboxGroups: WorkbenchDashboardTaskGroup[];
  selectedTaskId: string | null;
  detailTaskId: string | null;
  savedView: TaskCenterSavedViewKey | null;
}): TaskCenterDerivedState {
  recordLegacyTaskUsage({ kind: "read", surface: "workbench-task-center" });
  const visibleTasks = filterTasksBySavedView(input.allTasks, input.savedView);
  const visibleTaskIds = new Set(visibleTasks.map((task) => task.task.id));
  const visibleSelectedTaskId =
    input.selectedTaskId && visibleTaskIds.has(input.selectedTaskId)
      ? input.selectedTaskId
      : visibleTasks[0]?.task.id ?? null;
  const visibleDetailTaskId =
    input.detailTaskId && visibleTaskIds.has(input.detailTaskId)
      ? input.detailTaskId
      : visibleSelectedTaskId;

  return {
    visibleTasks,
    visibleSelectedTaskId,
    visibleDetailTaskId,
    visibleGroups: input.inboxGroups
      .map((group) => ({
        ...group,
        tasks: group.tasks.filter((task) => visibleTaskIds.has(task.task.id)),
      }))
      .filter((group) => group.tasks.length > 0),
  };
}
