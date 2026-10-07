"use client";

import { Ban, Pause, Play, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { loopStatusReasonLabel } from "../../lib/orchestration/loop-status-reason";
import { StatusPill } from "./workbench-ui";

export interface LoopMonitorItem {
  id: string;
  taskId: string | null;
  taskTitle: string;
  loopName: string;
  scope: "project" | "task";
  parentLoopRunId: string | null;
  parentLoopName: string | null;
  waitingReason: string | null;
  status: string;
  currentIteration: number;
  maxIterations: number;
  attempt: number;
  lastHeartbeatAt: Date | null;
}

function commandForStatus(status: string): "start" | "pause" | "resume" | null {
  if (status === "created") return "start";
  if (status === "running") return "pause";
  if (status === "paused" || status === "waiting_approval") return "resume";
  return null;
}

export function LoopMonitor({ loops, canManage, embedded = false }: { loops: LoopMonitorItem[]; canManage: boolean; embedded?: boolean }) {
  const [items, setItems] = useState(() => loops.filter(isMonitorStatus));
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "status" | "alert"; text: string } | null>(null);

  async function execute(loop: LoopMonitorItem, command: "start" | "pause" | "resume" | "cancel") {
    if (pendingId) return;
    setPendingId(loop.id);
    setMessage(null);
    try {
      const endpoint = command === "start" && loop.taskId
        ? `/api/tasks/${encodeURIComponent(loop.taskId)}/loop`
        : `/api/loop-runs/${encodeURIComponent(loop.id)}/commands`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command, loopRunId: loop.id }),
      });
      const body = await response.json() as { error?: string; result?: { status: string } };
      if (!response.ok || !body.result) throw new Error(body.error ?? "Loop 操作失败");
      setItems((current) => current.map((item) => item.id === loop.id ? { ...item, status: body.result?.status ?? item.status } : item));
      setMessage({ tone: "status", text: "Loop 状态已更新" });
    } catch (cause) {
      setMessage({ tone: "alert", text: cause instanceof Error ? cause.message : "Loop 操作失败" });
    } finally {
      setPendingId(null);
    }
  }

  return <section className={embedded ? "overflow-hidden" : "overflow-hidden rounded-md border border-[#d0d7de] bg-white"}>
    {!embedded ? <header className="flex items-center gap-2 border-b border-[#d8dee4] px-4 py-3"><RefreshCw className="size-4" /><h2 className="text-sm font-semibold">Loop Monitor</h2><span className="ml-auto text-xs text-[#59636e]">{items.length} 可处理</span></header> : null}
    {message ? <p role={message.tone} className={message.tone === "alert" ? "border-b border-[#f1aeb5] bg-[#fff5f5] px-4 py-2 text-xs text-[#cf222e]" : "border-b border-[#7ee787] bg-[#dafbe1] px-4 py-2 text-xs text-[#116329]"}>{message.text}</p> : null}
    <div className="divide-y divide-[#d8dee4]">{items.map((loop) => {
      const command = commandForStatus(loop.status);
      const progress = loop.maxIterations > 0 ? Math.min(100, Math.round(loop.currentIteration / loop.maxIterations * 100)) : 0;
      const failureReason = loop.status === "failed" || loop.status === "exhausted" ? loopStatusReasonLabel(loop.waitingReason) : null;
      return <div key={loop.id} className="grid gap-3 px-4 py-3">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex min-w-0 flex-wrap items-center gap-2"><Link className="truncate text-sm font-medium text-[#0969da] hover:underline" href={`/loop-runs/${encodeURIComponent(loop.id)}`}>{loop.taskTitle}</Link><span className="shrink-0 rounded-full border border-[#d0d7de] bg-[#f6f8fa] px-2 py-0.5 text-xs font-medium text-[#57606a]">{loop.scope === "project" ? "项目级" : "任务级"}</span></div><p className="mt-1 text-xs text-[#57606a]">{loop.loopName}{loop.parentLoopRunId ? ` · 父 Loop：${loop.parentLoopName ?? loop.parentLoopRunId}` : ""}</p>{failureReason ? <p className="mt-1 text-xs font-medium text-[#cf222e]">失败：{failureReason}</p> : null}<p className="mt-1 text-xs text-[#59636e]">{loop.waitingReason === "child_loop" ? "等待任务级 Loop · " : ""}Attempt {loop.attempt} · {loop.lastHeartbeatAt ? `心跳 ${loop.lastHeartbeatAt.toLocaleString("zh-CN")}` : "等待心跳"}</p></div><StatusPill tone={loop.status === "failed" || loop.status === "exhausted" ? "danger" : loop.status === "running" ? "blue" : loop.status === "waiting_approval" ? "warning" : "default"}>{loop.status}</StatusPill></div>
        <div><div className="mb-1 flex justify-between text-xs text-[#59636e]"><span>迭代预算</span><span>{loop.currentIteration} / {loop.maxIterations}</span></div><div className="h-2 overflow-hidden rounded bg-[#eaeef2]" aria-label={`迭代预算 ${loop.currentIteration} / ${loop.maxIterations}`}><div className="h-full bg-[#2f81f7]" style={{ width: `${progress}%` }} /></div></div>
        {canManage ? <div className="flex justify-end gap-2">{command ? <button type="button" disabled={pendingId === loop.id} onClick={() => void execute(loop, command)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d0d7de] px-3 text-xs font-semibold disabled:opacity-50">{command === "pause" ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}{command === "start" ? "启动" : command === "pause" ? "暂停" : "恢复"}</button> : null}{!["cancelled", "completed", "exhausted", "failed"].includes(loop.status) ? <button type="button" disabled={pendingId === loop.id} onClick={() => void execute(loop, "cancel")} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#f1aeb5] px-3 text-xs font-semibold text-[#cf222e] disabled:opacity-50"><Ban className="size-3.5" />取消 Loop</button> : null}</div> : null}
      </div>;
    })}</div>
    {items.length === 0 ? <p className="px-4 py-8 text-center text-sm text-[#59636e]">暂无 Loop 运行</p> : null}
  </section>;
}

function isMonitorStatus(loop: LoopMonitorItem): boolean {
  return ["created", "running", "paused", "waiting_approval", "waiting"].includes(loop.status);
}
