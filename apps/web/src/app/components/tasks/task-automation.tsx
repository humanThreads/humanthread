"use client";

import { Ban, Bot, ChevronDown, ChevronRight, ExternalLink, Pause, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoopRunSummary } from "../loops/loop-run-summary";
import { createTaskCommandId } from "../../../lib/tasks/task-command-id";

interface AgentProfileOption { id: string; name: string; provider: string; status: string }
interface AgentRunSummary { id: string; status: string; createdAt: Date | string; agentProfile: { id: string; name: string; provider: string } }
interface LoopRunSummary { id: string; status: string; statusReason?: string | null; currentIteration: number; stopReason: string | null; version: number }
interface ExecutionOption { type: "local_agent" | "linux_worker_pool"; id: string; displayName: string; ready: boolean; reason: string | null }
const TERMINAL_LOOP_STATUSES = new Set(["cancelled", "completed", "failed", "exhausted"]);

export function TaskAutomation({ taskId, version, canDispatch, agentProfiles, agentRun, loopRun, onVersionChange }: {
  taskId: string; version: number; canDispatch: boolean; agentProfiles: readonly AgentProfileOption[];
  agentRun: AgentRunSummary | null; loopRun: LoopRunSummary | null; onVersionChange(version: number): void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [agentProfileId, setAgentProfileId] = useState(agentProfiles.find((profile) => profile.status === "active")?.id ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [newLoopRunId, setNewLoopRunId] = useState<string | null>(null);
  const [executionOptions, setExecutionOptions] = useState<ExecutionOption[]>([]);
  const [executionTargetKey, setExecutionTargetKey] = useState("");
  const loopIsTerminal = loopRun ? TERMINAL_LOOP_STATUSES.has(loopRun.status)
    || (loopRun.status === "waiting" && loopRun.statusReason === "intervention:worker_execution_failed") : false;
  const loopCanCancel = canDispatch && Boolean(loopRun) && !loopIsTerminal;
  const canStartLoop = canDispatch && !newLoopRunId && (!loopRun || loopIsTerminal);
  const summary = agentRun
    ? `${agentRun.agentProfile.name} ${agentRun.status === "running" ? "执行中" : agentRun.status === "completed" ? "已提交候选结果" : agentRun.status === "failed" ? "执行失败" : agentRun.status}`
    : loopRun?.status === "paused" ? "Loop 已暂停"
      : loopRun?.status === "cancelled" ? "Loop 已取消"
        : loopRun?.status === "completed" ? "Loop 已完成"
          : loopRun?.status === "failed" ? "Loop 执行失败"
            : loopRun ? `Loop ${loopRun.status}` : "未自动化";

  async function dispatch() {
    if (!agentProfileId) return;
    setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/commands/dispatch_agent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: createTaskCommandId(), expectedVersion: version, agentProfileId }) });
      const body = await response.json() as { ok: boolean; result?: { version: number }; error?: string };
      if (!response.ok || !body.ok || !body.result) throw new Error(body.error ?? "Agent 派发失败");
      onVersionChange(body.result.version); setMessage("已创建候选执行，任务完成仍需验收。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Agent 派发失败"); }
    finally { setPending(false); }
  }

  async function loadExecutionOptions() {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/loop/execution-options`, { headers: { accept: "application/json" } });
    const body = await response.json() as { ok?: boolean; options?: ExecutionOption[]; defaultTarget?: ExecutionOption | null; error?: string };
    if (!response.ok || !body.ok || !Array.isArray(body.options)) throw new Error(body.error ?? "执行目标暂不可用");
    setExecutionOptions(body.options);
    setExecutionTargetKey((current) => current || (body.defaultTarget ? targetKey(body.defaultTarget) : ""));
  }

  async function loopCommand(command: "pause" | "resume" | "start") {
    if (!loopRun && command !== "start") return;
    if (command === "start" && executionOptions.length === 0) {
      try { await loadExecutionOptions(); setOpen(true); } catch (error) { setMessage(error instanceof Error ? `Loop 操作失败：${error.message}` : "执行目标暂不可用"); }
      return;
    }
    const selectedTarget = executionOptions.find((option) => targetKey(option) === executionTargetKey) ?? null;
    if (command === "start" && (!selectedTarget || !selectedTarget.ready)) {
      setOpen(true); setMessage(selectedTarget?.reason ?? "请选择可用的执行目标。"); return;
    }
    setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/loop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command, ...(loopRun && command !== "start" ? { loopRunId: loopRun.id } : {}), ...(command === "start" ? { commandId: createTaskCommandId(), executionTarget: selectedTarget?.type === "linux_worker_pool" ? { type: selectedTarget.type, workerPoolId: selectedTarget.id } : { type: "local_agent", agentProfileId: selectedTarget?.id } } : {}) }) });
      const body = await response.json() as { ok: boolean; result?: { id?: string }; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Loop 操作失败");
      if (command === "start" && body.result?.id) {
        setNewLoopRunId(body.result.id);
        setOpen(true);
        router.push(`/loop-runs/${encodeURIComponent(body.result.id)}`);
        router.refresh();
      }
      setMessage(command === "start" ? "任务 Loop 已启动。" : "Loop 状态已更新。");
    } catch (error) {
      setOpen(true);
      setMessage(error instanceof Error ? `Loop 操作失败：${error.message}` : "Loop 操作失败");
    }
    finally { setPending(false); }
  }

  async function cancelLoop() {
    if (!loopRun) return;
    setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/loop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "cancel", loopRunId: loopRun.id }) });
      const body = await response.json() as { ok: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Loop 取消失败");
      setMessage("Loop 已取消，可以重新启动。");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? `Loop 操作失败：${error.message}` : "Loop 取消失败"); }
    finally { setPending(false); }
  }

  return <section className="border-t border-[#d0d7de] bg-white">
    <div className="flex min-w-0 items-center">
      <button type="button" aria-label={open ? "收起自动化详情" : "展开自动化详情"} onClick={() => setOpen((value) => !value)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-4 text-left text-sm font-semibold"><Bot size={15} className="shrink-0 text-[#57606a]" /><span className="min-w-0 truncate">{summary}</span><span className="ml-auto shrink-0 text-[#8c959f]">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span></button>
      {canStartLoop ? <button type="button" aria-label={loopRun ? "重新启动任务 Loop" : "启动任务 Loop"} title={loopRun ? "重新启动任务 Loop" : "启动任务 Loop"} disabled={pending} onClick={() => void loopCommand("start")} className="mr-3 inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-[#d0d7de] bg-white px-2 text-xs font-semibold text-[#24292f]">{loopRun ? <RotateCcw size={13} /> : <Play size={13} />}<span>{loopRun ? "重新启动" : "启动"}</span></button> : null}
    </div>
    {open ? <div className="grid gap-3 border-t border-[#d8dee4] bg-[#f6f8fa] p-4 text-sm">
      {agentRun && !loopRun ? <div className="flex items-center justify-between"><span>{agentRun.agentProfile.name} · {agentRun.status}</span><Link aria-label="查看运行详情" title="查看运行详情" href={`/agents?runId=${agentRun.id}`} className="grid h-8 w-8 place-items-center rounded-md border border-[#d0d7de] bg-white"><ExternalLink size={14} /></Link></div> : null}
      {loopRun ? <div className="grid gap-2"><LoopRunSummary loopRun={{ id: loopRun.id, status: loopRun.status }} /><div className="flex flex-wrap items-center gap-2"><span className="mr-auto text-xs text-[#57606a]">Loop 迭代 {loopRun.currentIteration}</span>{canDispatch && loopRun.status === "running" ? <button disabled={pending} onClick={() => void loopCommand("pause")} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d0d7de] bg-white px-2"><Pause size={13} />暂停</button> : null}{canDispatch && loopRun.status === "paused" ? <button disabled={pending} onClick={() => void loopCommand("resume")} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d0d7de] bg-white px-2"><Play size={13} />继续</button> : null}{loopCanCancel ? <button disabled={pending} onClick={() => void cancelLoop()} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#f1aeb5] bg-white px-2 text-[#cf222e]"><Ban size={13} />取消 Loop</button> : null}</div></div> : null}
      {newLoopRunId ? <Link href={`/loop-runs/${encodeURIComponent(newLoopRunId)}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d0d7de] bg-white px-2 text-xs font-semibold text-[#24292f]"><ExternalLink size={13} />进入 Loop 工作流</Link> : null}
      {canStartLoop && executionOptions.length > 0 ? <div className="grid gap-2"><label className="text-xs font-semibold text-[#57606a]" htmlFor="loop-execution-target">执行目标</label><select id="loop-execution-target" aria-label="Loop 执行目标" value={executionTargetKey} onChange={(event) => setExecutionTargetKey(event.target.value)} className="h-9 rounded-md border border-[#d0d7de] bg-white px-2">{executionOptions.map((option) => <option key={targetKey(option)} value={targetKey(option)} disabled={!option.ready}>{option.displayName}{option.ready ? "" : `（${option.reason ?? "不可用"}）`}</option>)}</select></div> : null}
      {canStartLoop && executionOptions.length === 0 ? <button type="button" disabled={pending} onClick={() => void loadExecutionOptions().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "执行目标暂不可用"))} className="w-fit text-xs font-semibold text-[#0969da]">选择执行目标</button> : null}
      {canDispatch && !loopRun && agentProfiles.length ? <div className="flex flex-wrap items-center gap-2"><select aria-label="执行 Agent" value={agentProfileId} onChange={(event) => setAgentProfileId(event.target.value)} className="h-9 min-w-44 rounded-md border border-[#d0d7de] bg-white px-2"><option value="">选择 Agent</option>{agentProfiles.filter((profile) => profile.status === "active").map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.provider}</option>)}</select><button disabled={pending || !agentProfileId} onClick={() => void dispatch()} className="h-9 rounded-md bg-[#1f883d] px-3 font-semibold text-white">交给 Agent</button></div> : null}
      {message ? <div role={message.includes("失败") ? "alert" : "status"} className="text-xs text-[#57606a]">{message}</div> : null}
    </div> : null}
  </section>;
}

function targetKey(option: Pick<ExecutionOption, "type" | "id">): string {
  return `${option.type}:${option.id}`;
}
