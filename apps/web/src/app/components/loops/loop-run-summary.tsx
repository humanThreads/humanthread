import { ExternalLink, MessageSquare, Workflow } from "lucide-react";
import Link from "next/link";

export interface LoopRunSummaryModel {
  id: string;
  status: string;
  currentNodeLabel?: string | null;
  pendingInteraction?: { id: string; kind?: string; status?: string } | null;
}

export function LoopRunSummary({ loopRun, compact = false }: { loopRun: LoopRunSummaryModel; compact?: boolean }) {
  const interaction = loopRun.pendingInteraction?.status === "open" ? loopRun.pendingInteraction : null;
  return <section aria-label="Loop 运行摘要" className={compact ? "flex flex-wrap items-center gap-2 text-xs" : "border border-[#d0d7de] bg-white p-3 text-sm"}>
    <Workflow aria-hidden="true" className="h-4 w-4 text-[#57606a]" />
    <span className="font-semibold text-[#24292f]">{loopRun.id}</span><span className="text-[#57606a]">{runStatusLabel(loopRun.status)}{loopRun.currentNodeLabel ? ` · ${loopRun.currentNodeLabel}` : ""}</span>
    {interaction ? <span className="inline-flex items-center gap-1 text-[#9a6700]"><MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />等待交互</span> : null}
    <Link href={`/loop-runs/${encodeURIComponent(loopRun.id)}${interaction ? `?interaction=${encodeURIComponent(interaction.id)}` : ""}`} aria-label="打开 Loop 运行工作区" title="打开 Loop 运行工作区" className="ml-auto inline-grid h-7 w-7 place-items-center rounded-md border border-[#d0d7de] text-[#57606a]"><ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /></Link>
  </section>;
}

function runStatusLabel(status: string) { return ({ pending: "待启动", running: "运行中", waiting: "等待中", paused: "已暂停", completed: "已完成", failed: "失败", exhausted: "预算耗尽", cancelled: "已取消" } as Record<string, string>)[status] ?? status; }
