"use client";

import Link from "next/link";
import { AlertTriangle, Ban, CalendarClock, CheckCircle2, CircleAlert, Clock3, Pause, Play, RotateCcw, Workflow } from "lucide-react";
import type { CSSProperties } from "react";
import { buildTaskCenterHref } from "./task-detail-navigation";

export const TASK_LIST_COLUMNS = ["任务", "状态", "负责人", "优先级", "截止时间", "项目", "子任务"] as const;

export interface TaskListItem {
  id: string;
  shortId: string | null;
  title: string;
  statusCategory: string;
  status: { id: string | null; name: string; category: string; color: string };
  visibility: string;
  priority: number;
  startAt: Date | string | null;
  dueAt: Date | string | null;
  overdue: boolean;
  version: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  createdById: string | null;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
  project: { id: string; name: string } | null;
  blocker: { id: string; reason: string; ownerUserId: string | null; createdAt: Date | string } | null;
  archivedAt?: Date | string | null;
  labels: Array<{ id: string; name: string; color: string }>;
  childCount: number;
  automation: unknown;
  loopRun?: {
    id: string;
    status: string;
    progress: { completed: number; total: number; percent: number };
    pendingInteraction?: { id: string; kind: string; status: string } | null;
  } | null;
}

const PRIORITIES: Record<number, string> = { 0: "普通", 1: "较高", 2: "高", 3: "紧急" };

