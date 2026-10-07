"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { CheckCircle2, CircleAlert, Play, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export interface MilestoneLoopOption {
  type: "local_agent" | "linux_worker_pool";
  id: string;
  displayName: string;
  ready: boolean;
  reason: string | null;
}

interface MilestoneLoopTask {
  id: string;
  title: string;
  eligible: boolean;
  reason: string | null;
}

interface MilestoneLoopResult {
  taskId: string;
  status: string;
  reason?: string;
  loopRunId?: string;
}

interface MilestoneLoopOptionsBody {
  ok?: boolean;
  error?: string;
  tasks?: MilestoneLoopTask[];
  options?: MilestoneLoopOption[];
  defaultTarget?: MilestoneLoopOption | null;
}

interface MilestoneLoopRunBody {
  ok?: boolean;
  error?: string;
  result?: { started: number; skipped: number; failed: number; results: MilestoneLoopResult[] };
}

function targetKey(option: Pick<MilestoneLoopOption, "type" | "id">): string {
  return `${option.type}:${option.id}`;
}

function executionTargetBody(option: MilestoneLoopOption) {
  return option.type === "linux_worker_pool"
    ? { type: option.type, workerPoolId: option.id }
    : { type: option.type, agentProfileId: option.id };
}

export function MilestoneLoopButton({ milestoneId, milestoneName, className, iconSize = 14 }: {
  milestoneId: string;
  milestoneName: string;
  className?: string;
  iconSize?: number;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<MilestoneLoopTask[]>([]);
  const [options, setOptions] = useState<MilestoneLoopOption[]>([]);
  const [targetKeyValue, setTargetKeyValue] = useState("");
  const [pending, setPending] = useState(false);
  const [started, setStarted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState<MilestoneLoopResult[]>([]);
  const eligibleTasks = tasks.filter((task) => task.eligible);
  const skippedTasks = tasks.filter((task) => !task.eligible);
  const selectedTarget = options.find((option) => targetKey(option) === targetKeyValue) ?? null;
  const resultFailed = results.some((result) => result.status === "failed");
  const startDisabled = pending || loading || Boolean(loadError) || !selectedTarget?.ready || eligibleTasks.length === 0;
  const startLabel = pending
    ? "启动中…"
    : selectedTarget?.ready && eligibleTasks.length > 0 ? `启动 ${eligibleTasks.length} 个任务` : "暂无可启动目标";

  async function loadOptions() {
    setLoading(true);
    setLoadError(null);
    setMessage(null);
    setStarted(false);
    setResults([]);
    try {
      const response = await fetch(`/api/milestones/${encodeURIComponent(milestoneId)}/loop/options`, { headers: { accept: "application/json" } });
      const body = await response.json() as MilestoneLoopOptionsBody;
      if (!response.ok || !body.ok || !Array.isArray(body.tasks) || !Array.isArray(body.options)) {
        throw new Error(body.error ?? "启动条件加载失败");
      }
      setTasks(body.tasks);
      setOptions(body.options);
      const defaultTarget = body.defaultTarget ?? body.options.find((option) => option.ready) ?? body.options[0] ?? null;
      setTargetKeyValue(defaultTarget ? targetKey(defaultTarget) : "");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "启动条件加载失败");
    } finally {
      setLoading(false);
    }
  }

  function openDialog() {
    setOpen(true);
    setTasks([]);
    setOptions([]);
    setTargetKeyValue("");
    setMessage(null);
    setStarted(false);
    setResults([]);
    setLoadError(null);
    void loadOptions();
  }

  async function runBatch() {
    if (pending || !selectedTarget?.ready) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/milestones/${encodeURIComponent(milestoneId)}/loop`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: `milestone-loop-${milestoneId}`,
          executionTarget: executionTargetBody(selectedTarget),
        }),
      });
      const body = await response.json() as MilestoneLoopRunBody;
      if (!response.ok || !body.ok || !body.result) throw new Error(body.error ?? "里程碑 Loop 启动失败");
      setResults(body.result.results);
      setMessage(`已启动 ${body.result.started} 个，跳过 ${body.result.skipped} 个，失败 ${body.result.failed} 个`);
      setStarted(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "里程碑 Loop 启动失败");
    } finally {
      setPending(false);
    }
  }

  return <>
    <button type="button" aria-label="运行里程碑任务 Loop" title="运行里程碑任务 Loop" onClick={openDialog} className={className}><Play size={iconSize} /></button>
    <Dialog.Root open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#1f2328]/45 motion-safe:animate-[loop-overlay-in_140ms_ease-out]" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto border border-[#d0d7de] bg-white shadow-[0_24px_60px_rgba(31,35,40,0.24)] outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(94vw,620px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg motion-safe:animate-[loop-dialog-in_180ms_ease-out]">
          <div className="flex items-start gap-3 border-b border-[#d0d7de] px-5 py-4">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-[#ddf4ff] text-[#0550ae]"><Play size={18} /></div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold">启动里程碑任务 Loop</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-[#57606a]">{milestoneName} · 先补齐启动条件，再按任务逐项启动</Dialog.Description>
            </div>
            <Dialog.Close disabled={pending} className="grid h-8 w-8 place-items-center rounded-md text-[#57606a] hover:bg-[#f6f8fa]" aria-label="关闭启动弹窗"><X size={17} /></Dialog.Close>
          </div>
          <div className="grid gap-4 px-5 py-5">
            {loading ? <div role="status" className="flex items-center gap-2 text-sm text-[#57606a]"><span className="h-2 w-2 motion-safe:animate-ping rounded-full bg-[#0969da]" />正在检查启动条件…</div> : null}
            {loadError ? <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-sm text-[#cf222e]"><span className="mr-auto">{loadError}</span><button type="button" onClick={() => void loadOptions()} className="inline-flex h-8 items-center gap-2 rounded-md border border-[#cf222e] px-3 font-semibold"><RefreshCw size={14} />重新加载</button></div> : null}
            {!loading && !loadError ? <>
              <div className="rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-3 py-2">
                <p className="text-sm font-semibold">将启动 {eligibleTasks.length} 个任务，跳过 {skippedTasks.length} 个</p>
                {skippedTasks.length > 0 ? <ul className="mt-1 grid gap-0.5 text-xs text-[#57606a]">{skippedTasks.map((task) => <li key={task.id} className="min-w-0 break-words">{task.title} · {task.reason}</li>)}</ul> : null}
              </div>
              {options.length === 0 ? <div className="rounded-md border border-dashed border-[#d0d7de] px-3 py-3 text-sm"><p className="font-semibold">尚未配置可用的执行目标</p><p className="mt-1 text-xs text-[#57606a]">请先在项目设置中为任务开发 Loop 配置 Worker 节点模型，或允许至少一个本地 Agent。</p></div> : <label className="grid gap-1.5 text-sm font-semibold">执行目标<select aria-label="执行目标" value={targetKeyValue} onChange={(event) => setTargetKeyValue(event.target.value)} className="h-9 rounded-md border border-[#8c959f] bg-white px-2 text-sm font-normal outline-none focus:border-[#0969da] focus:ring-2 focus:ring-[#0969da]/10">{options.map((option) => <option key={targetKey(option)} value={targetKey(option)} disabled={!option.ready}>{option.displayName}{option.ready ? "" : `（${option.reason ?? "不可用"}）`}</option>)}</select>{selectedTarget ? <span className="text-xs font-normal text-[#57606a]">{selectedTarget.ready ? "启动后将按该目标执行本里程碑的可开发任务。" : selectedTarget.reason}</span> : null}</label>}
              {message ? <div role={resultFailed ? "alert" : "status"} className={`rounded-md border px-3 py-2 text-sm ${resultFailed ? "border-[#f1aeb5] bg-[#fff5f5] text-[#cf222e]" : "border-[#b7e3c1] bg-[#f0fff4] text-[#1a7f37]"}`}>{message}</div> : null}
              {results.length > 0 ? <div className="grid gap-1" aria-label="里程碑任务运行结果">{results.map((result) => <div key={result.taskId} className="flex flex-wrap items-center gap-2 text-xs motion-safe:animate-[loop-result-in_180ms_ease-out]"><span className={result.status === "started" ? "text-[#1a7f37]" : result.status === "failed" ? "text-[#cf222e]" : "text-[#9a6700]"}>{result.status === "started" ? <CheckCircle2 size={13} className="inline" /> : result.status === "failed" ? <CircleAlert size={13} className="inline" /> : null} {result.status === "started" ? "已启动" : result.status === "failed" ? "失败" : "已跳过"}</span><span className="min-w-0 break-all text-[#57606a]">{result.taskId}</span>{result.reason ? <span className="text-[#57606a]">{result.reason}</span> : null}{result.loopRunId ? <Link href={`/loop-runs/${encodeURIComponent(result.loopRunId)}`} className="font-semibold text-[#0969da] hover:underline">查看运行记录</Link> : null}</div>)}</div> : null}
            </> : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-[#d0d7de] bg-[#fbfcfd] px-5 py-3">
            {started ? <Dialog.Close disabled={pending} className="h-9 rounded-md bg-[#1f883d] px-4 text-sm font-semibold text-white disabled:opacity-50">完成</Dialog.Close> : <>
              <Dialog.Close disabled={pending} className="h-9 rounded-md border border-[#d0d7de] bg-white px-3 text-sm font-semibold disabled:opacity-50">取消</Dialog.Close>
              <button type="button" disabled={startDisabled} onClick={() => void runBatch()} className="h-9 rounded-md bg-[#1f883d] px-4 text-sm font-semibold text-white disabled:opacity-50">{startLabel}</button>
            </>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}
