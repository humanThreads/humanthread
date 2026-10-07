"use client";

import { CheckCircle2, Clock3, GitCommitHorizontal, ListChecks } from "lucide-react";
import { useState } from "react";
import type { ProjectActivityView, ProjectDecisionEntry } from "../../../lib/workbench/workbench-project-activity";
import { ApprovalDecisionDialog } from "../approval-decision-dialog";
import { EmptyState, Panel, StatusPill } from "../workbench-ui";

function decisionTone(status: string): "success" | "warning" | "default" {
  if (status === "approved") return "success";
  if (status === "pending") return "warning";
  return "default";
}

export function ProjectDecisionActivity({ view }: { view: ProjectActivityView }) {
  const [decisions, setDecisions] = useState(view.decisions);
  const [selected, setSelected] = useState<ProjectDecisionEntry | null>(null);
  const pending = decisions.filter((decision) => decision.status === "pending");

  return <div className="grid gap-5">
    <Panel title="项目决策" action={<span className="text-xs text-[#57606a]">{pending.length} 项待处理</span>}>
      {decisions.length === 0 ? <EmptyState title="暂无决策记录" description="需要人工确认的项目操作会显示在这里。" /> : <div className="divide-y divide-[#d8dee4]">{decisions.map((decision) => <div key={decision.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
        <ListChecks className="mt-0.5 size-4 shrink-0 text-[#57606a]" />
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-[#24292f]">{decision.taskTitle ?? decision.type}</strong><StatusPill tone={decisionTone(decision.status)}>{decision.status === "pending" ? "等待决定" : decision.status}</StatusPill></div><p className="mt-1 text-sm text-[#57606a]">{decision.action} · {decision.scope}</p>{decision.decisionReason ? <p className="mt-1 text-xs text-[#57606a]">说明：{decision.decisionReason}</p> : null}</div>
        {view.canDecide && decision.status === "pending" ? <button type="button" onClick={() => setSelected(decision)} className="h-8 rounded-md bg-[#1f883d] px-3 text-xs font-semibold text-white hover:bg-[#1a7f37]">处理决策</button> : null}
      </div>)}</div>}
    </Panel>
    <Panel title="项目活动" action={<span className="text-xs text-[#57606a]">按发生时间排序</span>}>
      {view.timeline.length === 0 ? <EmptyState title="暂无项目活动" description="项目事件、决策和任务动态会汇总在这里。" /> : <ol className="divide-y divide-[#d8dee4]">{view.timeline.map((entry) => <li key={`${entry.kind}:${entry.id}`} className="flex gap-3 py-3 first:pt-0 last:pb-0">{entry.kind === "decision" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#1a7f37]" /> : entry.kind === "project_event" ? <GitCommitHorizontal className="mt-0.5 size-4 shrink-0 text-[#0969da]" /> : <Clock3 className="mt-0.5 size-4 shrink-0 text-[#57606a]" />}<div className="min-w-0 flex-1"><strong className="text-sm text-[#24292f]">{entry.title}</strong><p className="mt-1 text-sm text-[#57606a]">{entry.description}</p><p className="mt-1 text-xs text-[#8c959f]">{entry.taskTitle ? `${entry.taskTitle} · ` : ""}{entry.actorLabel} · {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(entry.occurredAt)}</p></div></li>)}</ol>}
    </Panel>
    {selected ? <ApprovalDecisionDialog open approval={selected} onClose={() => setSelected(null)} onDecided={({ approvalId, decision }) => setDecisions((items) => items.map((item) => item.id === approvalId ? { ...item, status: decision } : item))} /> : null}
  </div>;
}
