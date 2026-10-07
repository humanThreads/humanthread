"use client";

import { Ban, History, Pencil, Play, Plus, Power, RotateCcw, Square } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import type {
  ProjectScheduledTaskListItem,
  ProjectScheduledTaskLoopOption,
  ProjectScheduledTaskTargetOption,
} from "../../../lib/orchestration/scheduled-task-read-model";
import { EmptyState, Panel, StatusPill, WorkbenchButton } from "../workbench-ui";
import { ProjectScheduledTaskDialog } from "./project-scheduled-task-dialog";

export const PROJECT_SCHEDULED_TASK_STATUS_FILTERS = [
  { value: "all", label: "全部" },
  { value: "inactive", label: "未启用" },
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "禁用" },
] as const;

export type ProjectScheduledTaskStatusFilter = typeof PROJECT_SCHEDULED_TASK_STATUS_FILTERS[number]["value"];

type StatusCommand = "enable" | "deactivate" | "disable" | "restore";

export function ProjectScheduledTaskList({
  projectId,
  status,
  tasks,
  loopOptions,
  targetOptions,
  canEdit,
}: {
  projectId: string;
  status: ProjectScheduledTaskStatusFilter;
  tasks: ProjectScheduledTaskListItem[];
  loopOptions: ProjectScheduledTaskLoopOption[];
  targetOptions: ProjectScheduledTaskTargetOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const currentSearchParams = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectScheduledTaskListItem | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function navigateToStatus(nextStatus: ProjectScheduledTaskStatusFilter) {
    const query = new URLSearchParams(currentSearchParams.toString());
    query.set("project", projectId);
    query.set("status", nextStatus);
    router.push(`${pathname}?${query.toString()}`);
  }

  async function runCommand(task: ProjectScheduledTaskListItem, command: StatusCommand) {
    setBusyTaskId(task.id);
    setError(null);
    try {
      await requestJson(`/api/projects/${encodeURIComponent(projectId)}/scheduled-tasks/${encodeURIComponent(task.id)}/commands`, {
        command,
        commandId: commandId(),
        expectedVersion: task.version,
      });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "状态更新失败");
    } finally {
      setBusyTaskId(null);
    }
  }

  async function runNow(task: ProjectScheduledTaskListItem) {
    setBusyTaskId(task.id);
    setError(null);
    try {
      await requestJson(`/api/projects/${encodeURIComponent(projectId)}/scheduled-tasks/${encodeURIComponent(task.id)}/commands`, {
        command: "run_now",
        commandId: commandId(),
      });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "手动执行失败");
    } finally {
      setBusyTaskId(null);
    }
  }

  return (
    <section className="grid min-w-0 w-full gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" className="flex max-w-full gap-1 overflow-x-auto rounded-md border border-[#d0d7de] bg-white p-1" aria-label="状态筛选">
          {PROJECT_SCHEDULED_TASK_STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={status === filter.value}
              onClick={() => navigateToStatus(filter.value)}
              className={status === filter.value
                ? "shrink-0 rounded bg-[#0969da] px-3 py-1.5 text-xs font-semibold text-white"
                : "shrink-0 rounded px-3 py-1.5 text-xs font-semibold text-[#24292f] hover:bg-[#f6f8fa]"}
            >
              {filter.label}
            </button>
          ))}
        </div>
        {canEdit ? (
          <WorkbenchButton type="button" size="small" variant="primary" className="ml-auto" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" size={14} />新建定时任务
          </WorkbenchButton>
        ) : null}
      </div>

      {error ? <div role="alert" className="rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-sm text-[#cf222e]">{error}</div> : null}

      <Panel title="任务清单" action={<span className="text-xs font-normal text-[#57606a]">{tasks.length} 个任务</span>} className="min-w-0">
        {tasks.length === 0 ? (
          <EmptyState
            title="当前筛选下没有定时任务"
            description={canEdit ? "新建任务后保持未启用状态，确认配置无误后再单独启用。" : "当前状态下没有可展示的定时任务。"}
            action={canEdit ? <WorkbenchButton type="button" size="small" variant="primary" onClick={() => setCreateOpen(true)}><Plus aria-hidden="true" size={14} />新建定时任务</WorkbenchButton> : undefined}
          />
        ) : (
          <div className="min-w-0 overflow-x-auto rounded-md border border-[#d8dee4]" role="table" aria-label="定时任务列表">
            <div role="row" className="hidden min-w-[1360px] grid-cols-[minmax(260px,1.5fr)_minmax(190px,0.9fr)_minmax(220px,1.1fr)_minmax(220px,1.1fr)_minmax(200px,0.9fr)_minmax(260px,auto)] gap-5 bg-[#f6f8fa] px-5 py-3 text-xs font-semibold text-[#57606a] lg:grid">
              <span role="columnheader">任务</span>
              <span role="columnheader">排期</span>
              <span role="columnheader">Loop 流程</span>
              <span role="columnheader">执行目标</span>
              <span role="columnheader">最近运行</span>
              <span role="columnheader" className="text-right">操作</span>
            </div>
            <div className="divide-y divide-[#d8dee4]">
              {tasks.map((task) => {
                const manualReason = task.activeRun
                  ? "已有运行未结束"
                  : task.status === "disabled"
                    ? "禁用状态下不可手动执行"
                    : null;
                const busy = busyTaskId === task.id;

                return (
                  <article
                    key={task.id}
                    data-testid={`scheduled-task-${task.id}`}
                    role="row"
                    className="grid min-w-0 gap-5 px-5 py-5 lg:min-w-[1360px] lg:grid-cols-[minmax(260px,1.5fr)_minmax(190px,0.9fr)_minmax(220px,1.1fr)_minmax(220px,1.1fr)_minmax(200px,0.9fr)_minmax(260px,auto)] lg:items-start"
                  >
                    <div role="cell" className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <div className="break-words text-sm font-semibold text-[#24292f]">{task.name}</div>
                        <StatusPill tone={task.status === "enabled" ? "success" : task.status === "disabled" ? "danger" : "warning"}>{statusLabel(task.status)}</StatusPill>
                        {task.activeRun ? <span className="text-xs font-semibold text-[#9a6700]">已有运行未结束</span> : null}
                      </div>
                      <p className="mt-2 line-clamp-2 max-w-[52ch] break-words text-xs leading-5 text-[#57606a]">{task.description || "未填写说明"}</p>
                      <div className="mt-2 text-xs text-[#6e7781]">{task.contentMode === "platform" ? "平台维护内容" : "项目自行管理内容"}</div>
                    </div>

                    <div role="cell" className="min-w-0 text-xs leading-5 text-[#57606a]">
                      <div className="break-all font-mono text-[#24292f]">{task.cronExpression}</div>
                      <div className="mt-1">{task.timezone}</div>
                      <div className="mt-1">下次执行：{formatDateTime(task.nextRunAt)}</div>
                    </div>

                    <div role="cell" className="min-w-0 text-xs leading-5 text-[#57606a]">
                      <div className="break-words font-semibold text-[#24292f]">{task.loopBinding?.name ?? "Loop 不可用"}</div>
                      <div className="mt-1">{task.loopBinding ? `${scopeLabel(task.loopBinding.scope)} · v${task.loopBinding.versionNumber ?? "-"}` : "请重新选择启用 Loop"}</div>
                    </div>

                    <div role="cell" className="min-w-0 text-xs leading-5 text-[#57606a]">
                      <div className="break-words font-semibold text-[#24292f]">{task.executionTarget?.displayName ?? "执行目标不可用"}</div>
                      <div className="mt-1">{task.executionTarget ? targetTypeLabel(task.executionTarget.type) : "请重新选择执行目标"}</div>
                    </div>

                    <div role="cell" className="min-w-0 text-xs leading-5 text-[#57606a]">
                      {task.latestRun ? (
                        <>
                          <div className="font-semibold text-[#24292f]">{runStatusLabel(task.latestRun.status)}</div>
                          <div className="mt-1">{formatDateTime(task.latestRun.finishedAt ?? task.latestRun.triggeredAt)}</div>
                          <div className="mt-1">{task.latestRun.durationMs === null ? "耗时未记录" : `耗时 ${formatDuration(task.latestRun.durationMs)}`}</div>
                        </>
                      ) : <div className="text-[#6e7781]">暂无运行记录</div>}
                      <Link
                        href={`/projects/${encodeURIComponent(projectId)}/scheduled-tasks/${encodeURIComponent(task.id)}?tab=logs`}
                        aria-label={`查看${task.name}运行日志与任务报告`}
                        className="mt-2 inline-flex items-center gap-1.5 font-semibold text-[#0969da] hover:underline"
                      >
                        <History aria-hidden="true" size={13} />运行日志与报告
                      </Link>
                      {task.latestRun?.reportEntry ? (
                        <div>
                          <Link href={task.latestRun.reportEntry.href} className="mt-1 inline-flex font-semibold text-[#0969da] hover:underline">
                            {task.latestRun.reportEntry.label}
                          </Link>
                        </div>
                      ) : null}
                    </div>

                    {canEdit ? (
                      <div role="cell" className="flex min-w-0 flex-wrap items-start justify-start gap-2 lg:justify-end">
                        <WorkbenchButton type="button" size="small" className="disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={() => setEditingTask(task)}><Pencil aria-hidden="true" size={13} />编辑</WorkbenchButton>
                        {task.status === "inactive" ? <WorkbenchButton type="button" size="small" variant="primary" className="disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={() => void runCommand(task, "enable")}><Power aria-hidden="true" size={13} />启用</WorkbenchButton> : null}
                        {task.status === "enabled" ? <WorkbenchButton type="button" size="small" className="disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={() => void runCommand(task, "deactivate")}><Square aria-hidden="true" size={12} />停用</WorkbenchButton> : null}
                        {task.status !== "disabled" ? <WorkbenchButton type="button" size="small" variant="danger" className="disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={() => void runCommand(task, "disable")}><Ban aria-hidden="true" size={13} />禁用</WorkbenchButton> : null}
                        {task.status === "disabled" ? <WorkbenchButton type="button" size="small" className="disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={() => void runCommand(task, "restore")}><RotateCcw aria-hidden="true" size={13} />恢复</WorkbenchButton> : null}
                        <WorkbenchButton type="button" size="small" className="disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || manualReason !== null} title={manualReason ?? undefined} onClick={() => void runNow(task)}><Play aria-hidden="true" size={13} />手动执行</WorkbenchButton>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </Panel>

      {createOpen ? (
        <ProjectScheduledTaskDialog
          projectId={projectId}
          mode="create"
          loopOptions={loopOptions}
          targetOptions={targetOptions}
          onCancel={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            router.refresh();
          }}
        />
      ) : null}
      {editingTask ? (
        <ProjectScheduledTaskDialog
          key={`${editingTask.id}:${editingTask.version}`}
          projectId={projectId}
          mode="edit"
          task={editingTask}
          loopOptions={loopOptions}
          targetOptions={targetOptions}
          onCancel={() => setEditingTask(null)}
          onSaved={() => {
            setEditingTask(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

async function requestJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.error ?? "请求失败");
}

function commandId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `scheduled-task-${Date.now().toString(36)}`;
}

function statusLabel(status: string): string {
  if (status === "enabled") return "启用";
  if (status === "disabled") return "禁用";
  return "未启用";
}

function scopeLabel(scope: "project" | "task"): string {
  return scope === "project" ? "项目级" : "任务级";
}

function runStatusLabel(status: string): string {
  return ({
    preparing: "准备中",
    running: "运行中",
    waiting: "等待处理",
    succeeded: "成功",
    failed: "失败",
    cancelled: "已取消",
    blocked: "已阻止",
  } as Record<string, string>)[status] ?? status;
}

function formatDateTime(value: string | null): string {
  if (!value) return "未安排";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs} 毫秒`;
  const seconds = Math.round(durationMs / 1_000);
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function targetTypeLabel(type: "local_agent" | "linux_worker_pool"): string {
  return type === "local_agent" ? "Local Agent" : "Worker Pool";
}
