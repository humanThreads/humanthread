import Link from "next/link";
import type { WorkbenchOverviewResult } from "../../lib/workbench/workbench-overview";
import type { ProjectListItem } from "../../lib/workbench/workbench-projects";
import { Panel } from "./workbench-ui";

export function DashboardSecondarySummary({ projects, members, activeRuns, selectedSpaceKey }: {
  projects: ProjectListItem[];
  members: WorkbenchOverviewResult["members"];
  activeRuns: number;
  selectedSpaceKey: string;
}) {
  const visibleProjects = [...projects].sort((left, right) => {
    const rank = { blocked: 0, at_risk: 1, healthy: 2, complete: 3, unknown: 4 };
    return rank[left.health] - rank[right.health];
  }).slice(0, 3);
  return <section className="grid gap-5 lg:grid-cols-2"><Panel title="项目风险"><div className="grid gap-2">{visibleProjects.length ? visibleProjects.map((project) => <Link key={project.id} href={`/projects/${encodeURIComponent(project.id)}${selectedSpaceKey !== "all" ? `?space=${encodeURIComponent(selectedSpaceKey)}` : ""}`} className="flex items-center justify-between border border-[#d8dee4] px-3 py-2 text-sm hover:border-[#0969da]"><span className="truncate font-medium">{project.name}</span><span className="text-xs text-[#57606a]">{project.health === "at_risk" ? "需关注" : project.health === "blocked" ? "已阻塞" : "正常"}</span></Link>) : <p className="text-sm text-[#57606a]">当前没有项目风险。</p>}</div></Panel><Panel title="团队与自动化"><div className="grid gap-3 text-sm"><div className="flex justify-between gap-3"><span className="text-[#57606a]">团队可用性</span><span className="font-semibold">{members.length} 位成员</span></div><div className="flex justify-between gap-3"><span className="text-[#57606a]">自动化状态</span><span className="font-semibold">{activeRuns ? `${activeRuns} 项运行中` : "未自动化"}</span></div></div></Panel></section>;
}
