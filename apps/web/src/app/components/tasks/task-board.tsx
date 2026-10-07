"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import Link from "next/link";
import { AlertTriangle, CalendarClock, GripVertical } from "lucide-react";
import { useState } from "react";
import type { TaskGroup } from "../../../lib/tasks/task-query";
import type { TaskListItem } from "./task-list";
import { buildTaskCenterHref } from "./task-detail-navigation";

interface BoardOption { id: string; name: string }

const STATUS_COLUMNS = [
  ["backlog", "待规划"], ["todo", "待处理"], ["in_progress", "进行中"],
  ["in_review", "待验收"], ["completed", "已完成"], ["cancelled", "已取消"],
] as const;
const PRIORITY_COLUMNS = [["0", "普通"], ["1", "较高"], ["2", "高"], ["3", "紧急"]] as const;

function taskGroupKey(task: TaskListItem, group: TaskGroup) {
  if (group === "assignee") return task.assignee?.id ?? "unassigned";
  if (group === "priority") return String(task.priority);
  if (group === "project") return task.project?.id ?? "no_project";
  return task.statusCategory;
}

function boardColumns(group: TaskGroup, tasks: readonly TaskListItem[], members: readonly BoardOption[], projects: readonly BoardOption[]) {
  if (group === "status") return STATUS_COLUMNS.map(([key, label]) => ({ key, label }));
  if (group === "priority") return PRIORITY_COLUMNS.map(([key, label]) => ({ key, label }));
  if (group === "assignee") return [{ key: "unassigned", label: "未指派" }, ...members.map((item) => ({ key: item.id, label: item.name }))];
  return [{ key: "no_project", label: "无项目" }, ...projects.map((item) => ({ key: item.id, label: item.name }))];
}

function statusMoveCommand(from: string, to: string) {
  if (to === "cancelled" && !["completed", "cancelled"].includes(from)) return "cancel";
  const command = new Map([
    ["backlog:todo", "move_to_todo"], ["todo:in_progress", "start"],
    ["in_progress:in_review", "submit_for_review"], ["in_progress:completed", "complete"],
    ["in_review:completed", "accept"], ["completed:todo", "reopen"], ["cancelled:todo", "reopen"],
  ]).get(`${from}:${to}`);
  return command ?? null;
}

function DraggableTask({ task, queryString, currentTaskId }: { task: TaskListItem; queryString: string; currentTaskId?: string | undefined }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `task:${task.id}`, data: { taskId: task.id } });
  return <article ref={setNodeRef} className={isDragging ? "min-h-28 rounded-md border border-[#0969da] bg-white p-3 opacity-60 shadow-sm" : "min-h-28 rounded-md border border-[#d0d7de] bg-white p-3 shadow-sm"}>
    <div className="flex items-start gap-2">
      <button type="button" aria-label={`移动${task.title}`} title={`移动${task.title}`} {...attributes} {...listeners} className="grid h-7 w-7 shrink-0 place-items-center text-[#8c959f]"><GripVertical size={15} /></button>
      <div className="min-w-0 flex-1">{task.shortId ? <div className="mb-0.5 font-mono text-[11px] text-[#57606a]">{task.shortId}</div> : null}<Link data-task-detail-trigger="" aria-current={currentTaskId === task.id ? "true" : undefined} href={buildTaskCenterHref(queryString, task.id)} className="block break-words text-sm font-semibold text-[#0969da] hover:underline">{task.title}</Link><div className="mt-1 text-xs text-[#57606a]">{task.status.name}</div></div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#57606a]">
      {task.blocker ? <span className="inline-flex items-center gap-1 text-[#cf222e]"><AlertTriangle size={12} />阻塞</span> : null}
      {task.dueAt ? <span className="inline-flex items-center gap-1"><CalendarClock size={12} />{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(task.dueAt))}</span> : null}
      <span>{task.assignee?.name ?? "未指派"}</span>
    </div>
  </article>;
}

