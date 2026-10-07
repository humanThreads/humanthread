"use client";

import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, CircleAlert, CircleDashed, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { ProjectHubView } from "../../../lib/workbench/workbench-projects";
import type { ProjectRoadmapAction } from "../../../lib/orchestration/project-roadmap-commands";
import { EmptyState, Panel, StatusPill } from "../workbench-ui";
import { MilestoneLoopButton } from "./milestone-loop-dialog";
import { progressPercent, roadmapProgressTone, roadmapStatusLabel, roadmapStatusTone, taskHref, taskProgress, taskProgressTone, type ProjectRoadmapMilestone, type ProjectRoadmapStage, type ProjectTaskSummary, unassignedProjectTasks } from "./project-roadmap-model";
import { RoadmapProgressBackdrop } from "./project-roadmap-progress";
import { ReleasePlanButton } from "./project-roadmap";

const STATUSES = ["planned", "active", "at_risk", "completed", "cancelled"];
const inputClass = "h-9 min-w-0 rounded-md border border-[#8c959f] bg-white px-2 text-sm outline-none focus:border-[#0969da] focus:ring-2 focus:ring-[#0969da]/10";
const iconClass = "grid size-8 shrink-0 place-items-center rounded-md border border-[#d0d7de] text-[#57606a] hover:bg-[#f3f4f6] disabled:opacity-40";

function dateInput(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}
function commandId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? `roadmap:${crypto.randomUUID()}` : `roadmap:${Date.now()}`;
}

type ProjectRoadmapEditorProps = { projectId: string; projectVersion: number; roadmap: ProjectHubView["roadmap"]; projectTasks?: ProjectTaskSummary[] };

export function ProjectRoadmapEditor(props: ProjectRoadmapEditorProps) {
  return <ProjectRoadmapEditorState key={props.projectVersion} {...props} />;
}

