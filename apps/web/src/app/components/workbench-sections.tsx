import Link from "next/link";
import type { TaskStatus } from "@humanthread/shared";
import type { WorkbenchOverviewResult } from "../../lib/workbench/workbench-overview";
import { PROJECT_SPACE_SEARCH_PARAM } from "../../lib/workbench/workbench-space-filters";
import type {
  WorkbenchDashboardDetail,
  WorkbenchDashboardExecutionLink,
  WorkbenchDashboardFilterKey,
  WorkbenchDashboardStat,
  WorkbenchDashboardTask,
  WorkbenchDashboardTaskGroup,
  WorkbenchDashboardViewKey,
} from "../../lib/workbench/workbench-dashboard";
import type { WorkbenchProjectOverview } from "../../lib/workbench/workbench-projects";
import { describeWorkbenchTimelinePayload } from "../../lib/workbench/workbench-timeline";
import {
  getWorkbenchDeviceStatusHint,
  getWorkbenchDeviceStatusLabel,
  getWorkbenchDeviceStatusTone,
} from "../../lib/workbench/workbench-device-status";
import {
  getWorkbenchDeviceAuthorizationActionLabel,
  getWorkbenchDeviceAuthorizationPrompt,
  orderWorkbenchDevicesForDisplay,
} from "../../lib/workbench/workbench-device-display";
import type {
  TaskCenterIntentDefinition,
  TaskCenterTemplatePreset,
} from "../../lib/workbench/workbench-task-center";
import {
  getTaskPrimaryAction,
  type TaskCenterSavedViewKey,
} from "../../lib/workbench/workbench-task-analytics";
import {
  createWorkbenchWorkflowAction,
  openWorkbenchLocalAction,
  setWorkbenchUserAction,
  submitWorkbenchTaskAction,
} from "../workbench/actions";
import { CurrentTaskActionDialogs } from "./current-task-console-dialogs";
import { DeviceAuthorizationControl } from "./device-authorization-control";
import { LocalAgentBindingCodePanel } from "./local-agent-binding-code-panel";
import { LocalAgentTokenPanel } from "./local-agent-token-panel";
import {
  Callout,
  EmptyState,
  Panel,
  StatusPill,
  WorkbenchButton,
} from "./workbench-ui";
import { WorkbenchQuickCreateFormFields } from "./workbench-quick-create-form-fields";

type TimelineEvent = WorkbenchOverviewResult["timeline"]["events"][number];

