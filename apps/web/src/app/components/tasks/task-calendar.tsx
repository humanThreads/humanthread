"use client";

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { TZDate } from "@date-fns/tz";
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import Link from "next/link";
import { CalendarClock, ChevronLeft, ChevronRight, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { buildTaskCalendarEntries } from "../../../lib/tasks/task-calendar";
import type { TaskListItem } from "./task-list";
import { buildTaskCenterHref } from "./task-detail-navigation";

function monthDate(month: string, timeZone: string) { const [year, value] = month.split("-").map(Number); return new TZDate(year!, value! - 1, 1, timeZone); }
function normalizedTasks(tasks: readonly TaskListItem[]) { return tasks.map((task) => ({ ...task, startAt: task.startAt ? new Date(task.startAt) : null, dueAt: task.dueAt ? new Date(task.dueAt) : null })); }
function moveDate(value: Date, dateKey: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const local = new TZDate(value, timeZone);
  return new Date(new TZDate(
    year!, month! - 1, day!,
    local.getHours(), local.getMinutes(), local.getSeconds(), local.getMilliseconds(),
    timeZone,
  ).getTime());
}

function CalendarEntry({ entry, queryString, currentTaskId }: { entry: { taskId: string; shortId: string | null; title: string; kind: "start" | "due"; dateKey: string; overdue: boolean }; queryString: string; currentTaskId?: string | undefined }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `${entry.kind}:${entry.taskId}`, data: { taskId: entry.taskId, kind: entry.kind } });
  return <Link ref={setNodeRef} {...attributes} {...listeners} data-task-detail-trigger="" aria-current={currentTaskId === entry.taskId ? "true" : undefined} href={buildTaskCenterHref(queryString, entry.taskId)} className={entry.overdue ? "flex min-h-6 items-center gap-1 rounded bg-[#fff8c5] px-1.5 py-1 text-[11px] font-semibold text-[#9a6700]" : "flex min-h-6 items-center gap-1 rounded bg-[#ddf4ff] px-1.5 py-1 text-[11px] text-[#0969da]"}>{entry.kind === "start" ? <Play size={10} /> : <CalendarClock size={10} />}{entry.kind === "start" ? "开始" : "截止"}{entry.shortId ? ` · ${entry.shortId}` : ""} · {entry.title}</Link>;
}

function CalendarDay({ dateKey, dayNumber, entries, queryString, currentTaskId }: { dateKey: string; dayNumber: string; entries: Array<{ taskId: string; shortId: string | null; title: string; kind: "start" | "due"; dateKey: string; overdue: boolean }>; queryString: string; currentTaskId?: string | undefined }) {
  const { setNodeRef, isOver } = useDroppable({ id: `date:${dateKey}`, data: { dateKey } });
  return <div ref={setNodeRef} data-date-key={dateKey} className={isOver ? "min-h-28 border-b border-r border-[#d0d7de] bg-[#ddf4ff] p-1.5" : "min-h-28 border-b border-r border-[#d0d7de] bg-white p-1.5"}><div className="mb-1 text-xs font-semibold text-[#57606a]">{dayNumber}</div><div className="space-y-1">{entries.map((entry) => <CalendarEntry key={`${entry.kind}:${entry.taskId}`} entry={entry} queryString={queryString} currentTaskId={currentTaskId} />)}</div></div>;
}

