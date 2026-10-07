"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, BookmarkPlus, Pencil, Plus, Settings2, Tags, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ParsedTaskQuery } from "../../../lib/tasks/task-query";
import { createTaskCommandId } from "../../../lib/tasks/task-command-id";
import { TaskBoard } from "./task-board";
import { TaskCalendar } from "./task-calendar";
import { TaskDetailPanel } from "./task-detail-panel";
import { buildTaskCenterHref } from "./task-detail-navigation";
import type { TaskDetailView } from "./task-detail";
import { TaskLabelSettingsDialog, type TaskLabelOption } from "./task-label-settings-dialog";
import { TaskList, type TaskListItem } from "./task-list";
import { TaskStatusSettingsDialog, type TaskStatusDefinitionOption } from "./task-status-settings-dialog";
import { TaskToolbar } from "./task-toolbar";

interface TaskCollectionView {
  listRows: readonly TaskListItem[];
  boardGroups: ReadonlyArray<{ key: string; tasks: readonly TaskListItem[] }>;
  calendar: {
    entries: ReadonlyArray<{ taskId: string; title: string; kind: "start" | "due"; at: Date | string; dateKey: string; overdue: boolean }>;
    unscheduled: readonly TaskListItem[];
  };
  relationCounts: Record<string, number>;
  total: number;
  page?: number;
  pageSize?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
}

interface SavedView { id: string; name: string; filters?: unknown }

export interface TaskCenterProps {
  collection: TaskCollectionView; query: ParsedTaskQuery; queryString: string; spaceId?: string; canManageSettings: boolean;
  savedViews: readonly SavedView[]; statusDefinitions: readonly TaskStatusDefinitionOption[]; labels: readonly TaskLabelOption[];
  projects: ReadonlyArray<{ id: string; name: string }>; members?: ReadonlyArray<{ id: string; name: string }>;
  selectedDetail?: TaskDetailView | null;
  detailMembers?: Array<{ id: string; name: string }>;
  detailProjects?: Array<{ id: string; name: string }>;
  detailLabels?: Array<{ id: string; name: string; color: string }>;
  agentProfiles?: Array<{ id: string; name: string; provider: string; status: string }>;
  initialSelectedTaskIds?: string[];
}