function formatDate(value: Date | string | null) {
  if (!value) return "未安排";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function statusCommands(status: string) {
  if (status === "backlog") return [["move_to_todo", "移到待处理"], ["cancel", "取消"]];
  if (status === "todo") return [["start", "开始"], ["cancel", "取消"]];
  if (status === "in_progress") return [["submit_for_review", "提交验收"], ["complete", "完成"], ["cancel", "取消"]];
  if (status === "in_review") return [["accept", "通过"], ["reject", "驳回"], ["cancel", "取消"]];
  return [["reopen", "重新打开"]];
}

function TaskLoopIndicator({ loopRun }: { loopRun: NonNullable<TaskListItem["loopRun"]> }) {
  const status = loopRun.status;
  const meta = status === "running"
    ? { label: "进行中", color: "#0969da", Icon: Play }
    : status === "paused" || status === "waiting"
      ? { label: status === "waiting" ? "等待中" : "已暂停", color: "#9a6700", Icon: status === "waiting" ? Clock3 : Pause }
      : status === "cancelled"
        ? { label: "已中止", color: "#57606a", Icon: Ban }
        : status === "failed" || status === "exhausted"
          ? { label: "失败", color: "#cf222e", Icon: CircleAlert }
          : { label: "已完成", color: "#1f883d", Icon: CheckCircle2 };
  const percent = Math.max(0, Math.min(100, loopRun.progress.percent));
  return <div className="mt-2 flex min-w-0 items-center gap-2" data-testid="task-loop-indicator">
    <Workflow aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#57606a]" />
    <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-[#d8dee4]" role="progressbar" aria-label={`Loop 运行进度 ${percent}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <div className="h-full rounded-full bg-[#0969da] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
    </div>
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium" style={{ color: meta.color }} title={`Loop ${meta.label}`} aria-label={`Loop 状态：${meta.label}`}>
      <meta.Icon aria-hidden="true" className="h-3.5 w-3.5" />
      <span className="sr-only">{meta.label}</span>
    </span>
  </div>;
}

export function TaskList({ tasks, selectedTaskIds, currentTaskId, queryString = "", loading = false, error, archivedView = false, onSelectionChange, onCommand }: {
  tasks: readonly TaskListItem[]; selectedTaskIds: string[]; currentTaskId?: string | undefined; queryString?: string; loading?: boolean; error?: string; archivedView?: boolean;
  onSelectionChange(ids: string[]): void; onCommand(task: TaskListItem, command: string): Promise<void> | void;
}) {
  if (loading) return <div role="status" className="grid h-full place-items-center text-sm text-[#57606a]">正在加载任务...</div>;
  if (error) return <div role="alert" className="m-4 rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-4 py-3 text-sm text-[#cf222e]">{error}</div>;
  if (!tasks.length) return <div className="grid h-full place-items-center p-8 text-center"><div><div className="font-semibold text-[#24292f]">{archivedView ? "没有已归档任务" : "当前视图没有任务"}</div><p className="mt-1 text-sm text-[#57606a]">{archivedView ? "归档的任务会集中出现在这里，可随时恢复。" : "调整筛选条件或创建一个新任务。"}</p></div></div>;

  function toggle(taskId: string) {
    onSelectionChange(selectedTaskIds.includes(taskId) ? selectedTaskIds.filter((id) => id !== taskId) : [...selectedTaskIds, taskId]);
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
      <div className="hidden min-w-[920px] md:block">
        <div className="sticky top-0 z-10 grid grid-cols-[40px_minmax(260px,2fr)_150px_140px_100px_120px_minmax(130px,1fr)_90px] border-b border-[#d0d7de] bg-[#f6f8fa] px-3 text-xs font-semibold text-[#57606a]">
          <div className="py-2" />{TASK_LIST_COLUMNS.map((column) => <div key={column} className="px-2 py-2">{column}</div>)}
        </div>
        {tasks.map((task) => (
          <div key={task.id} className={task.overdue ? "grid grid-cols-[40px_minmax(260px,2fr)_150px_140px_100px_120px_minmax(130px,1fr)_90px] border-b border-[#d8dee4] bg-[#fff8c5]/25 px-3 text-sm" : "grid grid-cols-[40px_minmax(260px,2fr)_150px_140px_100px_120px_minmax(130px,1fr)_90px] border-b border-[#d8dee4] px-3 text-sm hover:bg-[#f6f8fa]"}>
            <div className="flex items-center"><input type="checkbox" aria-label={`选择${task.title}`} checked={selectedTaskIds.includes(task.id)} onChange={() => toggle(task.id)} /></div>
            <div className="min-w-0 px-2 py-3">{task.shortId ? <div className="mb-0.5 font-mono text-[11px] text-[#57606a]">{task.shortId}</div> : null}<Link data-task-detail-trigger="" aria-current={currentTaskId === task.id ? "true" : undefined} href={buildTaskCenterHref(queryString, task.id)} className="block break-words font-semibold text-[#0969da] hover:underline">{task.title}</Link>{task.loopRun ? <TaskLoopIndicator loopRun={task.loopRun} /> : null}{task.blocker ? <div className="mt-1 flex items-center gap-1 text-xs text-[#cf222e]"><AlertTriangle size={13} />{task.blocker.reason}</div> : null}<div className="mt-1 flex flex-wrap gap-1">{task.labels.map((label) => <span key={label.id} style={{ "--label-color": label.color } as CSSProperties} className="rounded border border-[var(--label-color)] px-1.5 py-0.5 text-[11px] text-[var(--label-color)]">{label.name}</span>)}</div></div>
            <div className="flex items-center px-2">{archivedView ? <button aria-label={`恢复${task.title}`} title="恢复任务" onClick={() => void onCommand(task, "restore")} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d0d7de] bg-white px-2 text-xs font-semibold text-[#1f883d] hover:bg-[#f6f8fa]"><RotateCcw size={13} />恢复</button> : <select aria-label={`${task.title}的状态`} defaultValue="" onChange={(event) => { if (event.target.value) void onCommand(task, event.target.value); }} className="h-8 max-w-full rounded-md border border-[#d0d7de] bg-white px-2 text-xs"><option value="">{task.status.name}</option>{statusCommands(task.statusCategory).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}</div>
            <div className="flex items-center px-2 text-[#57606a]">{task.assignee?.name ?? "未指派"}</div>
            <div className="flex items-center px-2">{PRIORITIES[task.priority] ?? `P${task.priority}`}</div>
            <div className={task.overdue ? "flex items-center gap-1 px-2 font-semibold text-[#9a6700]" : "flex items-center gap-1 px-2 text-[#57606a]"}><CalendarClock size={13} />{formatDate(task.dueAt)}{task.overdue ? <span className="sr-only">已逾期</span> : null}</div>
            <div className="flex min-w-0 items-center px-2 text-[#57606a]"><span className="truncate">{task.project?.name ?? "无项目"}</span></div>
            <div className="flex items-center px-2 text-[#57606a]">{task.childCount ? `${task.childCount} 项` : "-"}</div>
          </div>
        ))}
      </div>
      <div data-mobile-task-list className="grid gap-2 p-3 md:hidden">
        {tasks.map((task) => <article key={task.id} className="rounded-md border border-[#d0d7de] bg-white p-3"><div className="flex items-start gap-2"><input type="checkbox" aria-label={`选择${task.title}`} checked={selectedTaskIds.includes(task.id)} onChange={() => toggle(task.id)} /><div className="min-w-0 flex-1">{task.shortId ? <div className="mb-0.5 font-mono text-[11px] text-[#57606a]">{task.shortId}</div> : null}<Link data-task-detail-trigger="" aria-current={currentTaskId === task.id ? "true" : undefined} href={buildTaskCenterHref(queryString, task.id)} className="break-words font-semibold text-[#0969da]">{task.title}</Link>{task.loopRun ? <TaskLoopIndicator loopRun={task.loopRun} /> : null}<div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#57606a]"><span>{task.status.name}</span><span>{task.assignee?.name ?? "未指派"}</span><span>{formatDate(task.dueAt)}</span>{task.overdue ? <span className="font-semibold text-[#9a6700]">已逾期</span> : null}{archivedView ? <button aria-label={`恢复${task.title}`} title="恢复任务" onClick={() => void onCommand(task, "restore")} className="inline-flex h-7 items-center gap-1 rounded-md border border-[#d0d7de] bg-white px-2 font-semibold text-[#1f883d]"><RotateCcw size={12} />恢复</button> : null}</div></div></div></article>)}
      </div>
    </div>
  );
}
