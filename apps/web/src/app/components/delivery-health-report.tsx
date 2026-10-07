import Link from "next/link";
import type { DeliveryHealthReportData } from "../../lib/workbench/workbench-delivery-health-report";
import { MotionReveal } from "./motion-reveal";
import { Panel } from "./workbench-ui";

function metricValue(value: number | null, suffix = "") { return value === null ? "数据不足" : `${value}${suffix}`; }

export function buildDeliveryHealthTaskHref(input: { spaceKey: string; projectId?: string; relation: "blocked" | "completed" | "overdue" }) {
  const params = new URLSearchParams({ spaceKey: input.spaceKey });
  if (input.projectId) params.set("project", input.projectId);
  params.set("relation", input.relation);
  return `/tasks?${params.toString()}`;
}

export function DeliveryHealthReport({ report, selectedSpaceKey, selectedProjectId }: { report: DeliveryHealthReportData; selectedSpaceKey: string; selectedProjectId?: string }) {
  const automation = report.metrics.automationSuccess;
  const metrics = [
    ["已完成任务", report.metrics.completedTasks, buildDeliveryHealthTaskHref({ spaceKey: selectedSpaceKey, ...(selectedProjectId ? { projectId: selectedProjectId } : {}), relation: "completed" })],
    ["逾期任务", report.metrics.overdueTasks, buildDeliveryHealthTaskHref({ spaceKey: selectedSpaceKey, ...(selectedProjectId ? { projectId: selectedProjectId } : {}), relation: "overdue" })],
    ["阻塞中位时长", metricValue(report.metrics.blockerMedianAgeHours, "h"), buildDeliveryHealthTaskHref({ spaceKey: selectedSpaceKey, ...(selectedProjectId ? { projectId: selectedProjectId } : {}), relation: "blocked" })],
    ["人工等待中位时长", metricValue(report.metrics.humanWaitMedianAgeHours, "h"), `/agents?space=${encodeURIComponent(selectedSpaceKey)}#approvals`],
    ["Agent / Loop 成功率", automation.state === "known" ? `${automation.rate}%` : automation.label, `/agents?space=${encodeURIComponent(selectedSpaceKey)}`],
  ] as const;
  return <MotionReveal motionKey={`delivery:${report.range}:${report.generatedAt.toISOString()}`}><div className="grid gap-5">
    <section aria-label="交付指标" className="grid grid-cols-2 gap-3 xl:grid-cols-5">{metrics.map(([label, value, href]) => <Link key={label} href={href} className="min-h-[112px] border border-[#d0d7de] bg-white p-4 hover:border-[#0969da]"><div className="text-xs font-semibold text-[#57606a]">{label}</div><div className="mt-3 text-2xl font-semibold text-[#24292f]">{value}</div></Link>)}</section>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]">
      <Panel title="吞吐与阻塞趋势">{report.trend.state === "insufficient" ? <div className="grid h-36 place-items-center border border-dashed border-[#d0d7de] bg-[#f6f8fa] text-sm text-[#57606a]">{report.trend.message}</div> : <div><div className="mb-3 flex gap-4 text-xs text-[#57606a]"><span><span className="mr-1 inline-block h-2 w-2 bg-[#0969da]" />已完成</span><span><span className="mr-1 inline-block h-2 w-2 bg-[#cf222e]" />新增阻塞</span></div><div className="flex h-32 items-end gap-1 overflow-hidden">{report.trend.points.map((point) => <div key={point.label} className="grid min-w-5 flex-1 gap-1 text-center"><div className="flex h-24 items-end justify-center gap-0.5"><div className="w-2 bg-[#0969da]" style={{ height: Math.max(4, point.completed * 12) }} /><div className="w-2 bg-[#cf222e]" style={{ height: Math.max(4, point.blockers * 12) }} /></div><span className="text-[10px] text-[#57606a]">{point.label}</span></div>)}</div></div>}</Panel>
      <Panel title="行动建议"><div className="grid gap-2">{report.insights.map((item) => <Link key={item.label} href={item.href} className="flex items-center justify-between border border-[#d8dee4] px-3 py-2 text-sm hover:border-[#0969da]"><span>{item.label}</span><span className="font-semibold">{item.count}</span></Link>)}</div></Panel>
    </div>
    <Panel title="项目健康">{report.projects.length ? <div className="divide-y divide-[#d8dee4]">{report.projects.map((project) => <Link key={project.id} href={`/projects/${encodeURIComponent(project.id)}`} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_120px_180px]"><span className="font-medium">{project.name}</span><span className="text-sm text-[#57606a]">{project.health === "blocked" ? "已阻塞" : project.health === "at_risk" ? "需关注" : "正常"}</span><span className="text-sm text-[#57606a]">开放 {project.openTaskCount} · 逾期 {project.overdueTaskCount}</span></Link>)}</div> : <p className="text-sm text-[#57606a]">当前范围内没有项目数据。</p>}</Panel>
  </div></MotionReveal>;
}
