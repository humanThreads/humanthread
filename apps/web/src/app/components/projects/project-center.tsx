"use client";

import Link from "next/link";
import { ArrowUpRight, FolderKanban, Plus, Search } from "lucide-react";
import { useState } from "react";
import type { ProjectHealth, ProjectListItem } from "../../../lib/workbench/workbench-projects";
import { EmptyState, StatusPill, WorkbenchButton } from "../workbench-ui";
import { ProjectCreateDialog, type ProjectCreateManagerOption, type ProjectCreateSpaceOption } from "./project-create-dialog";

const healthLabels: Record<ProjectHealth, string> = {
  healthy: "健康",
  at_risk: "有风险",
  blocked: "受阻",
  complete: "已完成",
  unknown: "状态未知",
};

function healthTone(health: ProjectHealth): "success" | "warning" | "danger" | "blue" | "default" {
  if (health === "healthy") return "success";
  if (health === "at_risk") return "warning";
  if (health === "blocked") return "danger";
  if (health === "complete") return "blue";
  return "default";
}

function dateLabel(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(value);
}

export function ProjectCenter({ projects, spaceLabel, search = "", status = "", health = "", spaces = [], managers = [], initialSpaceId, initialCreateOpen = false, onProjectCreated }: { projects: readonly ProjectListItem[]; spaceLabel: string; search?: string; status?: string; health?: string; spaces?: readonly ProjectCreateSpaceOption[]; managers?: readonly ProjectCreateManagerOption[]; initialSpaceId?: string; initialCreateOpen?: boolean; onProjectCreated?(result: { projectId: string; version: number }): void }) {
  const [createOpen, setCreateOpen] = useState(initialCreateOpen);
  function created(result: { projectId: string; version: number }) {
    if (onProjectCreated) onProjectCreated(result);
    else window.location.assign(`/projects/${encodeURIComponent(result.projectId)}`);
  }
  return (
    <><section className="min-w-0 overflow-hidden rounded-lg border border-[#d0d7de] bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#d8dee4] px-4 py-3">
        <div className="mr-auto flex items-center gap-2">
          <FolderKanban className="size-4 text-[#0969da]" />
          <div><h1 className="text-sm font-semibold text-[#24292f]">项目中心</h1><p className="text-xs text-[#57606a]">{spaceLabel} · 交付目标与路线图</p></div>
        </div>
        <WorkbenchButton type="button" onClick={() => setCreateOpen(true)} size="small" variant="primary"><Plus size={14} />新建项目</WorkbenchButton>
      </div>
      <form className="flex flex-wrap items-center gap-2 border-b border-[#d8dee4] bg-[#f6f8fa] px-4 py-3" method="get">
        <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-md border border-[#d0d7de] bg-white px-2.5"><Search size={14} className="text-[#57606a]" /><input name="search" defaultValue={search} placeholder="搜索项目名称或目标" className="h-8 min-w-0 flex-1 text-sm outline-none" /></label>
        <select name="status" defaultValue={status} className="h-8 rounded-md border border-[#d0d7de] bg-white px-2 text-xs"><option value="">全部生命周期</option><option value="draft">草稿</option><option value="active">进行中</option><option value="paused">已暂停</option><option value="completed">已完成</option></select>
        <select name="health" defaultValue={health} className="h-8 rounded-md border border-[#d0d7de] bg-white px-2 text-xs"><option value="">全部健康度</option>{Object.entries(healthLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <button type="submit" className="h-8 rounded-md border border-[#d0d7de] bg-white px-3 text-xs font-semibold text-[#24292f] hover:bg-[#ffffff]">筛选</button>
      </form>
      {projects.length === 0 ? <EmptyState title="当前空间还没有匹配项目" description="创建一个项目，先写清目标，再逐步拆分阶段、里程碑和任务。" action={<WorkbenchButton type="button" onClick={() => setCreateOpen(true)} variant="primary" size="small"><Plus size={14} />创建项目</WorkbenchButton>} /> : <div className="divide-y divide-[#d8dee4]">{projects.map((project) => <article key={project.id} className="grid gap-4 px-4 py-4 transition hover:bg-[#f6f8fa] lg:grid-cols-[minmax(260px,1.4fr)_minmax(220px,1fr)_minmax(220px,0.9fr)_auto] lg:items-center">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Link href={`/projects/${project.id}`} className="truncate text-base font-semibold text-[#0969da] hover:underline">{project.name}</Link><StatusPill tone={healthTone(project.health)}>{healthLabels[project.health]}</StatusPill></div><p className="mt-1 line-clamp-2 text-sm leading-5 text-[#57606a]">{project.objectiveExcerpt ?? "尚未填写项目目标"}</p><div className="mt-2 text-xs text-[#8c959f]">{project.spaceLabel} · 更新于 {dateLabel(project.updatedAt)}</div></div>
        <div><div className="flex items-center justify-between text-xs text-[#57606a]"><span>路线图进度</span><span className="font-semibold text-[#24292f]">{project.stageProgress.percent}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[#eaeef2]"><div className="h-full rounded-full bg-[#0969da]" style={{ width: `${project.stageProgress.percent}%` }} /></div><div className="mt-1 text-xs text-[#8c959f]">{project.stageProgress.completed}/{project.stageProgress.total} 个里程碑</div></div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-md border border-[#d0d7de] bg-white px-2 py-2"><div className="font-semibold text-[#24292f]">{project.openTaskCount}</div><div className="mt-1 text-[#57606a]">未完成</div></div><div className="rounded-md border border-[#d0d7de] bg-white px-2 py-2"><div className="font-semibold text-[#9a6700]">{project.overdueTaskCount}</div><div className="mt-1 text-[#57606a]">逾期</div></div><div className="rounded-md border border-[#d0d7de] bg-white px-2 py-2"><div className="font-semibold text-[#cf222e]">{project.blockedTaskCount}</div><div className="mt-1 text-[#57606a]">阻塞</div></div></div>
        <div className="flex flex-wrap items-center justify-end gap-2"><Link href={`/projects/${project.id}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d0d7de] px-2.5 text-xs font-semibold text-[#24292f] hover:bg-white">打开 <ArrowUpRight size={14} /></Link><Link href={`/projects/${encodeURIComponent(project.id)}/loops`} className="text-xs font-semibold text-[#0969da] hover:underline">Loop</Link><Link href={`/projects/${encodeURIComponent(project.id)}/knowledge`} className="text-xs font-semibold text-[#0969da] hover:underline">知识</Link><Link href={`/tasks?project=${encodeURIComponent(project.id)}`} className="text-xs font-semibold text-[#0969da] hover:underline">任务</Link></div>
      </article>)}</div>}
    </section><ProjectCreateDialog open={createOpen} spaces={spaces} managers={managers} {...(initialSpaceId ? { initialSpaceId } : {})} onOpenChange={setCreateOpen} onCreated={created} /></>
  );
}
