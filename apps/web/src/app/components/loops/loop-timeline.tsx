"use client";

import { Clock3, Download, MessageSquare, Search, ShieldCheck, Workflow } from "lucide-react";

export interface LoopTimelineItemInput {
  id: string;
  kind: string;
  occurredAt: string;
  summary: string;
  actorType?: string;
  actorId?: string;
  status?: string | null;
  [key: string]: unknown;
}

export function LoopTimeline(props: {
  items: LoopTimelineItemInput[];
  currentInteraction: { id?: string; status?: string } | null;
  query?: string;
  onQueryChange?: (query: string) => void;
  onExport?: (format: "json" | "markdown") => void;
}) {
  return (
    <section aria-label="工作流时间线" className="min-w-0 bg-white">
      <div className="flex items-center justify-between border-b border-[#d0d7de] px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock3 aria-hidden="true" className="h-4 w-4 text-[#57606a]" />
          <h2 className="text-sm font-semibold text-[#24292f]">工作流时间线</h2>
        </div>
        <span className="text-xs tabular-nums text-[#57606a]">{props.items.length} 条</span>
      </div>
      {props.onQueryChange || props.onExport ? <div className="flex flex-wrap gap-2 border-b border-[#d0d7de] px-4 py-2"><label className="relative min-w-0 flex-1"><Search aria-hidden="true" className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-[#6e7781]" /><input aria-label="搜索工作流记录" value={props.query ?? ""} onChange={(event) => props.onQueryChange?.(event.currentTarget.value)} placeholder="搜索记录" className="w-full rounded-md border border-[#d0d7de] py-1.5 pl-8 pr-2 text-xs text-[#24292f]" /></label>{props.onExport ? <button type="button" aria-label="导出工作流记录" onClick={() => props.onExport?.("json")} className="inline-flex items-center gap-1 rounded-md border border-[#d0d7de] px-2 py-1.5 text-xs font-semibold text-[#24292f]"><Download aria-hidden="true" className="h-3.5 w-3.5" />导出</button> : null}</div> : null}
      {props.currentInteraction?.status === "open" ? (
        <div className="border-b border-[#d0d7de] bg-[#fff8c5] px-4 py-3 text-xs text-[#7d4e00]">
          <div className="flex items-center gap-2 font-semibold"><MessageSquare aria-hidden="true" className="h-4 w-4" />等待需求确认</div>
          <div className="mt-1">沟通已暂停当前节点，确认后继续执行。</div>
        </div>
      ) : null}
      {props.items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[#57606a]">暂无工作流记录。</p>
      ) : (
        <ol className="divide-y divide-[#d8dee4]">
          {props.items.map((item) => <TimelineItem key={item.id} item={item} />)}
        </ol>
      )}
    </section>
  );
}

function TimelineItem({ item }: { item: LoopTimelineItemInput }) {
  const Icon = item.kind.includes("approval") || item.kind.includes("decision") ? ShieldCheck : item.kind.includes("message") ? MessageSquare : Workflow;
  return (
    <li data-testid="timeline-item" className="flex gap-3 px-4 py-3 text-xs">
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#57606a]" />
      <div className="min-w-0">
        <div className="break-words font-medium text-[#24292f]">{item.summary}</div>
        <div className="mt-1 text-[#6e7781]">{item.actorType ? `${item.actorType}:${item.actorId ?? ""} · ` : ""}{formatTime(item.occurredAt)}{item.status ? ` · ${item.status}` : ""}</div>
      </div>
    </li>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
