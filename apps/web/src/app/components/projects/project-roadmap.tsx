"use client";

import { ArrowUpRight, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, CircleDashed, ListTodo, Rocket } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { ProjectHubView } from "../../../lib/workbench/workbench-projects";
import { EmptyState, Panel, StatusPill } from "../workbench-ui";
import { MilestoneLoopButton } from "./milestone-loop-dialog";
import { progressPercent, roadmapProgressTone, roadmapStatusLabel, roadmapStatusTone, taskHref, taskProgress, taskProgressTone, type ProjectRoadmap as ProjectRoadmapData, type ProjectRoadmapMilestone, type ProjectRoadmapStage, type ProjectTaskSummary, unassignedProjectTasks } from "./project-roadmap-model";
import { RoadmapProgressBackdrop } from "./project-roadmap-progress";

type ProjectRoadmapProps = { roadmap: ProjectHubView["roadmap"]; projectId?: string; projectTasks?: ProjectTaskSummary[] };

export function ProjectRoadmap({ roadmap, projectId = "", projectTasks = [] }: ProjectRoadmapProps) {
  const [expandedStageId, setExpandedStageId] = useState<string | null>(null);
  const [expandedMilestoneId, setExpandedMilestoneId] = useState<string | null>(null);
  const unassigned = unassignedProjectTasks(roadmap, projectTasks);

  function toggleStage(stageId: string) {
    setExpandedStageId((current) => current === stageId ? null : stageId);
    setExpandedMilestoneId(null);
  }

  function toggleMilestone(milestoneId: string) {
    setExpandedMilestoneId((current) => current === milestoneId ? null : milestoneId);
  }

  return <Panel className="overflow-visible" title="交付路线图" action={<div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-3"><ReleasePlanButton projectId={projectId} roadmap={roadmap} /><span className="hidden text-xs text-[#57606a] sm:inline">点击阶段查看里程碑与任务</span></div>}>
    {roadmap.length === 0 ? <EmptyState title="尚未建立路线图" description="添加阶段和里程碑后，项目进度才会有可读的交付结构。" /> : <div className="divide-y divide-[#d8dee4] border-y border-[#d8dee4]">{roadmap.map((stage) => <ReadOnlyStage key={stage.id} stage={stage} projectId={projectId} expanded={expandedStageId === stage.id} expandedMilestoneId={expandedMilestoneId} onToggle={() => toggleStage(stage.id)} onMilestoneToggle={toggleMilestone} />)}</div>}
    {projectTasks.length > 0 ? <UnassignedTasks projectId={projectId} tasks={unassigned} expanded={expandedStageId === "unassigned"} onToggle={() => toggleStage("unassigned")} /> : null}
    {roadmap.length > 0 && projectTasks.length === 0 ? <div className="mt-3 flex items-center gap-2 rounded-md border border-dashed border-[#d0d7de] px-3 py-3 text-sm text-[#57606a]"><ListTodo size={16} />暂无项目任务</div> : null}
    <div className="mt-3 flex justify-end"><Link href={`/tasks${projectId ? `?project=${encodeURIComponent(projectId)}` : ""}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#0969da] hover:underline">在任务中心打开全部任务 <ArrowUpRight size={13} /></Link></div>
  </Panel>;
}

export function ReleasePlanButton({ projectId, roadmap }: { projectId: string; roadmap: ProjectRoadmapData }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("临时发布计划");
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loopRunId, setLoopRunId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const tasks = roadmap.flatMap((stage) => stage.milestones.flatMap((milestone) => milestone.tasks.filter((task) => (task.statusCategory ?? task.status) === "completed" && task.publicationStatus !== "published").map((task) => ({ ...task, stageName: stage.name }))));
  async function create() {
    if (!selected.length || submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/release-plans`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", commandId: `release-plan-${Date.now()}`, name, taskIds: selected }) });
    const body = await response.json() as { ok?: boolean; error?: string; plan?: { id?: string } };
    if (!body.ok || !body.plan?.id) {
      setMessage(body.error ?? "发布计划创建失败");
      return;
    }
    const startResponse = await fetch(`/api/projects/${encodeURIComponent(projectId)}/release-plans`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start", commandId: `release-plan-start-${Date.now()}`, planId: body.plan.id }) });
    const startBody = await startResponse.json() as { ok?: boolean; error?: string; loopRunId?: string };
    if (startBody.ok && startBody.loopRunId) {
      setLoopRunId(startBody.loopRunId);
      setMessage("发布计划已启动");
    } else {
      setMessage(startBody.error ?? "发布计划创建成功，但启动失败");
    }
    } catch {
      setMessage("发布计划请求失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }
  if (!projectId) return null;
  return <div className="relative"><button type="button" onClick={() => { setOpen((value) => !value); setMessage(null); setLoopRunId(null); }} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d0d7de] px-2 text-xs font-semibold text-[#24292f]" title="创建发布计划"><Rocket size={14} />发布计划</button>{open ? <div className="absolute right-0 top-10 z-20 w-[min(360px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] rounded-md border border-[#d0d7de] bg-white p-3 shadow-lg"><h3 className="text-sm font-semibold">创建发布计划</h3><input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 h-8 w-full rounded border border-[#d0d7de] px-2 text-xs" aria-label="发布计划名称" />{tasks.length === 0 ? <p className="mt-3 text-xs text-[#57606a]">暂无可发布任务</p> : <><div className="mt-2 flex items-center justify-between text-xs text-[#57606a]"><span>已选择 {selected.length} / {tasks.length}</span><button type="button" onClick={() => setSelected([])} disabled={!selected.length || submitting} className="font-semibold text-[#0969da] disabled:text-[#8c959f]">清空选择</button></div><div className="mt-1 max-h-48 overflow-y-auto divide-y divide-[#eef1f4]">{tasks.map((task) => <label key={task.id} className="flex items-center gap-2 py-2 text-xs"><input type="checkbox" checked={selected.includes(task.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} disabled={submitting} /> <span className="min-w-0 flex-1 break-words">{task.title}</span><span className="shrink-0 text-[#57606a]">{task.stageName}</span></label>)}</div></>}<div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="h-8 rounded border border-[#d0d7de] px-2 text-xs" disabled={submitting}>取消</button><button type="button" onClick={() => void create()} disabled={!selected.length || submitting} className="h-8 rounded bg-[#0969da] px-2 text-xs font-semibold text-white disabled:opacity-40">{submitting ? "启动中…" : "创建"}</button></div>{message ? <p className="mt-2 text-xs text-[#57606a]">{message}</p> : null}{loopRunId ? <Link href={`/loop-runs/${encodeURIComponent(loopRunId)}`} className="mt-2 inline-flex max-w-full items-center gap-1 break-words text-xs font-semibold text-[#0969da] hover:underline">进入发布 Loop 运行工作区 <ArrowUpRight size={13} /></Link> : null}</div> : null}</div>;
}
function ReadOnlyStage({ stage, projectId, expanded, expandedMilestoneId, onToggle, onMilestoneToggle }: { stage: ProjectRoadmapStage; projectId: string; expanded: boolean; expandedMilestoneId: string | null; onToggle(): void; onMilestoneToggle(milestoneId: string): void }) {
  const percent = progressPercent(stage.completedMilestones, stage.totalMilestones);
  const stageTasks = stage.milestones.flatMap((milestone) => milestone.tasks).filter((task) => (task.statusCategory ?? task.status) !== "cancelled");
  const releasable = stage.publicationStatus !== "published" && stageTasks.length > 0 && stageTasks.every((task) => (task.statusCategory ?? task.status) === "completed") && stageTasks.some((task) => task.publicationStatus !== "published");
  return <section className="relative overflow-hidden bg-white">
    <RoadmapProgressBackdrop label={`${stage.name}进度`} percent={percent} tone={roadmapProgressTone(stage.status)} />
    <div className="relative z-10 flex flex-wrap items-center gap-3 px-3 py-3">
      <button type="button" aria-expanded={expanded} aria-controls={`roadmap-stage-${stage.id}`} aria-label={`${expanded ? "收起" : "展开"}${stage.name}`} onClick={onToggle} className="inline-flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0969da]/30">
        {expanded ? <ChevronDown className="size-4 shrink-0 text-[#57606a]" /> : <ChevronRight className="size-4 shrink-0 text-[#57606a]" />}
        <CircleDashed className={`size-4 shrink-0 ${stage.status === "completed" ? "text-[#1a7f37]" : stage.status === "at_risk" ? "text-[#9a6700]" : "text-[#0969da]"}`} />
        <span className="truncate font-semibold text-[#24292f]">{stage.name}</span>
      </button>
      <StatusPill tone={roadmapStatusTone(stage.publicationStatus === "published" ? "published" : stage.status)}>{stage.publicationStatus === "published" ? "已发布" : releasable ? "可发版" : roadmapStatusLabel(stage.status)}</StatusPill>
      <span className="text-xs text-[#57606a]">{stage.completedMilestones}/{stage.totalMilestones} 个里程碑</span>
    </div>
    {expanded ? <div id={`roadmap-stage-${stage.id}`} className="relative z-10 border-t border-[#eaeef2] bg-white/90 px-3 py-2 motion-safe:animate-[roadmap-reveal_180ms_ease-out]">
      {stage.milestones.length === 0 ? <div className="px-2 py-3 text-sm text-[#8c959f]">暂无里程碑</div> : <div className="divide-y divide-[#eef1f4]">{stage.milestones.map((milestone) => <ReadOnlyMilestone key={milestone.id} milestone={milestone} projectId={projectId} expanded={expandedMilestoneId === milestone.id} onToggle={() => onMilestoneToggle(milestone.id)} />)}</div>}
    </div> : null}
  </section>;
}

function ReadOnlyMilestone({ milestone, projectId, expanded, onToggle }: { milestone: ProjectRoadmapMilestone; projectId: string; expanded: boolean; onToggle(): void }) {
  return <div className="relative">
    <div className="flex w-full flex-wrap items-center gap-3 px-2 py-3 text-left hover:bg-[#f6f8fa]">
    <button type="button" aria-expanded={expanded} aria-controls={`roadmap-milestone-${milestone.id}`} aria-label={`${expanded ? "收起" : "展开"}${milestone.name}`} onClick={onToggle} className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0969da]/30">
      {expanded ? <ChevronDown className="size-4 shrink-0 text-[#57606a]" /> : <ChevronRight className="size-4 shrink-0 text-[#57606a]" />}
      <CheckCircle2 className={`size-4 shrink-0 ${milestone.status === "completed" ? "text-[#1a7f37]" : milestone.status === "at_risk" ? "text-[#9a6700]" : "text-[#8c959f]"}`} />
      <span className="mr-auto min-w-0 truncate text-sm font-medium text-[#24292f]">{milestone.name}</span>
      <span className="text-xs text-[#57606a]">{milestone.taskCount} 个任务</span>
      {milestone.targetAt ? <span className="inline-flex items-center gap-1 text-xs text-[#57606a]"><CalendarClock size={12} />{new Intl.DateTimeFormat("zh-CN").format(milestone.targetAt)}</span> : null}
      <StatusPill tone={roadmapStatusTone(milestone.status)}>{roadmapStatusLabel(milestone.status)}</StatusPill>
    </button>
      {milestone.tasks.length > 0 ? <MilestoneLoopButton milestoneId={milestone.id} milestoneName={milestone.name} iconSize={13} className="grid h-7 w-7 place-items-center rounded border border-[#d0d7de] text-[#0969da]" /> : null}
    </div>
    {expanded ? <div id={`roadmap-milestone-${milestone.id}`} className="border-t border-[#eef1f4] bg-[#fbfcfd] px-9 py-2 motion-safe:animate-[roadmap-reveal_180ms_ease-out]">{milestone.tasks.length === 0 ? <div className="py-2 text-xs text-[#8c959f]">暂无任务</div> : <div className="divide-y divide-[#eef1f4]">{milestone.tasks.map((task) => <TaskRow key={task.id} projectId={projectId} task={task} />)}</div>}</div> : null}
  </div>;
}

function TaskRow({ projectId, task }: { projectId: string; task: { id: string; title: string; status: string; statusCategory?: string; publicationStatus?: string } }) {
  return <div className="flex flex-wrap items-center gap-2 py-2 text-xs"><Link href={taskHref(projectId, task.id)} className="min-w-0 flex-1 break-words font-semibold text-[#0969da] hover:underline">{task.title}</Link><StatusPill tone={task.publicationStatus === "published" ? "success" : (task.statusCategory ?? task.status) === "completed" ? "success" : "blue"}>{task.publicationStatus === "published" ? "已发布" : roadmapStatusLabel(task.status)}</StatusPill></div>;
}

function UnassignedTasks({ projectId, tasks, expanded, onToggle }: { projectId: string; tasks: ProjectTaskSummary[]; expanded: boolean; onToggle(): void }) {
  const progress = taskProgress(tasks);
  const tone = taskProgressTone(tasks);
  return <section className="relative mt-3 overflow-hidden rounded-md border border-[#d0d7de] bg-white">
    <RoadmapProgressBackdrop label="未分配任务进度" percent={progress.percent} tone={tone} />
    <button type="button" aria-expanded={expanded} aria-label={`${expanded ? "收起" : "展开"}未分配`} onClick={onToggle} className="relative z-10 flex w-full flex-wrap items-center gap-3 px-3 py-3 text-left hover:bg-[#f6f8fa]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0969da]/30">
      {expanded ? <ChevronDown className="size-4 shrink-0 text-[#57606a]" /> : <ChevronRight className="size-4 shrink-0 text-[#57606a]" />}
      {tone === "danger" || tone === "warning" ? <CircleAlert className={`size-4 shrink-0 ${tone === "danger" ? "text-[#cf222e]" : "text-[#9a6700]"}`} /> : <ListTodo className="size-4 shrink-0 text-[#57606a]" />}
      <span className="mr-auto font-semibold text-[#24292f]">未分配</span>
      <span className="text-xs text-[#57606a]">{progress.completed}/{progress.total} 个任务完成</span>
    </button>
    {expanded ? <div className="relative z-10 border-t border-[#eaeef2] bg-white/90 px-3 py-2 motion-safe:animate-[roadmap-reveal_180ms_ease-out]">{tasks.length === 0 ? <div className="py-2 text-sm text-[#8c959f]">暂无未分配任务</div> : <div className="divide-y divide-[#eef1f4]">{tasks.map((task) => <div key={task.id} className="flex flex-wrap items-center gap-3 py-2"><Link href={taskHref(projectId, task.id)} className="min-w-0 flex-1 break-words text-sm font-semibold text-[#0969da] hover:underline">{task.title}</Link><span className="text-xs text-[#57606a]">{task.assignee?.name ?? "未指派"}</span>{task.overdue ? <span className="text-xs font-semibold text-[#9a6700]">已逾期</span> : null}{task.blocker ? <CircleAlert className="size-4 text-[#cf222e]" aria-label="存在阻塞" /> : null}<StatusPill tone={task.statusCategory === "completed" ? "success" : task.blocker ? "danger" : "blue"}>{task.status.name}</StatusPill></div>)}</div>}</div> : null}
  </section>;
}
