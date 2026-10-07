import Link from "next/link";
import { ArrowLeft, BookOpen, CalendarClock, Settings } from "lucide-react";
import type { ProjectHubView } from "../../../lib/workbench/workbench-projects";
import { StatusPill, WorkbenchButton } from "../workbench-ui";

export function ProjectHubHeader({ project }: { project: ProjectHubView["project"] }) {
  const tone = project.health === "healthy" ? "success" : project.health === "blocked" ? "danger" : project.health === "at_risk" ? "warning" : "blue";
  return <header className="border-b border-[#d0d7de] bg-white px-4 py-4 sm:px-6">
    <div className="flex flex-wrap items-start gap-4">
      <div className="mr-auto min-w-0">
        <Link href="/projects" className="inline-flex items-center gap-1 text-xs font-semibold text-[#57606a] hover:text-[#0969da]"><ArrowLeft size={14} />项目中心</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2"><h1 className="truncate text-xl font-semibold text-[#24292f]">{project.name}</h1><StatusPill tone={tone}>{project.health === "healthy" ? "健康" : project.health === "blocked" ? "受阻" : project.health === "at_risk" ? "有风险" : "已完成"}</StatusPill><StatusPill tone="default">{project.status}</StatusPill></div>
        <p className="mt-1 text-sm text-[#57606a]">{project.spaceLabel} · 负责人：{project.owner?.name ?? "未设置"}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <WorkbenchButton href={`/tasks?project=${encodeURIComponent(project.id)}`} size="small" variant="primary">查看任务</WorkbenchButton>
        <WorkbenchButton href={`/projects/${encodeURIComponent(project.id)}/knowledge`} size="small"><BookOpen size={14} />项目知识库</WorkbenchButton>
        <WorkbenchButton href={`/projects/${encodeURIComponent(project.id)}/scheduled-tasks`} size="small"><CalendarClock size={14} />定时任务</WorkbenchButton>
        <WorkbenchButton href={`/projects/${encodeURIComponent(project.id)}/settings`} size="small"><Settings size={14} />项目设置</WorkbenchButton>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap gap-6 text-xs text-[#57606a]"><span>开始：{project.startAt ? new Intl.DateTimeFormat("zh-CN").format(project.startAt) : "未设置"}</span><span>目标：{project.targetAt ? new Intl.DateTimeFormat("zh-CN").format(project.targetAt) : "未设置"}</span><span>路线图完成度：<strong className="text-[#24292f]">{project.stageProgress.percent}%</strong></span></div>
  </header>;
}