function BoardColumn({ groupKey, label, tasks, queryString, currentTaskId }: { groupKey: string; label: string; tasks: readonly TaskListItem[]; queryString: string; currentTaskId?: string | undefined }) {
  const { setNodeRef, isOver } = useDroppable({ id: `group:${groupKey}`, data: { groupKey } });
  return <section ref={setNodeRef} role="group" aria-label={label} className={isOver ? "flex h-full w-[288px] shrink-0 flex-col border-r border-[#d0d7de] bg-[#ddf4ff]" : "flex h-full w-[288px] shrink-0 flex-col border-r border-[#d0d7de] bg-[#f6f8fa]"}>
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#d0d7de] px-3 text-sm font-semibold"><span>{label}</span><span className="text-xs font-normal text-[#57606a]">{tasks.length}</span></div>
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-2">{tasks.map((task) => <DraggableTask key={task.id} task={task} queryString={queryString} currentTaskId={currentTaskId} />)}{tasks.length === 0 ? <div className="px-2 py-6 text-center text-xs text-[#8c959f]">暂无任务</div> : null}</div>
  </section>;
}

export function TaskBoard({ tasks: initialTasks, group, queryString, currentTaskId, members, projects, onMove }: {
  tasks: readonly TaskListItem[]; group: TaskGroup; queryString: string; currentTaskId?: string | undefined; members: readonly BoardOption[]; projects: readonly BoardOption[];
  onMove(task: TaskListItem, command: string, payload: Record<string, unknown>): Promise<void>;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const columns = boardColumns(group, tasks, members, projects);

  async function onDragEnd(event: DragEndEvent) {
    const taskId = (event.active.data.current as { taskId?: string } | undefined)?.taskId;
    const destination = (event.over?.data.current as { groupKey?: string } | undefined)?.groupKey;
    const task = tasks.find((item) => item.id === taskId);
    if (!task || !destination || taskGroupKey(task, group) === destination) return;
    let command = "update_fields";
    let payload: Record<string, unknown> = {};
    if (group === "status") {
      const mapped = statusMoveCommand(task.statusCategory, destination);
      if (!mapped) { setError("该状态不能直接流转，请先完成当前步骤。"); return; }
      command = mapped;
    } else if (group === "assignee") {
      if (destination === "unassigned") { setError("当前版本暂不支持取消负责人。"); return; }
      command = "assign"; payload = { assigneeUserId: destination };
    } else if (group === "priority") payload = { priority: Number(destination) };
    else payload = { projectId: destination === "no_project" ? null : destination };
    const before = tasks;
    setError(null);
    setTasks((current) => current.map((item) => item.id !== task.id ? item : {
      ...item,
      ...(group === "status" ? { statusCategory: destination, status: { ...item.status, category: destination, name: columns.find((column) => column.key === destination)?.label ?? destination } } : {}),
      ...(group === "assignee" ? { assignee: members.find((member) => member.id === destination) ? { ...members.find((member) => member.id === destination)!, avatarUrl: null } : null } : {}),
      ...(group === "priority" ? { priority: Number(destination) } : {}),
      ...(group === "project" ? { project: projects.find((project) => project.id === destination) ?? null } : {}),
    }));
    try { await onMove(task, command, payload); }
    catch (caught) { setTasks(before); setError(caught instanceof Error ? caught.message : "移动任务失败"); }
  }

  return <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={(event) => void onDragEnd(event)}>
    <div role="region" aria-label="任务看板" className="flex h-full min-h-0 overflow-x-auto overscroll-contain">
      {columns.map((column) => <BoardColumn key={column.key} groupKey={column.key} label={column.label} tasks={tasks.filter((task) => taskGroupKey(task, group) === column.key)} queryString={queryString} currentTaskId={currentTaskId} />)}
    </div>
    {error ? <div role="alert" className="absolute inset-x-3 bottom-3 z-20 rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-sm text-[#cf222e] shadow-lg">{error}</div> : null}
  </DndContext>;
}