export function formatWorkbenchDateTime(value: Date | string | null | undefined): string {
  if (!value) {
    return "未记录";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未记录";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatQueueTaskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case "pending":
      return "待处理";
    case "active":
      return "进行中";
    case "completed":
      return "已完成";
    case "blocked":
      return "已阻塞";
    case "interrupted":
      return "已中断";
    case "follow_up":
      return "待跟进";
    case "transferred":
      return "已转交";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

function getTaskStatusTone(
  status: TaskStatus,
): "default" | "success" | "danger" | "warning" | "blue" {
  switch (status) {
    case "active":
      return "blue";
    case "completed":
      return "success";
    case "blocked":
    case "interrupted":
      return "danger";
    case "follow_up":
    case "pending":
      return "warning";
    default:
      return "default";
  }
}

function buildDashboardHref(input: {
  pathname: string;
  filterKey?: WorkbenchDashboardFilterKey;
  viewKey?: WorkbenchDashboardViewKey;
  taskId?: string | null;
  selectedSpaceKey?: string;
  savedView?: TaskCenterSavedViewKey | null;
  templateKey?: string | null;
  intentKey?: string | null;
}): string {
  const params = new URLSearchParams();

  if (input.selectedSpaceKey && input.selectedSpaceKey !== "all") {
    params.set(PROJECT_SPACE_SEARCH_PARAM, input.selectedSpaceKey);
    params.set("spaceKey", input.selectedSpaceKey);
  }

  if (input.filterKey && input.filterKey !== "all") {
    params.set("filter", input.filterKey);
  }

  if (input.viewKey) {
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

  return query ? `${input.pathname}?${query}` : input.pathname;
}

function buildEnvironmentHints(task: WorkbenchDashboardTask): string[] {
  const hints: string[] = [];

  if (!task.project.localPath) {
    hints.push("未配置本地目录");
  }

  if (!task.project.defaultCommand) {
    hints.push("未配置默认命令");
  }

  if (task.contextMissingKeys.includes("mcp_credentials")) {
    hints.push("缺少 MCP 凭据");
  }

  return hints;
}

function formatTaskQueueLabel(task: WorkbenchDashboardTask): string | null {
  return task.displayQueueLabel;
}

function formatTaskPriorityLabel(priority: WorkbenchDashboardTask["priority"]): string {
  switch (priority) {
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
    default:
      return "低";
  }
}

function buildTaskRiskReason(task: WorkbenchDashboardTask): string | null {
  if (task.task.status === "blocked") {
    return task.toolSession?.lastOutputSummary
      ? `阻塞原因：${task.toolSession.lastOutputSummary}`
      : "阻塞原因：等待人工处理";
  }

  if (task.task.status === "follow_up") {
    return "风险提示：等待补充跟进说明";
  }

  if (task.task.status === "interrupted") {
    return "风险提示：任务已中断，待重新确认";
  }

  if (task.timeBucket === "overdue") {
    return "风险提示：已超过建议处理窗口";
  }

  return null;
}

function SmallTaskActionRow({
  task,
  taskHref,
}: {
  task: WorkbenchDashboardTask;
  taskHref: string;
}) {
  const primaryAction = getTaskPrimaryAction(task);
  const shouldShowStart =
    primaryAction.action === "start" && task.task.status === "pending";
  const shouldShowOpenLocal =
    Boolean(task.project.localPath && task.project.defaultCommand);

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {shouldShowStart ? (
        <form action={submitWorkbenchTaskAction}>
          <input type="hidden" name="taskId" value={task.task.id} />
          <input type="hidden" name="actionType" value="start" />
          <WorkbenchButton type="submit" size="small" variant="primary">
            {primaryAction.label}
          </WorkbenchButton>
        </form>
      ) : primaryAction.action !== "resume" ? (
        <WorkbenchButton href={taskHref} size="small" variant="primary">
          {primaryAction.label}
        </WorkbenchButton>
      ) : null}
      {shouldShowOpenLocal ? (
        <form action={openWorkbenchLocalAction}>
          <input type="hidden" name="taskId" value={task.task.id} />
          <input type="hidden" name="projectPath" value={task.project.localPath ?? ""} />
          <input
            type="hidden"
            name="command"
            value={task.project.defaultCommand ?? ""}
          />
          <WorkbenchButton type="submit" size="small" variant="ghost">
            打开本地
          </WorkbenchButton>
        </form>
      ) : null}
      <WorkbenchButton href={taskHref} size="small" variant="ghost">
        查看详情
      </WorkbenchButton>
    </div>
  );
}

export function SelectedTaskContextPanel({
  detail,
  title = "当前关注任务",
}: {
  detail: WorkbenchDashboardDetail | null;
  title?: string;
}) {
  if (!detail) {
    return null;
  }

  return (
    <Panel
      title={title}
      action={
        <StatusPill tone={getTaskStatusTone(detail.task.task.status)}>
          {formatQueueTaskStatusLabel(detail.task.task.status)}
        </StatusPill>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="text-sm font-semibold text-[#24292f]">
            {detail.task.workflow.title}
          </div>
          <div className="mt-1 text-xs text-[#57606a]">
            {detail.task.project.name}
            {detail.task.displayQueueLabel ? ` · ${detail.task.displayQueueLabel}` : ""}
          </div>
        </div>
        <div className="text-sm leading-6 text-[#57606a]">
          当前步骤：{detail.task.task.title}
        </div>
        <div className="text-sm leading-6 text-[#57606a]">
          下一步：{detail.nextAction.label}
        </div>
        <div className="flex flex-wrap gap-2">
          <WorkbenchButton href={`/tasks/${detail.task.task.id}`} size="small">
            打开任务详情
          </WorkbenchButton>
          <WorkbenchButton href="/tasks" size="small" variant="ghost">
            回到任务中心
          </WorkbenchButton>
        </div>
      </div>
    </Panel>
  );
}

export function DashboardStatsCards({
  pathname,
  stats,
  activeFilter,
  activeView,
  selectedTaskId,
  selectedSpaceKey,
}: {
  pathname: string;
  stats: WorkbenchDashboardStat[];
  activeFilter: WorkbenchDashboardFilterKey;
  activeView: WorkbenchDashboardViewKey;
  selectedTaskId: string | null;
  selectedSpaceKey?: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {stats.map((stat) => {
        const isDevices = stat.key === "devices";
        const statFilterKey = isDevices
          ? null
          : (stat.key as WorkbenchDashboardFilterKey);
        const isActive = statFilterKey !== null && statFilterKey === activeFilter;
        const href = isDevices
          ? "/settings/devices"
          : buildDashboardHref({
              pathname,
              ...(statFilterKey ? { filterKey: statFilterKey } : {}),
              viewKey: activeView,
              taskId: selectedTaskId,
              ...(selectedSpaceKey ? { selectedSpaceKey } : {}),
            });

        return (
          <Link
            key={stat.key}
            href={href}
            className={[
              "rounded-lg border bg-white p-4 transition hover:border-[#0969da] hover:bg-[#f6f8fa]",
              isActive
                ? "border-[#0969da] bg-[#ddf4ff]"
                : "border-[#d0d7de]",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#57606a]">
              {stat.label}
            </div>
            <div className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-[#24292f]">
              {stat.count}
            </div>
            <div className="mt-2 text-xs leading-5 text-[#57606a]">
              {stat.description}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export function TaskInboxPanel({
  pathname,
  activeFilter,
  activeView,
  selectedTaskId,
  selectedSpaceKey,
  groups,
  savedView,
  templatePreset,
  intentDefinition,
}: {
  pathname: string;
  activeFilter: WorkbenchDashboardFilterKey;
  activeView: WorkbenchDashboardViewKey;
  selectedTaskId: string | null;
  selectedSpaceKey?: string;
  groups: WorkbenchDashboardTaskGroup[];
  savedView?: TaskCenterSavedViewKey | null;
  templatePreset?: TaskCenterTemplatePreset | null;
  intentDefinition?: TaskCenterIntentDefinition | null;
}) {
  const filterLabel =
    activeFilter === "today"
      ? "今天"
      : activeFilter === "overdue"
        ? "已逾期"
        : activeFilter === "blocked"
          ? "阻塞"
          : activeFilter === "queue"
            ? "排队"
            : activeFilter === "context"
              ? "上下文缺口"
              : "全部";
  const viewLabel =
    activeView === "owner"
      ? "按责任"
      : activeView === "phase"
        ? "按阶段"
        : activeView === "risk"
          ? "按风险"
          : "按时间";
  const viewTabs: Array<{
    key: WorkbenchDashboardViewKey;
    label: string;
  }> = [
    { key: "time", label: "按时间" },
    { key: "owner", label: "按责任" },
    { key: "phase", label: "按阶段" },
    { key: "risk", label: "按风险" },
  ];

  return (
    <Panel title="任务收件箱">
      <div className="space-y-5">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {viewTabs.map((view) => {
              const href = buildDashboardHref({
                pathname,
                filterKey: activeFilter,
                viewKey: view.key,
                taskId: selectedTaskId,
                ...(selectedSpaceKey ? { selectedSpaceKey } : {}),
                ...(savedView ? { savedView } : {}),
                ...(templatePreset ? { templateKey: templatePreset.key } : {}),
                ...(intentDefinition ? { intentKey: intentDefinition.key } : {}),
              });

              return (
                <Link
                  key={view.key}
                  href={href}
                  className={[
                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                    view.key === activeView
                      ? "border-[#0969da] bg-[#ddf4ff] text-[#0a3069]"
                      : "border-[#d0d7de] bg-white text-[#57606a] hover:border-[#0969da] hover:text-[#0969da]",
                  ].join(" ")}
                >
                  {view.label}
                </Link>
              );
            })}
          </div>
          <div className="text-xs font-medium text-[#57606a]">
            当前筛选：
            {savedView
              ? `${savedView === "today" ? "今日" : savedView === "unscheduled" ? "未安排" : savedView === "missing_context" ? "缺上下文" : savedView === "agent_ready" ? "Agent 可派单" : "阻塞"} · ${viewLabel}`
              : `${filterLabel} · ${viewLabel}`}
          </div>
          {templatePreset ? (
            <div className="text-xs text-[#0969da]">模板状态：已应用 {templatePreset.title}</div>
          ) : null}
          {intentDefinition ? (
            <div className="text-xs text-[#57606a]">视图状态：{intentDefinition.title}</div>
          ) : null}
        </div>
        {groups.length > 0 ? (
          <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.key}>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[#24292f]">{group.title}</div>
                  <div className="mt-1 text-xs text-[#57606a]">{group.description}</div>
                </div>
                <div className="text-xs font-medium text-[#57606a]">
                  {group.tasks.length} 项
                </div>
              </div>
              <div className="space-y-3">
                {group.tasks.map((task) => {
                  const isSelected = task.task.id === selectedTaskId;
                  const taskHref = buildDashboardHref({
                    pathname,
                    filterKey: activeFilter,
                    viewKey: activeView,
                    taskId: task.task.id,
                    ...(selectedSpaceKey ? { selectedSpaceKey } : {}),
                    ...(savedView ? { savedView } : {}),
                    ...(templatePreset ? { templateKey: templatePreset.key } : {}),
                    ...(intentDefinition ? { intentKey: intentDefinition.key } : {}),
                  });
                  const environmentHints = buildEnvironmentHints(task);
                  const taskRiskReason = buildTaskRiskReason(task);
                  const isRiskTask =
                    task.task.status === "blocked" ||
                    task.task.status === "follow_up" ||
                    task.task.status === "interrupted" ||
                    task.timeBucket === "overdue";

                  return (
                    <div
                      key={task.task.id}
                      className={[
                        "rounded-lg border p-4 transition",
                        isSelected && isRiskTask
                          ? "border-[#cf222e] bg-[#ffebe9]"
                          : isSelected
                          ? "border-[#0969da] bg-[#ddf4ff]"
                          : isRiskTask
                            ? "border-[#cf222e] bg-[#fff5f5] hover:border-[#a40e26]"
                          : "border-[#d0d7de] bg-white hover:border-[#8c959f]",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusPill tone={getTaskStatusTone(task.task.status)}>
                              {formatQueueTaskStatusLabel(task.task.status)}
                            </StatusPill>
                            <span className="text-xs font-semibold text-[#57606a]">
                              阶段 · {task.task.title}
                            </span>
                          </div>
                          <Link
                            href={taskHref}
                            className="mt-2 block text-base font-semibold text-[#24292f] hover:text-[#0969da]"
                          >
                            {task.workflow.title}
                          </Link>
                          <div className="mt-2 text-sm text-[#57606a]">
                            {task.project.name} · {task.project.spaceLabel ?? "公司空间"}
                            {formatTaskQueueLabel(task)
                              ? ` · ${formatTaskQueueLabel(task)}`
                              : ""}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#57606a]">
                            <span>负责人 · {task.assignee.name}</span>
                            <span>优先级 {formatTaskPriorityLabel(task.priority)}</span>
                            <span>{task.timeBucketLabel}</span>
                          </div>
                          {environmentHints.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                              {environmentHints.map((hint) => (
                                <span
                                  key={`${task.task.id}:${hint}`}
                                  className="rounded-full border border-[#d0d7de] bg-[#f6f8fa] px-2 py-0.5 font-medium text-[#57606a]"
                                >
                                  {hint}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {taskRiskReason ? (
                            <div className="mt-2 text-xs font-medium text-[#cf222e]">
                              {taskRiskReason}
                            </div>
                          ) : null}
                          <SmallTaskActionRow task={task} taskHref={taskHref} />
                        </div>
                        <div className="shrink-0 text-xs text-[#57606a]">
                          最后活动 {formatWorkbenchDateTime(task.task.updatedAt)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          </div>
        ) : (
          <EmptyState
            title="当前筛选下没有任务"
            description="可以切换统计卡查看其他任务，或直接快速创建新事项。"
            action={
              <WorkbenchButton href="#quick-create-panel" size="small">
                创建首个事项
              </WorkbenchButton>
            }
          />
        )}
      </div>
    </Panel>
  );
}

export function CurrentTaskConsole({
  detail,
}: {
  detail: WorkbenchDashboardDetail | null;
}) {
  if (!detail) {
    return (
      <Panel title="当前任务详情">
        <EmptyState
          title="当前没有打开任务"
          description="可以先从项目空间或快速创建入口发起事项。"
          action={
            <WorkbenchButton href="#quick-create-panel" size="small">
              创建首个事项
            </WorkbenchButton>
          }
        />
      </Panel>
    );
  }

  return (
    <Panel
      title="当前任务详情"
      action={
        <StatusPill tone={getTaskStatusTone(detail.task.task.status)}>
          {formatQueueTaskStatusLabel(detail.task.task.status)}
        </StatusPill>
      }
    >
      <div className="space-y-5">
        <div>
          <div className="text-xs font-semibold text-[#57606a]">当前阶段</div>
          <h2 className="mt-1 text-2xl font-semibold text-[#24292f]">
            {detail.task.workflow.title}
          </h2>
          <p className="mt-2 text-sm text-[#57606a]">{detail.task.task.title}</p>
          <p className="mt-2 text-sm text-[#57606a]">
            {detail.task.project.name}
            {formatTaskQueueLabel(detail.task)
              ? ` · ${formatTaskQueueLabel(detail.task)}`
              : ""}
          </p>
        </div>

        <div className="grid gap-3 rounded-lg border border-[#d0d7de] bg-[#f6f8fa] p-4 sm:grid-cols-2">
          {[
            ["负责人", detail.metadata.ownerLabel],
            ["Agent 协同", detail.metadata.agentLabel],
            ["优先级", detail.metadata.priorityLabel],
            ["处理窗口", detail.metadata.dueLabel],
            ["阶段", detail.metadata.phaseLabel],
            ["项目", detail.metadata.projectLabel],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#57606a]">
                {label}
              </div>
              <div className="mt-1 text-sm font-medium text-[#24292f]">{value}</div>
            </div>
          ))}
        </div>

        <Callout title={detail.nextAction.label}>
          {detail.nextAction.description}
        </Callout>

        {detail.workflowDescription ? (
          <div className="rounded-md border border-[#d8dee4] bg-[#f6f8fa] p-3 text-sm leading-6 text-[#57606a]">
            {detail.workflowDescription}
          </div>
        ) : null}

        <CurrentTaskActionDialogs
          taskId={detail.task.task.id}
          projectPath={detail.task.project.localPath}
          command={detail.task.project.defaultCommand}
          missingContextKeys={detail.task.contextMissingKeys as Array<
            "documents" | "local_path" | "default_command" | "mcp_credentials"
          >}
          taskStatus={
            detail.task.task.status as
              | "pending"
              | "active"
              | "blocked"
              | "interrupted"
              | "follow_up"
              | "completed"
          }
        />

        <ExecutionHooksPanel
          links={
            detail.executionLinks?.length > 0
              ? detail.executionLinks
              : buildFallbackExecutionLinks(detail)
          }
        />

        <div className="rounded-lg border border-[#d0d7de] bg-white">
          <div className="border-b border-[#d8dee4] px-4 py-3">
            <div className="text-sm font-semibold text-[#24292f]">
              上下文完整度 {detail.context.complete} / {detail.context.total}
            </div>
          </div>
          <div className="grid gap-3 p-4">
            {detail.context.items.map((item) => (
              <div
                key={item.key}
                className="flex items-start justify-between gap-3 rounded-md border border-[#d8dee4] bg-[#f6f8fa] px-3 py-2"
              >
                <div>
                  <div className="text-sm font-semibold text-[#24292f]">{item.label}</div>
                  <div className="mt-1 text-xs leading-5 text-[#57606a]">{item.detail}</div>
                </div>
                <StatusPill tone={item.complete ? "success" : "default"}>
                  {item.complete ? "已就绪" : "待补齐"}
                </StatusPill>
              </div>
            ))}
          </div>
        </div>

        {detail.relatedDocuments.length > 0 ? (
          <div>
            <div className="text-sm font-semibold text-[#24292f]">相关文档</div>
            <div className="mt-3 space-y-2">
              {detail.relatedDocuments.map((document) => (
                <Link
                  key={document.id}
                  href={`/projects/${encodeURIComponent(document.projectId)}/documents/${encodeURIComponent(document.id)}`}
                  className="block rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-3 py-2 text-sm text-[#24292f] hover:border-[#0969da]"
                >
                  <div className="font-medium">{document.title}</div>
                  <div className="mt-1 text-xs text-[#57606a]">{document.path}</div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {detail.risks.length > 0 ? (
          <div>
            <div className="text-sm font-semibold text-[#24292f]">风险提示</div>
            <div className="mt-3 space-y-2">
              {detail.risks.map((risk) => (
                <div
                  key={risk.id}
                  className={[
                    "rounded-md border px-3 py-2",
                    risk.tone === "danger"
                      ? "border-[#cf222e33] bg-[#ffebe9]"
                      : risk.tone === "warning"
                        ? "border-[#d4a72c33] bg-[#fff8c5]"
                        : risk.tone === "blue"
                          ? "border-[#0969da33] bg-[#ddf4ff]"
                          : "border-[#d0d7de] bg-[#f6f8fa]",
                  ].join(" ")}
                >
                  <div className="text-sm font-semibold text-[#24292f]">{risk.title}</div>
                  <div className="mt-1 text-xs leading-5 text-[#57606a]">
                    {risk.description}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <div className="text-sm font-semibold text-[#24292f]">工作流时间线</div>
          <div className="mt-3 space-y-3">
            {detail.timelineEvents.map((event) => {
              const payloadLines = describeWorkbenchTimelinePayload(event.payload);

              return (
                <div
                  key={event.id}
                  className="rounded-md border border-[#d8dee4] bg-[#f6f8fa] px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[#24292f]">{event.type}</div>
                    <div className="text-xs text-[#57606a]">
                      {formatWorkbenchDateTime(event.createdAt)}
                    </div>
                  </div>
                  <div className="mt-1 text-sm text-[#57606a]">
                    {event.message ?? event.task.title}
                  </div>
                  {payloadLines.length > 0 ? (
                    <div className="mt-2 space-y-1 text-xs text-[#0969da]">
                      {payloadLines.map((line) => (
                        <div key={`${event.id}:${line}`}>{line}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function ExecutionHooksPanel({
  links,
}: {
  links: WorkbenchDashboardExecutionLink[];
}) {
  return (
    <div>
      <div className="text-sm font-semibold text-[#24292f]">执行联动</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-lg border border-[#d0d7de] bg-[#f6f8fa] px-3 py-3 transition hover:border-[#0969da] hover:bg-[#ddf4ff]"
          >
            <div className="text-sm font-semibold text-[#24292f]">{link.label}</div>
            <div className="mt-1 text-xs leading-5 text-[#57606a]">{link.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function buildFallbackExecutionLinks(detail: WorkbenchDashboardDetail): WorkbenchDashboardExecutionLink[] {
  return [
    {
      label: "任务详情",
      href: `/tasks/${encodeURIComponent(detail.task.task.id)}`,
      description: "打开这条事项的独立任务详情页。",
    },
    {
      label: "任务中心",
      href: "/tasks",
      description: "回到任务中心继续在分组视图中推进当前事项。",
    },
    {
      label: "项目详情",
      href: `/projects/${encodeURIComponent(detail.task.project.id)}?taskId=${encodeURIComponent(detail.task.task.id)}`,
      description: "查看事项所属项目和相关配置。",
    },
    {
      label: "团队协作",
      href: `/team?taskId=${encodeURIComponent(detail.task.task.id)}`,
      description: "查看负责人和团队线程占用情况。",
    },
    {
      label: "通知中心",
      href: `/notifications?taskId=${encodeURIComponent(detail.task.task.id)}`,
      description: "查看与当前事项相关的提醒与动态。",
    },
  ];
}

export function TimelinePanel({ events }: { events: TimelineEvent[] }) {
  const latestEvents = events.slice(-8).reverse();

  return (
    <Panel title="工作流时间线">
      {latestEvents.length > 0 ? (
        <div className="space-y-3">
          {latestEvents.map((event) => {
            const payloadLines = describeWorkbenchTimelinePayload(event.payload);

            return (
              <div key={event.id} className="border-b border-[#d8dee4] pb-3 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-[#24292f]">{event.type}</div>
                  <div className="text-xs text-[#57606a]">
                    {formatWorkbenchDateTime(event.createdAt)}
                  </div>
                </div>
                <div className="mt-1 text-sm text-[#57606a]">
                  {event.message ?? event.task.title}
                </div>
                {payloadLines.length > 0 ? (
                  <div className="mt-2 space-y-1 text-xs text-[#0969da]">
                    {payloadLines.map((line) => (
                      <div key={`${event.id}:${line}`}>{line}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="暂无时间线事件"
          description="当前没有可展示的时间线事件。"
        />
      )}
    </Panel>
  );
}

export function TeamSnapshotPanel({
  members,
  selectedUserId,
  allowUserSwitch = true,
}: {
  members: WorkbenchOverviewResult["members"];
  selectedUserId: string;
  allowUserSwitch?: boolean;
}) {
  return (
    <Panel title="团队快照">
      {allowUserSwitch ? (
        <form action={setWorkbenchUserAction} className="mb-3 flex flex-wrap gap-2">
          {members.map((member) => (
            <button
              key={member.user.id}
              type="submit"
              name="userId"
              value={member.user.id}
              className={
                member.user.id === selectedUserId
                  ? "rounded-full border border-[#0969da] bg-[#ddf4ff] px-3 py-1 text-xs font-semibold text-[#0969da]"
                  : "rounded-full border border-[#d0d7de] bg-white px-3 py-1 text-xs font-semibold text-[#57606a]"
              }
            >
              {member.user.name}
            </button>
          ))}
        </form>
      ) : (
        <div className="mb-3 rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-3 py-2 text-xs text-[#57606a]">
          已启用邮箱登录会话。团队快照仅用于观察，不再通过按钮切换当前用户。
        </div>
      )}
      <div className="space-y-3">
        {members.map((member) => (
          <div key={member.user.id} className="rounded-md border border-[#d0d7de] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[#24292f]">
                  {member.user.name}
                </div>
                <div className="mt-1 text-xs text-[#57606a]">
                  {member.user.status} · 队列 {member.queueLength}
                </div>
              </div>
              <div className="text-xs text-[#57606a]">
                {formatWorkbenchDateTime(member.user.lastSeenAt)}
              </div>
            </div>
            <div className="mt-2 text-sm text-[#57606a]">
              {member.currentTask
                ? `${member.currentTask.workflow.title} · ${member.currentTask.task.title}`
                : "当前空闲"}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function DeviceAgentPanel({
  devices,
  userId,
}: {
  devices: WorkbenchOverviewResult["devices"];
  userId: string;
}) {
  const orderedDevices = orderWorkbenchDevicesForDisplay(devices);
  const pendingDeviceCount = orderedDevices.filter(
    (device) => device.status === "pending",
  ).length;

  return (
    <Panel
      title={
        pendingDeviceCount > 0
          ? `设备与 Agent（${pendingDeviceCount} 台待授权）`
          : "设备与 Agent"
      }
    >
      <div className="space-y-3">
        {orderedDevices.length > 0 ? (
          orderedDevices.map((device) => (
            <div key={device.id} className="rounded-md border border-[#d0d7de] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[#24292f]">{device.name}</div>
                  <div className="mt-1 text-xs text-[#57606a]">
                    {device.platform} · {device.user.name}
                  </div>
                  <div
                    className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getWorkbenchDeviceStatusTone(device.status)}`}
                  >
                    {getWorkbenchDeviceStatusLabel(device.status)}
                  </div>
                  <div className="mt-2 text-xs leading-5 text-[#57606a]">
                    {getWorkbenchDeviceStatusHint(device.status)}
                  </div>
                  <div className="mt-2 rounded-md border border-[#d8dee4] bg-[#f6f8fa] px-2 py-1.5 text-xs leading-5 text-[#57606a]">
                    <div>设备 ID：{device.id}</div>
                    <div>{getWorkbenchDeviceAuthorizationPrompt(device)}</div>
                  </div>
                </div>
                <div className="text-xs text-[#57606a]">
                  {formatWorkbenchDateTime(device.lastSeenAt)}
                </div>
              </div>
              <DeviceAuthorizationControl
                deviceId={device.id}
                mode={device.status === "authorized" ? "revoke" : "authorize"}
                label={getWorkbenchDeviceAuthorizationActionLabel(device.status)}
              />
            </div>
          ))
        ) : (
          <EmptyState
            title="暂无本地设备"
            description="当前还没有已登记的本地设备。"
          />
        )}
      </div>
      <div className="mt-4 border-t border-[#d8dee4] pt-4">
        <LocalAgentBindingCodePanel userId={userId} />
      </div>
      <div className="mt-4 border-t border-[#d8dee4] pt-4">
        <LocalAgentTokenPanel userId={userId} />
      </div>
    </Panel>
  );
}

export function AgentCenterPanel({
  devices,
  userId,
  credentialCount,
  activeTaskCount,
  dispatchSummary,
}: {
  devices: WorkbenchOverviewResult["devices"];
  userId: string;
  credentialCount: number;
  activeTaskCount: number;
  dispatchSummary?: {
    readyCount: number;
    missingContextCount: number;
    riskCount: number;
  };
}) {
  const authorizedCount = devices.filter((device) => device.status === "authorized").length;
  const pendingCount = devices.filter((device) => device.status === "pending").length;
  const revokedCount = devices.filter((device) => device.status === "revoked").length;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.9fr)]">
      <div className="grid content-start gap-5">
        <Panel title="Agent 概览">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-[#d0d7de] bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#57606a]">可用 Agent</div>
              <div className="mt-2 text-3xl font-semibold text-[#24292f]">{authorizedCount}</div>
              <div className="mt-2 text-xs text-[#57606a]">已授权设备可直接接管任务</div>
            </div>
            <div className="rounded-lg border border-[#d0d7de] bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#57606a]">待授权</div>
              <div className="mt-2 text-3xl font-semibold text-[#24292f]">{pendingCount}</div>
              <div className="mt-2 text-xs text-[#57606a]">等待人工确认的新设备</div>
            </div>
            <div className="rounded-lg border border-[#d0d7de] bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#57606a]">活跃任务</div>
              <div className="mt-2 text-3xl font-semibold text-[#24292f]">{activeTaskCount}</div>
              <div className="mt-2 text-xs text-[#57606a]">当前收件箱中的进行中事项</div>
            </div>
            <div className="rounded-lg border border-[#d0d7de] bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#57606a]">MCP 凭据</div>
              <div className="mt-2 text-3xl font-semibold text-[#24292f]">{credentialCount}</div>
              <div className="mt-2 text-xs text-[#57606a]">可供 Agent 使用的凭据数量</div>
            </div>
          </div>
        </Panel>

        <DeviceAgentPanel devices={devices} userId={userId} />
      </div>

      <div className="grid content-start gap-5">
        <Panel title="凭据与风险">
          <div className="space-y-3">
            <Callout title={credentialCount > 0 ? "MCP 凭据已就绪" : "缺少 MCP 凭据"}>
              {credentialCount > 0
                ? "当前账号已有可用 MCP 凭据，可继续把 Agent 派到需要外部能力的任务。"
                : "当前账号还没有可用 MCP 凭据，涉及外部服务的任务会卡在手动处理阶段。"}
            </Callout>
            <Callout title={pendingCount > 0 ? "有设备待授权" : "设备授权状态稳定"}>
              {pendingCount > 0
                ? `还有 ${pendingCount} 台设备等待授权，建议先确认设备归属后再派单。`
                : revokedCount > 0
                  ? `当前有 ${revokedCount} 台设备处于撤销状态，可在需要时重新授权。`
                  : "当前没有待处理的设备授权风险。"}
            </Callout>
          </div>
        </Panel>

        <Panel title="调度入口">
          <div className="grid gap-2">
            <Callout title="派单预览">
              可派单 {dispatchSummary?.readyCount ?? 0} · 缺前置{" "}
              {dispatchSummary?.missingContextCount ?? 0} · 需清风险{" "}
              {dispatchSummary?.riskCount ?? 0}
            </Callout>
            <WorkbenchButton href="/tasks?view=owner&intent=dispatch_by_owner">
              按负责人派单
            </WorkbenchButton>
            <WorkbenchButton href="/tasks?view=risk&intent=clear_risk" size="small">
              先清风险任务
            </WorkbenchButton>
            <WorkbenchButton href="/settings/mcp" size="small">管理 MCP 凭据</WorkbenchButton>
            <WorkbenchButton href="/downloads" size="small">下载 Agent</WorkbenchButton>
          </div>
        </Panel>
        <Panel title="危险操作">
          <div className="space-y-2 text-xs text-[#57606a]">
            <div>确认撤销授权</div>
            <div>确认生成绑定码</div>
            <div>确认生成新 Token</div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function QuickCreatePanel({
  projects = [],
  selectedProjectId,
  selectedSpaceKey,
  templatePreset,
}: {
  projects?: WorkbenchProjectOverview[];
  selectedProjectId?: string;
  selectedSpaceKey?: string;
  templatePreset?: TaskCenterTemplatePreset;
}) {
  return (
    <div id="quick-create-panel">
      <Panel title="快速创建入口">
        <form action={createWorkbenchWorkflowAction} className="grid gap-3">
          <input
            type="hidden"
            name="spaceKey"
            value={selectedSpaceKey ?? "all"}
          />
          {templatePreset ? (
            <>
              <div className="rounded-lg border border-[#b6d7f2] bg-[#ddf4ff] px-4 py-3 text-sm text-[#0a3069]">
                <div className="font-semibold">已应用{templatePreset.title}</div>
                <div className="mt-1 text-xs leading-5">{templatePreset.description}</div>
              </div>
              <div className="rounded-lg border border-[#d0d7de] bg-[#f6f8fa] px-4 py-3 text-xs leading-5 text-[#57606a]">
                <div className="font-semibold text-[#24292f]">从模板创建事项</div>
                <div className="mt-1">
                  预填阶段、优先级、验收标准、所需文档和 Agent 前置条件，创建后可继续细化。
                </div>
              </div>
            </>
          ) : null}
          <WorkbenchQuickCreateFormFields
            projects={projects}
            {...(selectedProjectId ? { selectedProjectId } : {})}
            {...(templatePreset ? { templatePreset } : {})}
          />
          <WorkbenchButton type="submit" variant="primary">
            {templatePreset ? "从模板创建事项" : "创建事项"}
          </WorkbenchButton>
        </form>
      </Panel>
    </div>
  );
}