export function TaskCenter({ collection, query, queryString, spaceId, canManageSettings, savedViews: initialSavedViews, statusDefinitions, labels, projects, members = [], selectedDetail = null, detailMembers = [], detailProjects = [], detailLabels = [], agentProfiles = [], initialSelectedTaskIds = [] }: TaskCenterProps) {
  const router = useRouter();
  const queryTaskId = new URLSearchParams(queryString).get("taskId");
  const [selectedTaskIds, setSelectedTaskIds] = useState(initialSelectedTaskIds);
  const [savedViews, setSavedViews] = useState(initialSavedViews);
  const [saveOpen, setSaveOpen] = useState(false);
  const [renamingView, setRenamingView] = useState<SavedView | null>(null);
  const [viewName, setViewName] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detailNavigation, setDetailNavigation] = useState<{ target: string | null; pending: boolean }>(() => ({ target: queryTaskId, pending: false }));
  const previousQueryTaskId = useRef(queryTaskId);

  useEffect(() => {
    if (previousQueryTaskId.current === queryTaskId) return;
    previousQueryTaskId.current = queryTaskId;
    setDetailNavigation((current) => {
      if (current.pending) return current.target === queryTaskId ? { ...current, pending: false } : current;
      return { target: queryTaskId, pending: false };
    });
  }, [queryTaskId]);

  function dismissDetail() { setDetailNavigation({ target: null, pending: true }); }

  useEffect(() => {
    if (detailNavigation.target === null) return;

    function dismissAndNavigate() {
      dismissDetail();
      router.push(buildTaskCenterHref(queryString));
    }

    function handleClick(event: MouseEvent) {
      if (event.target instanceof Element && event.target.closest("[data-task-detail-panel], [data-task-detail-trigger]")) return;
      dismissAndNavigate();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing) return;
      dismissAndNavigate();
    }

    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [detailNavigation.target, queryString, router]);

  async function saveView() {
    if (!viewName.trim()) return;
    setBusy(true); setMessage(null);
    const id = `task-view:${Date.now()}`;
    const response = await fetch("/api/task-saved-views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, name: viewName, ...query }) });
    const body = await response.json() as { ok: boolean; view?: SavedView; error?: string };
    if (response.ok && body.ok) { setSavedViews((current) => [...current, body.view ?? { id, name: viewName }]); setViewName(""); setSaveOpen(false); }
    else setMessage(body.error ?? "保存视图失败");
    setBusy(false);
  }
  async function renameView() {
    if (!renamingView || !viewName.trim()) return;
    setBusy(true); setMessage(null);
    const filters = renamingView.filters && typeof renamingView.filters === "object"
      ? renamingView.filters as Record<string, unknown>
      : {};
    const response = await fetch("/api/task-saved-views", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewId: renamingView.id, name: viewName.trim(), ...filters }),
    });
    const body = await response.json() as { ok: boolean; error?: string };
    if (response.ok && body.ok) {
      setSavedViews((current) => current.map((view) => view.id === renamingView.id ? { ...view, name: viewName.trim() } : view));
      setRenamingView(null); setViewName("");
    } else setMessage(body.error ?? "重命名视图失败");
    setBusy(false);
  }
  async function deleteView(viewId: string) {
    setBusy(true); setMessage(null);
    const response = await fetch("/api/task-saved-views", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ viewId }) });
    const body = await response.json() as { ok: boolean; error?: string };
    if (response.ok && body.ok) setSavedViews((current) => current.filter((view) => view.id !== viewId)); else setMessage(body.error ?? "删除视图失败");
    setBusy(false);
  }
  async function sendTaskCommand(task: TaskListItem, command: string, payload: Record<string, unknown> = {}) {
    const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/commands/${command}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: createTaskCommandId(), expectedVersion: task.version, ...payload }) });
    const body = await response.json() as { ok: boolean; error?: string };
    if (!response.ok || !body.ok) throw new Error(body.error ?? "任务操作失败");
  }
  async function taskCommand(task: TaskListItem, command: string) {
    setBusy(true); setMessage(null);
    try { await sendTaskCommand(task, command); window.location.reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "任务操作失败"); }
    finally { setBusy(false); }
  }
  async function moveTask(task: TaskListItem, command: string, payload: Record<string, unknown>) {
    await sendTaskCommand(task, command, payload);
    window.location.reload();
  }
  async function runBulkCommand(command: string, payload: Record<string, unknown> = {}) {
    setBusy(true); setMessage(null);
    try {
      for (const task of collection.listRows.filter((item) => selectedTaskIds.includes(item.id))) {
        await sendTaskCommand(task, command, payload);
      }
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? `${error.message}，批量操作已停止` : "批量操作失败，已停止");
    } finally { setBusy(false); }
  }
  function savedViewHref(view: SavedView) {
    const filters = view.filters && typeof view.filters === "object" ? view.filters as Record<string, unknown> : {};
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (typeof value === "string") params.set(key, value);
      else if (Array.isArray(value) && value.every((item): item is string => typeof item === "string")) params.set(key, value.join(","));
    }
    return `/tasks?${params.toString()}`;
  }
  const pageHref = (page: number) => { const params = new URLSearchParams(queryString); params.set("page", String(page)); return `/tasks?${params.toString()}`; };

  const detailMatchesTarget = detailNavigation.target !== null
    && queryTaskId === detailNavigation.target
    && selectedDetail?.task.id === detailNavigation.target;
  const showPendingDetail = detailNavigation.target !== null && detailNavigation.pending && !detailMatchesTarget;

  return (
    <section className="relative h-full min-h-0 overflow-hidden flex min-w-0 flex-col bg-white">
      <div className="flex min-h-11 shrink-0 items-center gap-2 overflow-x-auto border-b border-[#d0d7de] px-3">
        <span className="shrink-0 text-xs font-semibold text-[#57606a]">保存视图</span>
        {savedViews.map((view) => <span key={view.id} className="inline-flex shrink-0 items-center rounded-md border border-[#d0d7de]"><Link href={savedViewHref(view)} className="px-2.5 py-1.5 text-xs font-semibold text-[#24292f]">{view.name}</Link><button disabled={busy} aria-label={`重命名${view.name}`} title={`重命名${view.name}`} onClick={() => { setRenamingView(view); setViewName(view.name); }} className="grid h-7 w-7 place-items-center border-l border-[#d0d7de] text-[#57606a]"><Pencil size={13} /></button><button disabled={busy} aria-label={`删除${view.name}`} title={`删除${view.name}`} onClick={() => void deleteView(view.id)} className="grid h-7 w-7 place-items-center border-l border-[#d0d7de] text-[#cf222e]"><Trash2 size={13} /></button></span>)}
        <button aria-label="保存当前视图" title="保存当前视图" onClick={() => { setViewName(""); setSaveOpen(true); }} className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[#d0d7de] text-[#57606a]"><BookmarkPlus size={15} /></button>
        <span className="ml-auto shrink-0 text-xs text-[#57606a]">{collection.total} 个任务</span>
        {canManageSettings && spaceId ? <><button aria-label="状态设置" title="状态设置" onClick={() => setStatusOpen(true)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-[#d0d7de] px-2 text-xs font-semibold"><Settings2 size={14} />状态</button><button aria-label="标签设置" title="标签设置" onClick={() => setLabelOpen(true)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-[#d0d7de] px-2 text-xs font-semibold"><Tags size={14} />标签</button></> : null}
        <button aria-label="新建任务" title="新建任务" onClick={() => document.querySelector<HTMLElement>('[aria-label="快速创建事项"]')?.click()} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-[#1f883d] px-2.5 text-xs font-semibold text-white"><Plus size={14} />新建</button>
      </div>
      <TaskToolbar relation={query.relation} view={query.view} queryString={queryString} relationCounts={collection.relationCounts} projects={projects} />
      <div className="flex items-center justify-between border-b border-[#d0d7de] px-3 py-2 text-xs text-[#57606a]"><span>第 {collection.page ?? 1} 页 · 每页 {collection.pageSize ?? 50} 条 · 共 {collection.total} 条</span><div className="flex gap-2"><Link href={pageHref(Math.max((collection.page ?? 1) - 1, 1))} aria-disabled={!collection.hasPreviousPage} className={!collection.hasPreviousPage ? "pointer-events-none text-[#8c959f]" : "font-semibold text-[#0969da]"}>上一页</Link><Link href={pageHref((collection.page ?? 1) + 1)} aria-disabled={!collection.hasNextPage} className={!collection.hasNextPage ? "pointer-events-none text-[#8c959f]" : "font-semibold text-[#0969da]"}>下一页</Link></div></div>
      {message ? <div role="alert" className="shrink-0 border-b border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-sm text-[#cf222e]">{message}</div> : null}
      {selectedTaskIds.length ? <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-[#d0d7de] bg-[#f6f8fa] px-3 py-1.5"><span className="text-sm font-semibold">已选择 {selectedTaskIds.length} 项</span>{query.relation === "archived" ? <button disabled={busy} aria-label="批量恢复" onClick={() => void runBulkCommand("restore")} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d0d7de] bg-white px-2 text-xs font-semibold"><Archive size={14} />恢复</button> : <><select disabled={busy} aria-label="批量负责人" defaultValue="" onChange={(event) => { if (event.target.value) void runBulkCommand("assign", { assigneeUserId: event.target.value }); }} className="h-8 rounded-md border border-[#d0d7de] bg-white px-2 text-xs"><option value="">更改负责人</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><select disabled={busy} aria-label="批量状态" defaultValue="" onChange={(event) => { if (event.target.value) void runBulkCommand(event.target.value); }} className="h-8 rounded-md border border-[#d0d7de] bg-white px-2 text-xs"><option value="">更改状态</option><option value="move_to_todo">移到待处理</option><option value="start">开始</option><option value="submit_for_review">提交验收</option><option value="complete">完成</option><option value="accept">通过验收</option><option value="cancel">取消</option><option value="reopen">重新打开</option></select><select disabled={busy} aria-label="批量优先级" defaultValue="" onChange={(event) => { if (event.target.value) void runBulkCommand("update_fields", { priority: Number(event.target.value) }); }} className="h-8 rounded-md border border-[#d0d7de] bg-white px-2 text-xs"><option value="">更改优先级</option><option value="0">普通</option><option value="1">较高</option><option value="2">高</option><option value="3">紧急</option></select><select disabled={busy} aria-label="批量项目" defaultValue="" onChange={(event) => { if (event.target.value) void runBulkCommand("update_fields", { projectId: event.target.value === "__none__" ? null : event.target.value }); }} className="h-8 rounded-md border border-[#d0d7de] bg-white px-2 text-xs"><option value="">移动项目</option><option value="__none__">移出项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button disabled={busy} aria-label="批量归档" onClick={() => void runBulkCommand("archive")} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d0d7de] bg-white px-2 text-xs font-semibold"><Archive size={14} />归档</button></>}</div> : null}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {query.view === "board" ? <TaskBoard tasks={collection.listRows} group={query.group} queryString={queryString} currentTaskId={detailNavigation.target ?? undefined} members={members} projects={projects} onMove={moveTask} /> : query.view === "calendar" ? <TaskCalendar tasks={collection.listRows} timeZone="Asia/Shanghai" initialMonth={query.dateFrom?.slice(0, 7) ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date())} queryString={queryString} currentTaskId={detailNavigation.target ?? undefined} onMoveDate={(task, payload) => moveTask(task, "update_schedule", payload)} /> : <TaskList tasks={collection.listRows} selectedTaskIds={selectedTaskIds} currentTaskId={detailNavigation.target ?? undefined} queryString={queryString} onSelectionChange={setSelectedTaskIds} onCommand={taskCommand} />}
      </div>
      {detailMatchesTarget && selectedDetail ? <TaskDetailPanel detail={selectedDetail} queryString={queryString} members={detailMembers} projects={detailProjects} labels={detailLabels} agentProfiles={agentProfiles} onDismissIntent={dismissDetail} /> : showPendingDetail ? <TaskDetailPanel loading queryString={queryString} members={detailMembers} projects={detailProjects} labels={detailLabels} agentProfiles={agentProfiles} /> : null}
      {saveOpen ? <div className="fixed inset-0 z-[60] grid place-items-center bg-[#1f2328]/45 p-4"><div role="dialog" aria-label="保存当前视图" className="w-full max-w-sm rounded-lg bg-white p-5"><div className="font-semibold">保存当前视图</div><label className="mt-4 grid gap-1 text-sm font-semibold">视图名称<input aria-label="视图名称" value={viewName} onChange={(e) => setViewName(e.target.value)} className="h-10 rounded-md border border-[#8c959f] px-3 font-normal" /></label><div className="mt-4 flex justify-end gap-2"><button onClick={() => setSaveOpen(false)} className="h-9 rounded-md border border-[#d0d7de] px-3 text-sm">取消</button><button aria-label="确认保存视图" onClick={() => void saveView()} className="h-9 rounded-md bg-[#1f883d] px-3 text-sm font-semibold text-white">保存</button></div></div></div> : null}
      {renamingView ? <div className="fixed inset-0 z-[60] grid place-items-center bg-[#1f2328]/45 p-4"><div role="dialog" aria-label="重命名保存视图" className="w-full max-w-sm rounded-lg bg-white p-5"><div className="font-semibold">重命名保存视图</div><label className="mt-4 grid gap-1 text-sm font-semibold">视图名称<input aria-label="视图名称" value={viewName} onChange={(e) => setViewName(e.target.value)} className="h-10 rounded-md border border-[#8c959f] px-3 font-normal" /></label><div className="mt-4 flex justify-end gap-2"><button disabled={busy} onClick={() => { setRenamingView(null); setViewName(""); }} className="h-9 rounded-md border border-[#d0d7de] px-3 text-sm">取消</button><button disabled={busy} aria-label="确认重命名视图" onClick={() => void renameView()} className="h-9 rounded-md bg-[#1f883d] px-3 text-sm font-semibold text-white">保存</button></div></div></div> : null}
      {spaceId ? <><TaskStatusSettingsDialog open={statusOpen} spaceId={spaceId} definitions={statusDefinitions} onOpenChange={setStatusOpen} /><TaskLabelSettingsDialog open={labelOpen} spaceId={spaceId} labels={labels} onOpenChange={setLabelOpen} /></> : null}
    </section>
  );
}
