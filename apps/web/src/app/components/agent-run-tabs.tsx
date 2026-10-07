import Link from "next/link";
import { ListChecks, RefreshCw } from "lucide-react";
import { LoopMonitor, type LoopMonitorItem } from "./loop-monitor";
import { StatusPill } from "./workbench-ui";

type AgentRunItem = {
  id: string;
  loopRunId?: string | null;
  nodeKey?: string | null;
  taskTitle: string;
  status: string;
  attempt: number;
  provider: string;
  workerName?: string | null;
  lastHeartbeatAt: Date | null;
};

function buildAgentViewHref(input: {
  view: "monitor" | "attempts";
  selectedSpaceKey: string;
  cursor?: string | null;
}): string {
  const query = new URLSearchParams();
  query.set("space", input.selectedSpaceKey);
  query.set("view", input.view);
  if (input.cursor) query.set("cursor", input.cursor);
  return `/agents?${query.toString()}`;
}

export function AgentRunTabs({ activeView, loops, runs, canManage, nextCursor, selectedSpaceKey }: {
  activeView: "monitor" | "attempts";
  loops: LoopMonitorItem[];
  runs: AgentRunItem[];
  canManage: boolean;
  nextCursor: string | null;
  selectedSpaceKey: string;
}) {
  return <section className="overflow-hidden rounded-md border border-[#d0d7de] bg-white">
    <nav aria-label="Agent 运行视图" className="flex min-h-11 items-end gap-1 border-b border-[#d8dee4] px-3" role="tablist">
      <Link aria-selected={activeView === "monitor"} className={activeView === "monitor" ? "inline-flex h-11 items-center gap-2 border-b-2 border-[#0969da] px-3 text-sm font-semibold text-[#0969da]" : "inline-flex h-11 items-center gap-2 px-3 text-sm text-[#59636e] hover:bg-[#f6f8fa]"} href={buildAgentViewHref({ view: "monitor", selectedSpaceKey })} role="tab">
        <RefreshCw aria-hidden="true" className="size-4" />Loop Monitor
        <span className="rounded-full bg-[#eaeef2] px-2 py-0.5 text-xs text-[#59636e]">{loops.length}</span>
      </Link>
      <Link aria-selected={activeView === "attempts"} className={activeView === "attempts" ? "inline-flex h-11 items-center gap-2 border-b-2 border-[#0969da] px-3 text-sm font-semibold text-[#0969da]" : "inline-flex h-11 items-center gap-2 px-3 text-sm text-[#59636e] hover:bg-[#f6f8fa]"} href={buildAgentViewHref({ view: "attempts", selectedSpaceKey })} role="tab">
        <ListChecks aria-hidden="true" className="size-4" />执行尝试
      </Link>
    </nav>
    {activeView === "monitor" ? <LoopMonitor loops={loops} canManage={canManage} embedded /> : <div>
      <div className="divide-y divide-[#d8dee4]">{runs.map((run) => <div key={run.id} className="flex items-center justify-between gap-4 px-4 py-3"><div className="min-w-0">{run.loopRunId ? <Link className="block truncate text-sm font-medium text-[#0969da] hover:underline" href={`/loop-runs/${encodeURIComponent(run.loopRunId)}`}>{run.taskTitle}</Link> : <div className="truncate text-sm font-medium">{run.taskTitle}</div>}<div className="mt-1 text-xs text-[#59636e]">{run.provider} · 尝试 {run.attempt}{run.nodeKey ? ` · 节点 ${run.nodeKey}` : ""}{run.workerName ? ` · ${run.workerName}` : ""}</div></div><StatusPill tone={run.status === "running" ? "blue" : "default"}>{run.status}</StatusPill></div>)}</div>
      {runs.length === 0 ? <p className="px-4 py-8 text-center text-sm text-[#59636e]">暂无执行尝试</p> : null}
      {nextCursor ? <div className="border-t border-[#d8dee4] px-4 py-3 text-center"><Link className="inline-flex min-h-9 items-center rounded-md border border-[#d0d7de] bg-white px-3 text-sm font-semibold text-[#24292f] hover:bg-[#f6f8fa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0969da]" href={buildAgentViewHref({ view: "attempts", selectedSpaceKey, cursor: nextCursor })}>继续查看较早记录</Link></div> : null}
    </div>}
  </section>;
}
