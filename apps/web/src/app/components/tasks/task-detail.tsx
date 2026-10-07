"use client";

import { ArrowUpRight, Ban, CalendarClock, Check, CheckCircle2, CheckSquare2, CircleAlert, Pause, Pencil, PanelRightClose, Play, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TaskAcceptanceEvidence } from "./task-acceptance-evidence";
import { TaskCollaboration } from "./task-collaboration";
import { buildTaskCenterHref } from "./task-detail-navigation";
import { TaskEditor } from "./task-editor";
import { TaskLoopLauncher } from "./task-loop-launcher";
import { TaskLoopTab } from "./task-loop-tab";
import { TaskRelations } from "./task-relations";
import { createTaskCommandId } from "../../../lib/tasks/task-command-id";
import { loopStatusReasonLabel } from "../../../lib/orchestration/loop-status-reason";

export interface TaskDetailView {
  task: {
    id: string; shortId: string | null; title: string; contentMarkdown: string | null; version: number; statusCategory: string | null;
    statusDefinition: { id: string; name: string; category: string; color: string } | null;
    priority: number; visibility: string | null; startAt: Date | string | null; dueAt: Date | string | null; archivedAt: Date | string | null;
    recurrenceRule?: string | null; recurringLoopBinding?: { bindingId: string; bindingType: "task" | "project" } | null;
    assigneeUserId: string | null; assignee: { id: string; name: string; avatarUrl: string | null } | null;
    createdById: string | null; createdBy: { id: string; name: string; avatarUrl: string | null } | null;
    acceptanceMode: string | null; acceptanceReviewer: { id: string; name: string; avatarUrl: string | null } | null;
    acceptanceReadiness: import("@humanthread/orchestration-core").TaskAcceptanceReadiness | null;
    project: { id: string; name: string } | null;
    members: Array<{ userId: string; role: string; user?: { id: string; name: string; avatarUrl: string | null } }>;
    blockers: Array<{ id: string; reason: string; ownerUserId?: string | null; createdAt?: Date | string }>;
    labelAssignments: Array<{ label: { id: string; name: string; color: string } }>;
    childTasks: Array<{ id: string; title: string; statusCategory: string | null }>;
    predecessorDependencies: Array<{ id: string; type: string; successorTask: { id: string; title: string; statusCategory: string | null } }>;
    successorDependencies: Array<{ id: string; type: string; predecessorTask: { id: string; title: string; statusCategory: string | null } }>;
    documentLinks: Array<{ document: { id: string; title: string; path: string; version: number } }>;
    attachments: Array<{ id: string; originalName: string; mimeType: string; byteSize: number | bigint; createdAt: Date | string }>;
    comments: Array<{ id: string; contentMarkdown: string; createdAt: Date | string; updatedAt: Date | string; author: { id: string; name: string; avatarUrl: string | null } }>;
    activities: Array<{ id: string; type: string; actorType: string; message: string; payload: unknown; createdAt: Date | string }>;
    reminders: Array<{ id: string; remindAt: Date | string; channel: string; status: string }>;
    agentRuns: Array<{ id: string; status: string; createdAt: Date | string; agentProfile: { id: string; name: string; provider: string } }>;
    loopRuns: Array<{ id: string; status: string; statusReason?: string | null; currentIteration: number; stopReason: string | null; version: number; progress: { completed: number; total: number; percent: number }; workflowInteractions?: Array<{ id: string; kind: string; status: string }> }>;
  };
  capabilities: { read: boolean; comment: boolean; edit: boolean; changeStatus: boolean; manageMembers: boolean; manageVisibility: boolean; dispatchAgent: boolean; govern: boolean };
}

