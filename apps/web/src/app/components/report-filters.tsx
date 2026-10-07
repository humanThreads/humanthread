import Link from "next/link";
import type { ProjectListItem } from "../../lib/workbench/workbench-projects";
import type { WorkbenchCompanyFilter } from "../../lib/workbench/workbench-companies";
import { DELIVERY_HEALTH_RANGES, type DeliveryHealthRange } from "../../lib/workbench/workbench-delivery-health-report";

export function buildReportHref(input: { spaceKey: string; projectId?: string; range: DeliveryHealthRange }) {
  const params = new URLSearchParams({ range: input.range });
  if (input.spaceKey !== "all") params.set("space", input.spaceKey);
  if (input.projectId) params.set("project", input.projectId);
  return `/reports?${params.toString()}`;
}

export function ReportFilters({ spaces, projects, selectedSpaceKey, selectedProjectId, range }: {
  spaces: WorkbenchCompanyFilter[];
  projects: ProjectListItem[];
  selectedSpaceKey: string;
  selectedProjectId?: string | undefined;
  range: DeliveryHealthRange;
}) {
  return <section aria-label="报表筛选" className="mb-5 flex flex-wrap items-center gap-3 border-b border-[#d8dee4] pb-4">
    <div className="flex flex-wrap gap-1" aria-label="Space 筛选">{spaces.map((space) => <Link key={space.key} href={buildReportHref({ spaceKey: space.key, range })} className={space.key === selectedSpaceKey ? "border border-[#0969da] bg-[#ddf4ff] px-3 py-1.5 text-xs font-semibold text-[#0a3069]" : "border border-[#d0d7de] bg-white px-3 py-1.5 text-xs font-semibold text-[#57606a]"}>{space.label}</Link>)}</div>
    <form action="/reports" method="get" className="flex items-center gap-1">
      <input type="hidden" name="range" value={range} />
      {selectedSpaceKey !== "all" ? <input type="hidden" name="space" value={selectedSpaceKey} /> : null}
      <select name="project" aria-label="项目筛选" defaultValue={selectedProjectId ?? ""} className="h-8 min-w-40 border border-[#d0d7de] bg-white px-2 text-xs">
        <option value="">全部项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      <button type="submit" className="h-8 border border-[#d0d7de] bg-white px-2 text-xs font-semibold">应用</button>
    </form>
    <div className="ml-auto flex gap-1" aria-label="时间范围">{DELIVERY_HEALTH_RANGES.map((item) => <Link key={item} aria-current={item === range ? "page" : undefined} href={buildReportHref({ spaceKey: selectedSpaceKey, ...(selectedProjectId ? { projectId: selectedProjectId } : {}), range: item })} className={item === range ? "bg-[#24292f] px-3 py-1.5 text-xs font-semibold text-white" : "border border-[#d0d7de] bg-white px-3 py-1.5 text-xs font-semibold text-[#57606a]"}>{item === "7d" ? "近 7 天" : item === "30d" ? "近 30 天" : "近 90 天"}</Link>)}</div>
  </section>;
}