export function TaskCalendar({ tasks: initialTasks, timeZone, initialMonth, queryString, currentTaskId, onMoveDate }: {
  tasks: readonly TaskListItem[]; timeZone: string; initialMonth: string; queryString: string; currentTaskId?: string | undefined;
  onMoveDate(task: TaskListItem, payload: { startAt?: string; dueAt?: string }): Promise<void>;
}) {
  const [tasks, setTasks] = useState(() => normalizedTasks(initialTasks));
  const [month, setMonth] = useState(initialMonth);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const currentMonth = monthDate(month, timeZone);
  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 }) });
  const projection = useMemo(() => buildTaskCalendarEntries({ tasks, timeZone, now: new Date() }), [tasks, timeZone]);

  async function onDragEnd(event: DragEndEvent) {
    const active = event.active.data.current as { taskId?: string; kind?: "start" | "due" } | undefined;
    const dateKey = (event.over?.data.current as { dateKey?: string } | undefined)?.dateKey;
    const task = tasks.find((item) => item.id === active?.taskId);
    if (!task || !active?.kind || !dateKey) return;
    const original = active.kind === "start" ? task.startAt : task.dueAt;
    if (!original) return;
    const nextDate = moveDate(original, dateKey, timeZone);
    const payload = active.kind === "start" ? { startAt: nextDate.toISOString() } : { dueAt: nextDate.toISOString() };
    const before = tasks;
    setError(null);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, ...(active.kind === "start" ? { startAt: nextDate } : { dueAt: nextDate }) } : item));
    try { await onMoveDate(task, payload); }
    catch (caught) { setTasks(before); setError(caught instanceof Error ? caught.message : "调整日期失败"); }
  }

  function changeMonth(offset: number) { setMonth(format(addMonths(currentMonth, offset), "yyyy-MM")); }
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void onDragEnd(event)}>
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[#d0d7de] px-3"><button aria-label="上个月" title="上个月" onClick={() => changeMonth(-1)} className="grid h-8 w-8 place-items-center rounded-md border border-[#d0d7de]"><ChevronLeft size={15} /></button><div className="min-w-28 text-center text-sm font-semibold">{format(currentMonth, "yyyy 年 MM 月")}</div><button aria-label="下个月" title="下个月" onClick={() => changeMonth(1)} className="grid h-8 w-8 place-items-center rounded-md border border-[#d0d7de]"><ChevronRight size={15} /></button><span className="ml-auto text-xs text-[#57606a]">未排期 {projection.unscheduled.length}</span></div>
      {error ? <div role="alert" className="shrink-0 border-b border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-sm text-[#cf222e]">{error}</div> : null}
      <div className="hidden min-h-0 flex-1 overflow-y-auto md:block"><div className="grid grid-cols-7 border-l border-t border-[#d0d7de]">{["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((label) => <div key={label} className="border-b border-r border-[#d0d7de] bg-[#f6f8fa] px-2 py-1.5 text-xs font-semibold text-[#57606a]">{label}</div>)}{days.map((day) => { const dateKey = format(day, "yyyy-MM-dd"); return <CalendarDay key={dateKey} dateKey={dateKey} dayNumber={format(day, "d")} entries={projection.entries.filter((entry) => entry.dateKey === dateKey)} queryString={queryString} currentTaskId={currentTaskId} />; })}</div></div>
      <div aria-label="移动端任务议程" className="min-h-0 flex-1 overflow-y-auto p-3 md:hidden">{projection.entries.map((entry) => <div key={`${entry.kind}:${entry.taskId}`} data-date-key={entry.dateKey} className="flex min-h-10 items-center gap-3 border-b border-[#d8dee4] py-2"><span className="w-16 shrink-0 text-xs font-semibold text-[#57606a]">{entry.dateKey.slice(5)}</span><CalendarEntry entry={entry} queryString={queryString} currentTaskId={currentTaskId} /></div>)}{projection.unscheduled.length ? <section className="mt-4"><div className="text-xs font-semibold text-[#57606a]">未排期</div>{projection.unscheduled.map((task) => <Link key={task.id} data-task-detail-trigger="" aria-current={currentTaskId === task.id ? "true" : undefined} href={buildTaskCenterHref(queryString, task.id)} className="block border-b border-[#d8dee4] py-3 text-sm font-semibold text-[#0969da]">{task.shortId ? <div className="mb-0.5 font-mono text-[11px] font-normal text-[#57606a]">{task.shortId}</div> : null}<span className="block break-words">{task.title}</span></Link>)}</section> : null}</div>
    </div>
  </DndContext>;
}