const PRIORITIES = [[0, "普通"], [1, "较高"], [2, "高"], [3, "紧急"]] as const;
function statusActions(status: string | null) {
  if (status === "backlog") return [["move_to_todo", "移到待处理"], ["cancel", "取消"]] as const;
  if (status === "todo") return [["start", "开始"], ["cancel", "取消"]] as const;
  if (status === "in_progress") return [["submit_for_review", "提交验收"], ["complete", "完成"], ["cancel", "取消"]] as const;
  if (status === "in_review") return [["accept", "通过验收"], ["reject", "驳回"], ["cancel", "取消"]] as const;
  return [["reopen", "重新打开"]] as const;
}

export function TaskDetail({ detail, layout, queryString, members, projects, labels, agentProfiles, onDismissIntent }: {
  detail: TaskDetailView; layout: "panel" | "page"; queryString: string;
  members: Array<{ id: string; name: string }>; projects: Array<{ id: string; name: string }>;
  labels: Array<{ id: string; name: string; color: string }>; agentProfiles: Array<{ id: string; name: string; provider: string; status: string }>;
  onDismissIntent?(): void;
}) {
  const { task, capabilities } = detail;
  const [version, setVersion] = useState(task.version);
  const [tab, setTab] = useState<"content" | "collaboration" | "relations" | "loop">("content");
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState(task.recurrenceRule ?? "");
  const [loopBinding, setLoopBinding] = useState(task.recurringLoopBinding ?? null);
  const [loopOptions, setLoopOptions] = useState<Array<{ id: string; label: string; type: "task" | "project" }>>([]);
  async function loadLoopOptions() {
    if (!task.project?.id || loopOptions.length > 0) return;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(task.project.id)}/loop-bindings`, { headers: { accept: "application/json" } });
      if (!response.ok) return;
      const body = await response.json() as { result?: Array<{ id?: string; bindingRole?: string; loopDefinition?: { name?: string } }> };
      const bindings = Array.isArray(body.result) ? body.result : [];
      setLoopOptions(bindings.flatMap((binding) => {
        if (!binding.id || (binding.bindingRole !== "task_development" && binding.bindingRole !== "milestone_release")) return [];
        return [{ id: binding.id, type: binding.bindingRole === "task_development" ? "task" as const : "project" as const, label: binding.loopDefinition?.name ?? binding.bindingRole }];
      }));
    } catch { setLoopOptions([]); }
  }
  const evidenceGated = task.acceptanceMode === "automated" || task.acceptanceMode === "hybrid";
  async function command(commandName: string, payload: Record<string, unknown> = {}) {
    setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/commands/${commandName}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: createTaskCommandId(), expectedVersion: version, ...payload }) });
      const body = await response.json() as { ok: boolean; result?: { version: number }; error?: string };
      if (!response.ok || !body.ok || !body.result) throw new Error(body.error ?? "任务更新失败");
      setVersion(body.result.version); window.location.reload(); return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "任务更新失败"); return false; }
    finally { setPending(false); }
  }

  return <article className={layout === "page"
    ? "grid h-full min-h-0 min-w-0 overflow-hidden bg-[#f6f8fa] xl:grid-cols-[minmax(0,1fr)_430px]"
    : "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white"} aria-label="任务详情">
    <div className={layout === "page" ? "flex min-h-0 min-w-0 flex-col overflow-hidden bg-white" : "contents"}>
    <header className="shrink-0 border-b border-[#d0d7de] px-4 py-3">
      <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-xs text-[#57606a]"><CheckSquare2 size={13} />{task.project?.name ?? "个人任务"}{task.shortId ? <span className="font-mono text-[11px] text-[#57606a]">{task.shortId}</span> : null}{task.archivedAt ? <span className="rounded bg-[#57606a] px-1.5 py-0.5 text-[11px] font-semibold text-white">已归档</span> : null}</div>{editingTitle ? <div className="mt-1 flex items-center gap-1"><input aria-label="任务标题" value={title} onChange={(event) => setTitle(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-[#8c959f] px-2 text-sm font-semibold" /><button aria-label="保存任务标题" title="保存任务标题" onClick={() => void command("update_fields", { title }).then((saved) => { if (saved) setEditingTitle(false); })} className="grid h-9 w-9 place-items-center text-[#1f883d]"><Check size={15} /></button><button aria-label="取消编辑标题" title="取消编辑标题" onClick={() => { setTitle(task.title); setEditingTitle(false); }} className="grid h-9 w-9 place-items-center text-[#57606a]"><X size={15} /></button></div> : <div className="mt-1 flex items-start gap-1"><h2 className="min-w-0 break-words text-lg font-semibold leading-6 text-[#24292f]">{title}</h2>{capabilities.edit ? <button aria-label="编辑任务标题" title="编辑任务标题" onClick={() => setEditingTitle(true)} className="grid h-7 w-7 shrink-0 place-items-center text-[#57606a]"><Pencil size={13} /></button> : null}</div>}</div>{layout === "panel" ? <><Link aria-label="全屏打开" title="全屏打开" href={`/tasks/${task.id}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[#d0d7de]"><ArrowUpRight size={15} /></Link><Link aria-label="关闭详情" title="关闭详情" href={buildTaskCenterHref(queryString)} {...(onDismissIntent ? { onClick: onDismissIntent } : {})} className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[#d0d7de]"><PanelRightClose size={15} /></Link></> : null}</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {capabilities.changeStatus ? <select disabled={pending} aria-label="任务状态" defaultValue="" onChange={(event) => { if (event.target.value === "reject") setRejecting(true); else if (event.target.value) void command(event.target.value); }} className="h-9 rounded-md border border-[#d0d7de] bg-white px-2 text-sm"><option value="">{task.statusDefinition?.name ?? task.statusCategory ?? "待处理"}</option>{statusActions(task.statusCategory).map(([value, label]) => <option key={value} value={value} disabled={evidenceGated && value === "accept"}>{label}</option>)}</select> : <div className="flex h-9 items-center rounded-md bg-[#f6f8fa] px-2 text-sm">{task.statusDefinition?.name ?? task.statusCategory}</div>}
        {capabilities.manageMembers ? <select disabled={pending} aria-label="任务负责人" defaultValue={task.assignee?.id ?? ""} onChange={(event) => { if (event.target.value) void command("assign", { assigneeUserId: event.target.value }); }} className="h-9 rounded-md border border-[#d0d7de] bg-white px-2 text-sm"><option value="">未指派</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select> : <div className="flex h-9 items-center rounded-md bg-[#f6f8fa] px-2 text-sm">{task.assignee?.name ?? "未指派"}</div>}
        {capabilities.govern ? <select disabled={pending} aria-label="任务优先级" defaultValue={String(task.priority)} onChange={(event) => void command("update_fields", { priority: Number(event.target.value) })} className="h-9 rounded-md border border-[#d0d7de] bg-white px-2 text-sm">{PRIORITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <div className="flex h-9 items-center rounded-md bg-[#f6f8fa] px-2 text-sm">{PRIORITIES.find(([value]) => value === task.priority)?.[1]}</div>}
        {capabilities.govern ? <select disabled={pending} aria-label="任务项目" defaultValue={task.project?.id ?? ""} onChange={(event) => void command("update_fields", { projectId: event.target.value || null })} className="h-9 rounded-md border border-[#d0d7de] bg-white px-2 text-sm"><option value="">无项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select> : <div className="flex h-9 items-center rounded-md bg-[#f6f8fa] px-2 text-sm">{task.project?.name ?? "无项目"}</div>}
      </div>
      {task.archivedAt ? <div className="mt-3 flex flex-wrap items-center gap-2">{capabilities.govern ? <button disabled={pending} aria-label="恢复任务" title="恢复任务" onClick={() => void command("restore")} className="inline-flex h-9 items-center gap-1 rounded-md bg-[#1f883d] px-3 text-sm font-semibold text-white hover:bg-[#2da44e]"><RotateCcw size={15} />恢复任务</button> : null}<span className="text-xs text-[#57606a]">归档任务已冻结，恢复后可继续编辑和管理。</span></div> : null}
      {task.loopRuns[0] ? <TaskLoopHeaderProgress loopRun={task.loopRuns[0]} /> : null}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[#57606a]">{capabilities.edit ? <label className="inline-flex items-center gap-1"><CalendarClock size={12} /><input aria-label="任务截止时间" type="datetime-local" defaultValue={task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 16) : ""} onBlur={(event) => { if (event.target.value) void command("update_schedule", { dueAt: new Date(event.target.value).toISOString() }); }} className="h-7 rounded-md border border-[#d0d7de] px-1.5" /></label> : <span className="inline-flex items-center gap-1"><CalendarClock size={12} />{task.dueAt ? new Date(task.dueAt).toLocaleString("zh-CN") : "未设置截止时间"}</span>}<span>创建人 {task.createdBy?.name ?? "未知"}</span><span>验收 {task.acceptanceMode ?? "none"}</span></div>
      {message ? <div role="alert" className="mt-2 text-sm text-[#cf222e]">{message}</div> : null}
      {capabilities.govern && task.project ? <div className="mt-3 grid gap-2 border-t border-[#d8dee4] pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><label className="text-xs text-[#57606a]">定时规则（Cron）<input aria-label="定时规则" value={recurrenceRule} onChange={(event) => setRecurrenceRule(event.target.value)} onBlur={() => void command("update_schedule", { recurrenceRule: recurrenceRule || null, loopBinding })} placeholder="例如 0 9 * * 1" className="mt-1 h-8 w-full rounded-md border border-[#d0d7de] px-2 text-sm text-[#24292f]" /></label><label className="text-xs text-[#57606a]">定时绑定 Loop<select aria-label="定时绑定 Loop" value={loopBinding ? `${loopBinding.bindingType}:${loopBinding.bindingId}` : ""} onFocus={() => void loadLoopOptions()} onChange={(event) => { const [bindingType, bindingId] = event.target.value.split(":", 2); const next = bindingType && bindingId ? { bindingType: bindingType as "task" | "project", bindingId } : null; setLoopBinding(next); void command("update_schedule", { recurrenceRule: recurrenceRule || null, loopBinding: next }); }} className="mt-1 h-8 w-full rounded-md border border-[#d0d7de] bg-white px-2 text-sm text-[#24292f]"><option value="">不绑定</option>{loopOptions.map((option) => <option key={`${option.type}:${option.id}`} value={`${option.type}:${option.id}`}>{option.label}</option>)}</select></label></div> : null}
      {rejecting ? <div className="mt-2 flex gap-2"><input aria-label="驳回理由" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-[#8c959f] px-2 text-sm" /><button disabled={!rejectionReason.trim() || pending} onClick={() => void command("reject", { reason: rejectionReason }).then((saved) => { if (saved) setRejecting(false); })} className="h-9 rounded-md bg-[#cf222e] px-3 text-sm font-semibold text-white">确认驳回</button></div> : null}
    </header>
    {evidenceGated && task.acceptanceReadiness ? <TaskAcceptanceEvidence
      taskId={task.id}
      version={version}
      statusCategory={task.statusCategory}
      readiness={task.acceptanceReadiness}
      canGovern={capabilities.govern}
      canAccept={capabilities.changeStatus}
      onVersionChange={setVersion}
      onAccepted={() => window.location.reload()}
    /> : null}
    <nav role="tablist" className="flex h-10 shrink-0 items-end gap-1 border-b border-[#d0d7de] px-3" aria-label="任务详情标签">{[["content", "正文"], ["collaboration", "协作"], ["relations", "关联"], ["loop", "Loop"]].map(([key, label]) => <button role="tab" key={key} aria-selected={tab === key} onClick={() => setTab(key as typeof tab)} className={tab === key ? "h-10 border-b-2 border-[#0969da] px-3 text-sm font-semibold text-[#0969da]" : "h-10 px-3 text-sm text-[#57606a]"}>{label}</button>)}</nav>
    <div data-task-detail-scroll className="grid min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {tab === "content" ? <div className={layout === "page" ? "min-h-[520px]" : "min-h-[420px]"}><TaskEditor key={task.id} taskId={task.id} title={task.title} contentMarkdown={task.contentMarkdown ?? ""} version={version} canEdit={capabilities.edit} onSaved={(result) => setVersion(result.version)} /></div> : null}
      {tab === "collaboration" ? <TaskCollaboration taskId={task.id} version={version} canComment={capabilities.comment} canEdit={capabilities.edit} canManageMembers={capabilities.manageMembers} canChangeStatus={capabilities.changeStatus} comments={task.comments} activities={task.activities} members={task.members} availableMembers={members} blocker={task.blockers[0] ?? null} assignedLabels={task.labelAssignments.map((item) => item.label)} availableLabels={labels} reminders={task.reminders} onVersionChange={setVersion} /> : null}
      {tab === "relations" ? <TaskRelations taskId={task.id} canEdit={capabilities.edit} childTasks={task.childTasks} predecessors={task.predecessorDependencies} successors={task.successorDependencies} documents={task.documentLinks} attachments={task.attachments} /> : null}
      {tab === "loop" ? <TaskLoopTab taskId={task.id} version={version} canDispatch={capabilities.dispatchAgent} showAutomation={layout === "panel"} agentProfiles={agentProfiles} agentRun={task.agentRuns[0] ?? null} loopRun={task.loopRuns[0] ?? null} onVersionChange={setVersion} /> : null}
    </div>
    </div>
    {layout === "page" ? <TaskLoopLauncher taskId={task.id} canDispatch={capabilities.dispatchAgent} loopRun={task.loopRuns[0] ?? null} /> : null}
  </article>;
}

function TaskLoopHeaderProgress({ loopRun }: { loopRun: TaskDetailView["task"]["loopRuns"][number] }) {
  const percent = Math.max(0, Math.min(100, loopRun.progress.percent));
  const StatusIcon = loopRun.status === "running" ? Play : loopRun.status === "paused" ? Pause : loopRun.status === "cancelled" ? Ban : loopRun.status === "failed" || loopRun.status === "exhausted" ? CircleAlert : CheckCircle2;
  const statusLabel = loopRun.status === "running" ? "进行中" : loopRun.status === "paused" ? "已暂停" : loopRun.status === "cancelled" ? "已中止" : loopRun.status === "failed" || loopRun.status === "exhausted" ? "失败" : loopRun.status === "completed" ? "已完成" : "等待中";
  const failureReason = loopRun.status === "failed" || loopRun.status === "exhausted" ? loopStatusReasonLabel(loopRun.statusReason) : null;
  return <div className="mt-3 flex max-w-xl flex-wrap items-center gap-2" aria-label={`Loop 运行进度 ${percent}%`}>
    <div className="h-1.5 min-w-20 flex-1 overflow-hidden rounded-full bg-[#d8dee4]" role="progressbar" aria-label={`Loop 运行进度 ${percent}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><div className="h-full rounded-full bg-[#0969da] transition-[width] duration-500 motion-safe:animate-pulse motion-reduce:transition-none" style={{ width: `${percent}%` }} /></div>
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[#57606a]" title={`Loop 状态：${statusLabel}`} aria-label={`Loop 状态：${statusLabel}`}><StatusIcon aria-hidden="true" className="h-3.5 w-3.5" /><span className="sr-only">{statusLabel}</span></span>
    {failureReason ? <span className="basis-full text-xs font-medium text-[#cf222e]">{failureReason}</span> : null}
  </div>;
}
