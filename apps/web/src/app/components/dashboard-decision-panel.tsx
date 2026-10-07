import Link from "next/link";
import type { WorkbenchDashboardDetail } from "../../lib/workbench/workbench-dashboard";
import type { ProjectListItem } from "../../lib/workbench/workbench-projects";
import { getTaskPrimaryAction } from "../../lib/workbench/workbench-task-analytics";
import { EmptyState, Panel, StatusPill, WorkbenchButton } from "./workbench-ui";

function healthLabel(health: ProjectListItem["health"] | undefined) {
  return health === "blocked" ? "已阻塞" : health === "at_risk" ? "需关注" : health === "complete" ? "已完成" : health === "healthy" ? "正常" : "状态未知";
}

export function DashboardDecisionPanel({
  detail,
  project,
  pendingConfirmations,
}: {
  detail: WorkbenchDashboardDetail | null;
  project?: ProjectListItem | undefined;
  pendingConfirmations: number;
}) {
  if (!detail) {
    return <Panel title="当前决策"><EmptyState title="当前没有打开任务" description="从收件箱选择事项，或先建立一条可跟进的任务。" action={<WorkbenchButton href="/tasks">打开任务中心</WorkbenchButton>} /></Panel>;
  }
  const action = getTaskPrimaryAction(detail.task);
  const risk = detail.risks[0];
  return <Panel title="当前决策" action={<StatusPill tone={risk?.tone === "danger" ? "danger" : "blue"}>{detail.metadata.phaseLabel}</StatusPill>}>
    <div className="grid gap-5">
      <div><p className="text-xs font-semibold text-[#57606a]">下一项行动</p><h2 className="mt-1 text-xl font-semibold text-[#24292f]">{action.label}</h2><p className="mt-2 text-sm leading-6 text-[#57606a]">{detail.nextAction.description}</p></div>
      <div className="border border-[#d8dee4] bg-[#f6f8fa] p-3"><div className="text-sm font-semibold">{detail.task.task.title}</div><div className="mt-1 text-xs text-[#57606a]">{detail.task.project.name} · {detail.metadata.ownerLabel} · {detail.metadata.dueLabel}</div></div>
      {risk ? <div className="border-l-2 border-[#cf222e] bg-[#fff5f5] px-3 py-2 text-sm"><div className="font-semibold">{risk.title}</div><p className="mt-1 text-xs leading-5 text-[#57606a]">{risk.description}</p></div> : null}
      <div className="grid gap-3 sm:grid-cols-2"><div className="border border-[#d8dee4] p-3"><div className="text-xs text-[#57606a]">上下文</div><div className="mt-1 font-semibold">{detail.context.complete} / {detail.context.total} 已就绪</div></div><div className="border border-[#d8dee4] p-3"><div className="text-xs text-[#57606a]">项目健康</div><div className="mt-1 font-semibold">{healthLabel(project?.health)}</div></div></div>
      <div className="flex items-center justify-between gap-3 border-t border-[#d8dee4] pt-4"><span className="text-sm text-[#57606a]">自动化待确认 {pendingConfirmations} 项</span><Link href={`/tasks/${encodeURIComponent(detail.task.task.id)}`} className="text-sm font-semibold text-[#0969da]">打开任务</Link></div>
    </div>
  </Panel>;
}