function ProjectRoadmapEditorState({ projectId, projectVersion, roadmap, projectTasks = [] }: ProjectRoadmapEditorProps) {
  const router = useRouter();
  const [version, setVersion] = useState(projectVersion);
  const [newStage, setNewStage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [expandedStageId, setExpandedStageId] = useState<string | null>(null);
  const [expandedMilestoneId, setExpandedMilestoneId] = useState<string | null>(null);
  const milestones = roadmap.flatMap((stage) => stage.milestones.map((milestone) => ({ id: milestone.id, name: `${stage.name} / ${milestone.name}` })));
  const unassigned = unassignedProjectTasks(roadmap, projectTasks);

  async function send(action: ProjectRoadmapAction): Promise<boolean> {
    if (pending) return false;
    setPending(true);
    setError(null);
    setConflict(false);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/roadmap`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: commandId(), correlationId: `project:${projectId}`, expectedVersion: version, action }) });
      const body = await response.json() as { ok?: boolean; code?: string; error?: string; result?: { version: number } };
      if (!response.ok || !body.ok || !body.result) {
        if (response.status === 409 || body.code === "version_conflict") setConflict(true);
        setError(body.error ?? "路线图更新失败");
        return false;
      }
      setVersion(body.result.version);
      router.refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "路线图更新失败");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function addStage(event: FormEvent) {
    event.preventDefault();
    if (!newStage.trim()) return;
    if (await send({ type: "stage.create", name: newStage.trim() })) setNewStage("");
  }

  function reorderStage(index: number, direction: -1 | 1) {
    const next = roadmap.map((stage) => stage.id);
    const other = index + direction;
    if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other]!, next[index]!];
    void send({ type: "stage.reorder", stageIds: next });
  }

  function toggleStage(stageId: string) {
    setExpandedStageId((current) => current === stageId ? null : stageId);
    setExpandedMilestoneId(null);
  }

  return <Panel title="交付路线图" action={<div className="flex items-center gap-3 text-xs text-[#57606a]"><ReleasePlanButton projectId={projectId} roadmap={roadmap} /><span>可编辑 · 版本 {version}</span><Link href={`/tasks?project=${encodeURIComponent(projectId)}`} className="font-semibold text-[#0969da] hover:underline">打开任务中心</Link></div>}>
    <div className="grid gap-4" aria-busy={pending}>
      {error ? <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-sm text-[#cf222e]"><span className="mr-auto">{conflict ? "路线图已被其他人更新，当前草稿已保留。" : error}</span>{conflict ? <button type="button" onClick={() => router.refresh()} className="inline-flex h-8 items-center gap-2 rounded-md border border-[#cf222e] px-3 font-semibold"><RefreshCw size={14} />重新加载</button> : null}</div> : null}
      {roadmap.length === 0 ? <EmptyState title="尚未建立路线图" description="先添加阶段，再在阶段中添加里程碑。" /> : <div className="divide-y divide-[#d8dee4] border-y border-[#d8dee4]">{roadmap.map((stage, stageIndex) => <StageEditor key={`${stage.id}:${stage.version}`} stage={stage} stageIndex={stageIndex} stageCount={roadmap.length} milestones={milestones} pending={pending} send={send} reorderStage={reorderStage} expanded={expandedStageId === stage.id} expandedMilestoneId={expandedMilestoneId} onToggle={() => toggleStage(stage.id)} onMilestoneToggle={(milestoneId) => setExpandedMilestoneId((current) => current === milestoneId ? null : milestoneId)} projectId={projectId} />)}</div>}
      {projectTasks.length > 0 ? <UnassignedEditor projectId={projectId} tasks={unassigned} milestones={milestones} pending={pending} send={send} expanded={expandedStageId === "unassigned"} onToggle={() => toggleStage("unassigned")} /> : null}
      <form onSubmit={(event) => void addStage(event)} className="flex flex-wrap items-end gap-2"><label className="grid min-w-[220px] flex-1 gap-1 text-xs font-semibold text-[#57606a]">新阶段名称<input aria-label="新阶段名称" className={inputClass} value={newStage} onChange={(event) => setNewStage(event.target.value)} /></label><button type="submit" disabled={pending || !newStage.trim()} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#0969da] px-3 text-sm font-semibold text-white disabled:opacity-40"><Plus size={16} />添加阶段</button></form>
    </div>
  </Panel>;
}

function StageEditor({ stage, stageIndex, stageCount, milestones, pending, send, reorderStage, expanded, expandedMilestoneId, onToggle, onMilestoneToggle, projectId }: { stage: ProjectRoadmapStage; stageIndex: number; stageCount: number; milestones: Array<{ id: string; name: string }>; pending: boolean; send(action: ProjectRoadmapAction): Promise<boolean>; reorderStage(index: number, direction: -1 | 1): void; expanded: boolean; expandedMilestoneId: string | null; onToggle(): void; onMilestoneToggle(milestoneId: string): void; projectId: string }) {
  const [name, setName] = useState(stage.name);
  const [status, setStatus] = useState(stage.status);
  const [startAt, setStartAt] = useState(dateInput(stage.startAt));
  const [targetAt, setTargetAt] = useState(dateInput(stage.targetAt));
  const [newMilestone, setNewMilestone] = useState("");
  const percent = progressPercent(stage.completedMilestones, stage.totalMilestones);
  const stageTasks = stage.milestones.flatMap((milestone) => milestone.tasks).filter((task) => (task.statusCategory ?? task.status) !== "cancelled");
  const releasable = stage.publicationStatus !== "published" && stageTasks.length > 0 && stageTasks.every((task) => (task.statusCategory ?? task.status) === "completed") && stageTasks.some((task) => task.publicationStatus !== "published");

  function reorderMilestone(index: number, direction: -1 | 1) {
    const ids = stage.milestones.map((item) => item.id);
    const other = index + direction;
    if (other < 0 || other >= ids.length) return;
    [ids[index], ids[other]] = [ids[other]!, ids[index]!];
    void send({ type: "milestone.reorder", stageId: stage.id, milestoneIds: ids });
  }

  return <section className="relative overflow-hidden bg-white">
    <RoadmapProgressBackdrop label={`${name}进度`} percent={percent} tone={roadmapProgressTone(status)} />
    <div className="relative z-10 flex flex-wrap items-center gap-3 px-3 py-3">
      <button type="button" aria-expanded={expanded} aria-controls={`editor-roadmap-stage-${stage.id}`} aria-label={`${expanded ? "收起" : "展开"}${name}`} onClick={onToggle} className="inline-flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0969da]/30">
        {expanded ? <ChevronDown className="size-4 shrink-0 text-[#57606a]" /> : <ChevronRight className="size-4 shrink-0 text-[#57606a]" />}
        <CircleDashed className={`size-4 shrink-0 ${status === "completed" ? "text-[#1a7f37]" : status === "at_risk" ? "text-[#9a6700]" : "text-[#0969da]"}`} />
        <span className="truncate font-semibold text-[#24292f]">{name}</span>
      </button>
      <StatusPill tone={roadmapStatusTone(stage.publicationStatus === "published" ? "published" : status)}>{stage.publicationStatus === "published" ? "已发布" : releasable ? "可发版" : roadmapStatusLabel(status)}</StatusPill>
      <span className="text-xs text-[#57606a]">{stage.completedMilestones}/{stage.totalMilestones} 个里程碑</span>
      <div className="flex items-center gap-1"><button title="上移阶段" aria-label="上移阶段" className={iconClass} disabled={pending || stageIndex === 0} onClick={() => reorderStage(stageIndex, -1)}><ArrowUp size={15} /></button><button title="下移阶段" aria-label="下移阶段" className={iconClass} disabled={pending || stageIndex === stageCount - 1} onClick={() => reorderStage(stageIndex, 1)}><ArrowDown size={15} /></button><button title="删除空阶段" aria-label="删除空阶段" className={iconClass} disabled={pending || stage.milestones.length > 0} onClick={() => void send({ type: "stage.delete", stageId: stage.id, expectedNodeVersion: stage.version })}><Trash2 size={15} /></button></div>
    </div>
    {expanded ? <div id={`editor-roadmap-stage-${stage.id}`} className="relative z-10 border-t border-[#eaeef2] bg-white/90 px-3 py-3 motion-safe:animate-[roadmap-reveal_180ms_ease-out]">
      <div className="grid gap-2 lg:grid-cols-[minmax(180px,1fr)_140px_150px_150px_auto]"><label className="grid gap-1 text-xs font-semibold text-[#57606a]">阶段名称<input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="grid gap-1 text-xs font-semibold text-[#57606a]">状态<select className={inputClass} value={status} onChange={(event) => setStatus(event.target.value)}>{STATUSES.map((item) => <option key={item} value={item}>{roadmapStatusLabel(item)}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold text-[#57606a]">计划开始<input className={inputClass} type="date" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label><label className="grid gap-1 text-xs font-semibold text-[#57606a]">计划完成<input className={inputClass} type="date" value={targetAt} onChange={(event) => setTargetAt(event.target.value)} /></label><div className="flex items-end gap-1"><button title="保存阶段" aria-label="保存阶段" className={iconClass} disabled={pending || !name.trim()} onClick={() => void send({ type: "stage.update", stageId: stage.id, expectedNodeVersion: stage.version, name, status, startAt: startAt || null, targetAt: targetAt || null })}><Save size={15} /></button></div></div>
      <div className="mt-3 divide-y divide-[#eef1f4]">{stage.milestones.map((milestone, index) => <MilestoneEditor key={`${milestone.id}:${milestone.version}`} milestone={milestone} index={index} count={stage.milestones.length} milestones={milestones} pending={pending} send={send} reorder={(direction) => reorderMilestone(index, direction)} expanded={expandedMilestoneId === milestone.id} onToggle={() => onMilestoneToggle(milestone.id)} projectId={projectId} />)}</div>
      <form onSubmit={(event) => { event.preventDefault(); if (!newMilestone.trim()) return; void send({ type: "milestone.create", stageId: stage.id, name: newMilestone.trim() }).then((ok) => { if (ok) setNewMilestone(""); }); }} className="mt-3 flex flex-wrap gap-2"><input aria-label={`为${name}添加里程碑`} placeholder="新里程碑名称" className={`${inputClass} min-w-[220px] flex-1`} value={newMilestone} onChange={(event) => setNewMilestone(event.target.value)} /><button type="submit" disabled={pending || !newMilestone.trim()} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#8c959f] px-3 text-sm font-semibold disabled:opacity-40"><Plus size={15} />添加里程碑</button></form>
    </div> : null}
  </section>;
}

function MilestoneEditor({ milestone, index, count, milestones, pending, send, reorder, expanded, onToggle, projectId }: { milestone: ProjectRoadmapMilestone; index: number; count: number; milestones: Array<{ id: string; name: string }>; pending: boolean; send(action: ProjectRoadmapAction): Promise<boolean>; reorder(direction: -1 | 1): void; expanded: boolean; onToggle(): void; projectId: string }) {
  const [name, setName] = useState(milestone.name);
  const [status, setStatus] = useState(milestone.status);
  const [targetAt, setTargetAt] = useState(dateInput(milestone.targetAt));
  const [risk, setRisk] = useState(milestone.riskSummary ?? "");
  return <div className="relative">
    <div className="flex flex-wrap items-center gap-2 px-2 py-3 hover:bg-[#f6f8fa]"><button type="button" aria-expanded={expanded} aria-controls={`editor-roadmap-milestone-${milestone.id}`} aria-label={`${expanded ? "收起" : "展开"}${name}`} onClick={onToggle} className="inline-flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0969da]/30">
      {expanded ? <ChevronDown className="size-4 shrink-0 text-[#57606a]" /> : <ChevronRight className="size-4 shrink-0 text-[#57606a]" />}
      <CircleDashed className={`size-4 shrink-0 ${status === "completed" ? "text-[#1a7f37]" : status === "at_risk" ? "text-[#9a6700]" : "text-[#8c959f]"}`} />
      <span className="min-w-0 truncate text-sm font-medium text-[#24292f]">{name}</span>
      <span className="mr-auto text-xs text-[#57606a]">{milestone.taskCount} 个任务</span>
      <StatusPill tone={roadmapStatusTone(status)}>{roadmapStatusLabel(status)}</StatusPill>
    </button><div className="flex gap-1">{milestone.tasks.length > 0 ? <MilestoneLoopButton milestoneId={milestone.id} milestoneName={milestone.name} iconSize={15} className={iconClass} /> : null}<button title="上移里程碑" aria-label="上移里程碑" className={iconClass} disabled={pending || index === 0} onClick={() => reorder(-1)}><ArrowUp size={15} /></button><button title="下移里程碑" aria-label="下移里程碑" className={iconClass} disabled={pending || index === count - 1} onClick={() => reorder(1)}><ArrowDown size={15} /></button><button title="删除空里程碑" aria-label="删除空里程碑" className={iconClass} disabled={pending || milestone.tasks.length > 0} onClick={() => void send({ type: "milestone.delete", milestoneId: milestone.id, expectedNodeVersion: milestone.version })}><Trash2 size={15} /></button></div></div>
    {expanded ? <div id={`editor-roadmap-milestone-${milestone.id}`} className="border-t border-[#eef1f4] bg-[#fbfcfd] px-9 py-3 motion-safe:animate-[roadmap-reveal_180ms_ease-out]"><div className="grid gap-2 lg:grid-cols-[minmax(180px,1fr)_130px_150px_minmax(160px,1fr)_auto]"><input aria-label="里程碑名称" className={inputClass} value={name} onChange={(event) => setName(event.target.value)} /><select aria-label="里程碑状态" className={inputClass} value={status} onChange={(event) => setStatus(event.target.value)}>{STATUSES.map((item) => <option key={item} value={item}>{roadmapStatusLabel(item)}</option>)}</select><input aria-label="里程碑目标日期" className={inputClass} type="date" value={targetAt} onChange={(event) => setTargetAt(event.target.value)} /><input aria-label="风险说明" placeholder="风险说明" className={inputClass} value={risk} onChange={(event) => setRisk(event.target.value)} /><div className="flex gap-1"><button title="保存里程碑" aria-label="保存里程碑" className={iconClass} disabled={pending || !name.trim()} onClick={() => void send({ type: "milestone.update", milestoneId: milestone.id, expectedNodeVersion: milestone.version, name, status, targetAt: targetAt || null, riskSummary: risk || null })}><Save size={15} /></button><button title="上移里程碑" aria-label="上移里程碑" className={iconClass} disabled={pending || index === 0} onClick={() => reorder(-1)}><ArrowUp size={15} /></button><button title="下移里程碑" aria-label="下移里程碑" className={iconClass} disabled={pending || index === count - 1} onClick={() => reorder(1)}><ArrowDown size={15} /></button><button title="删除空里程碑" aria-label="删除空里程碑" className={iconClass} disabled={pending || milestone.tasks.length > 0} onClick={() => void send({ type: "milestone.delete", milestoneId: milestone.id, expectedNodeVersion: milestone.version })}><Trash2 size={15} /></button></div></div>{milestone.tasks.length ? <div className="mt-3 divide-y divide-[#eef1f4]">{milestone.tasks.map((task) => <RoadmapTaskRow key={task.id} projectId={projectId} task={task} milestones={milestones} pending={pending} send={send} currentMilestoneId={milestone.id} />)}</div> : <div className="mt-3 text-xs text-[#8c959f]">暂无任务</div>}</div> : null}
  </div>;
}

function RoadmapTaskRow({ projectId, task, milestones, pending, send, currentMilestoneId }: { projectId: string; task: { id: string; title: string; status: string; statusCategory?: string; publicationStatus?: string; version: number }; milestones: Array<{ id: string; name: string }>; pending: boolean; send(action: ProjectRoadmapAction): Promise<boolean>; currentMilestoneId: string }) {
  return <div className="flex flex-wrap items-center gap-2 py-2"><Link href={taskHref(projectId, task.id)} className="min-w-0 flex-1 break-words text-xs font-semibold text-[#0969da] hover:underline">{task.title}</Link><StatusPill tone={task.publicationStatus === "published" ? "success" : (task.statusCategory ?? task.status) === "completed" ? "success" : "blue"}>{task.publicationStatus === "published" ? "已发布" : roadmapStatusLabel(task.status)}</StatusPill><select aria-label={`移动任务 ${task.title}`} className={`${inputClass} w-56`} defaultValue={currentMilestoneId} disabled={pending} onChange={(event) => void send({ type: "task.move", taskId: task.id, milestoneId: event.target.value || null, expectedTaskVersion: task.version })}><option value="">待规划工作</option>{milestones.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>;
}

function UnassignedEditor({ projectId, tasks, milestones, pending, send, expanded, onToggle }: { projectId: string; tasks: ProjectTaskSummary[]; milestones: Array<{ id: string; name: string }>; pending: boolean; send(action: ProjectRoadmapAction): Promise<boolean>; expanded: boolean; onToggle(): void }) {
  const progress = taskProgress(tasks);
  const tone = taskProgressTone(tasks);
  return <section className="relative overflow-hidden rounded-md border border-[#d0d7de] bg-white">
    <RoadmapProgressBackdrop label="未分配任务进度" percent={progress.percent} tone={tone} />
    <button type="button" aria-expanded={expanded} aria-label={`${expanded ? "收起" : "展开"}未分配`} onClick={onToggle} className="relative z-10 flex w-full flex-wrap items-center gap-3 px-3 py-3 text-left hover:bg-[#f6f8fa]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0969da]/30">
      {expanded ? <ChevronDown className="size-4 shrink-0 text-[#57606a]" /> : <ChevronRight className="size-4 shrink-0 text-[#57606a]" />}
      {tone === "danger" || tone === "warning" ? <CircleAlert className={`size-4 shrink-0 ${tone === "danger" ? "text-[#cf222e]" : "text-[#9a6700]"}`} /> : <CircleDashed className="size-4 shrink-0 text-[#57606a]" />}
      <span className="mr-auto font-semibold text-[#24292f]">未分配</span>
      <span className="text-xs text-[#57606a]">{progress.completed}/{progress.total} 个任务完成</span>
    </button>
    {expanded ? <div className="relative z-10 border-t border-[#eaeef2] bg-white/90 px-3 py-2 motion-safe:animate-[roadmap-reveal_180ms_ease-out]">{tasks.length === 0 ? <div className="py-2 text-sm text-[#8c959f]">暂无未分配任务</div> : <div className="divide-y divide-[#eef1f4]">{tasks.map((task) => <div key={task.id} className="flex flex-wrap items-center gap-3 py-2"><Link href={taskHref(projectId, task.id)} className="min-w-0 flex-1 break-words text-sm font-semibold text-[#0969da] hover:underline">{task.title}</Link><span className="text-xs text-[#57606a]">{task.assignee?.name ?? "未指派"}</span>{task.overdue ? <span className="text-xs font-semibold text-[#9a6700]">已逾期</span> : null}{task.blocker ? <CircleAlert className="size-4 text-[#cf222e]" aria-label="存在阻塞" /> : null}<StatusPill tone={task.statusCategory === "completed" ? "success" : task.blocker ? "danger" : "blue"}>{task.status.name}</StatusPill><select aria-label={`分配任务 ${task.title}`} className={`${inputClass} w-56`} defaultValue="" disabled={pending} onChange={(event) => void send({ type: "task.move", taskId: task.id, milestoneId: event.target.value || null, expectedTaskVersion: task.version })}><option value="">待规划工作</option>{milestones.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>)}</div>}</div> : null}
  </section>;
}
