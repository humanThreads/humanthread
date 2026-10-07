"use client";

import {
  Ban,
  Check,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Info,
  Laptop,
  Pause,
  Play,
  RotateCcw,
  Server,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createTaskCommandId } from "../../../lib/tasks/task-command-id";

interface LoopRunSummary {
  id: string;
  status: string;
  statusReason?: string | null;
  currentIteration: number;
  stopReason: string | null;
  version: number;
}

interface LoopCandidate {
  bindingId: string;
  loopDefinitionId: string;
  loopVersionId: string;
  name: string;
  description: string | null;
  versionNumber: number;
  isDefault: boolean;
  ready: boolean;
  reason: string | null;
}

interface ExecutionOption {
  type: "local_agent" | "linux_worker_pool";
  id: string;
  displayName: string;
  ready: boolean;
  reason: string | null;
}

interface ExecutionOptionsResponse {
  ok?: boolean;
  loops?: LoopCandidate[];
  selectedBindingId?: string;
  options?: ExecutionOption[];
  defaultTarget?: ExecutionOption | null;
  error?: string;
}

const TERMINAL_LOOP_STATUSES = new Set(["cancelled", "completed", "failed", "exhausted"]);

export function TaskLoopLauncher({ taskId, canDispatch, loopRun }: {
  taskId: string;
  canDispatch: boolean;
  loopRun: LoopRunSummary | null;
}) {
  const router = useRouter();
  const requestSequence = useRef(0);
  const [loops, setLoops] = useState<LoopCandidate[]>([]);
  const [selectedBindingId, setSelectedBindingId] = useState("");
  const [executionOptions, setExecutionOptions] = useState<ExecutionOption[]>([]);
  const [executionTargetKey, setExecutionTargetKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [newLoopRunId, setNewLoopRunId] = useState<string | null>(null);
  const loopIsTerminal = loopRun ? TERMINAL_LOOP_STATUSES.has(loopRun.status)
    || (loopRun.status === "waiting" && loopRun.statusReason === "intervention:worker_execution_failed") : false;
  const canStartLoop = canDispatch && !newLoopRunId && (!loopRun || loopIsTerminal);
  const loopCanCancel = canDispatch && Boolean(loopRun) && !loopIsTerminal;
  const selectedLoop = loops.find((candidate) => candidate.bindingId === selectedBindingId) ?? null;
  const selectedTarget = executionOptions.find((option) => targetKey(option) === executionTargetKey) ?? null;

  const loadExecutionOptions = useCallback(async (bindingId?: string) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setMessage(null);
    try {
      const query = bindingId ? `?bindingId=${encodeURIComponent(bindingId)}` : "";
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/loop/execution-options${query}`, {
        headers: { accept: "application/json" },
      });
      const body = await response.json() as ExecutionOptionsResponse;
      if (!response.ok || !body.ok || !Array.isArray(body.loops) || !Array.isArray(body.options)) {
        throw new Error(body.error ?? "执行 Loop 暂不可用");
      }
      if (sequence !== requestSequence.current) return;
      setLoops(body.loops);
      setSelectedBindingId(body.selectedBindingId ?? bindingId ?? body.loops[0]?.bindingId ?? "");
      setExecutionOptions(body.options);
      setExecutionTargetKey(body.defaultTarget ? targetKey(body.defaultTarget) : "");
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setMessage(error instanceof Error ? error.message : "执行 Loop 暂不可用");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (!canStartLoop) return;
    const timer = window.setTimeout(() => void loadExecutionOptions(), 0);
    return () => window.clearTimeout(timer);
  }, [canStartLoop, loadExecutionOptions]);

  async function selectLoop(bindingId: string) {
    if (bindingId === selectedBindingId) return;
    setSelectedBindingId(bindingId);
    setExecutionOptions([]);
    setExecutionTargetKey("");
    await loadExecutionOptions(bindingId);
  }

  async function startLoop() {
    if (!selectedLoop || !selectedTarget?.ready) {
      setMessage(selectedTarget?.reason ?? "请选择可用的执行目标。");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/loop`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: "start",
          commandId: createTaskCommandId(),
          bindingId: selectedLoop.bindingId,
          executionTarget: selectedTarget.type === "linux_worker_pool"
            ? { type: selectedTarget.type, workerPoolId: selectedTarget.id }
            : { type: "local_agent", agentProfileId: selectedTarget.id },
        }),
      });
      const body = await response.json() as { ok?: boolean; result?: { id?: string }; error?: string };
      if (!response.ok || !body.ok || !body.result?.id) throw new Error(body.error ?? "Loop 操作失败");
      setNewLoopRunId(body.result.id);
      setMessage(`Loop 已启动。运行 ${body.result.id}`);
      router.push(`/loop-runs/${encodeURIComponent(body.result.id)}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Loop 操作失败");
    } finally {
      setPending(false);
    }
  }

  async function commandLoop(command: "pause" | "resume" | "cancel") {
    if (!loopRun) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/loop`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command, loopRunId: loopRun.id }),
      });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Loop 状态更新失败");
      setMessage("Loop 状态已更新。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Loop 状态更新失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <aside className="flex min-h-0 flex-col border-t border-[#d0d7de] bg-white xl:border-l xl:border-t-0" aria-label="Loop 启动设置">
      <header className="shrink-0 border-b border-[#d0d7de] px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Workflow aria-hidden="true" className="h-4 w-4 text-[#0969da]" />
              <h2 className="text-base font-semibold text-[#24292f]">{loopRun ? "任务 Loop" : "启动 Loop"}</h2>
            </div>
            <p className="mt-1 text-xs leading-5 text-[#57606a]">为本次执行冻结 Loop、执行目标和配置快照。</p>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${loopRun && !loopIsTerminal ? "border-[#2da44e33] bg-[#dafbe1] text-[#116329]" : "border-[#d0d7de] bg-[#f6f8fa] text-[#57606a]"}`}>
            {loopRun ? runStatusLabel(loopRun.status) : "未启动"}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 xl:overscroll-contain">
        {loopRun ? (
          <section className="mb-5 border-y border-[#d0d7de] bg-[#f6f8fa] px-3 py-3" aria-label="当前 Loop 运行">
            <div className="flex items-start gap-2">
              <Workflow aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#57606a]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#24292f]">运行 {loopRun.id}</p>
                <p className="mt-1 text-xs text-[#57606a]">状态 {runStatusLabel(loopRun.status)} · 迭代 {loopRun.currentIteration}</p>
                {loopRun.stopReason ? <p className="mt-1 text-xs text-[#cf222e]">{loopRun.stopReason}</p> : null}
              </div>
              <Link href={`/loop-runs/${encodeURIComponent(loopRun.id)}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[#d0d7de] bg-white text-[#57606a]" aria-label="查看 Loop 运行详情" title="查看 Loop 运行详情"><ExternalLink className="h-3.5 w-3.5" /></Link>
            </div>
            {canDispatch && !loopIsTerminal ? <div className="mt-3 flex flex-wrap gap-2">
              {loopRun.status === "running" ? <button type="button" disabled={pending} onClick={() => void commandLoop("pause")} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d0d7de] bg-white px-2 text-xs font-semibold"><Pause className="h-3.5 w-3.5" />暂停</button> : null}
              {loopRun.status === "paused" ? <button type="button" disabled={pending} onClick={() => void commandLoop("resume")} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d0d7de] bg-white px-2 text-xs font-semibold"><Play className="h-3.5 w-3.5" />继续</button> : null}
              {loopCanCancel ? <button type="button" disabled={pending} onClick={() => void commandLoop("cancel")} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#f1aeb5] bg-white px-2 text-xs font-semibold text-[#cf222e]"><Ban className="h-3.5 w-3.5" />取消 Loop</button> : null}
            </div> : null}
          </section>
        ) : null}

        {!canDispatch ? <div role="status" className="border border-[#d0d7de] bg-[#f6f8fa] px-3 py-3 text-sm text-[#57606a]">当前用户没有启动任务 Loop 的权限。</div> : null}
        {canDispatch && !canStartLoop ? <div className="border border-[#d0d7de] bg-[#f6f8fa] px-3 py-3 text-sm text-[#57606a]">当前运行结束后可重新选择 Loop。</div> : null}
        {canStartLoop && loading && loops.length === 0 ? <div role="status" className="grid gap-3" aria-label="正在加载 Loop 配置"><div className="h-20 animate-pulse rounded-md bg-[#f6f8fa] motion-reduce:animate-none" /><div className="h-32 animate-pulse rounded-md bg-[#f6f8fa] motion-reduce:animate-none" /></div> : null}

        {canStartLoop && loops.length > 0 ? <div className="grid gap-5">
          <fieldset className="grid gap-2">
            <legend className="mb-1 flex w-full items-center gap-2 text-sm font-semibold text-[#24292f]">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#24292f] text-xs text-white">1</span>
              选择执行 Loop
            </legend>
            <div className="divide-y divide-[#d8dee4] border-y border-[#d0d7de]">
              {loops.map((candidate) => {
                const checked = candidate.bindingId === selectedBindingId;
                return <label key={candidate.bindingId} className={`flex gap-3 px-3 py-3 transition-colors ${candidate.ready ? checked ? "cursor-pointer bg-[#ddf4ff]" : "cursor-pointer hover:bg-[#f6f8fa]" : "cursor-not-allowed bg-[#f6f8fa] opacity-70"}`}>
                  <input type="radio" name="task-loop" value={candidate.bindingId} checked={checked} disabled={!candidate.ready} onChange={() => void selectLoop(candidate.bindingId)} className="sr-only" />
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${checked ? "border-[#0969da] bg-[#0969da]" : "border-[#8c959f] bg-white"}`} aria-hidden="true">{checked ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-[#24292f]">{candidate.name}</span>{candidate.isDefault ? <span className="rounded-full border border-[#0969da33] bg-[#ddf4ff] px-1.5 py-0.5 text-xs font-semibold text-[#0a3069]">默认</span> : null}{!candidate.ready ? <span className="rounded-full border border-[#cf222e33] bg-[#ffebe9] px-1.5 py-0.5 text-xs font-semibold text-[#cf222e]">不可用</span> : null}</span>
                    {candidate.description ? <span className="mt-1 block text-xs leading-5 text-[#57606a]">{candidate.description}</span> : null}
                    <span className="mt-2 block text-xs text-[#6e7781]">版本 {candidate.versionNumber}</span>
                    {candidate.reason ? <span className="mt-2 flex items-center gap-1 text-xs font-medium text-[#cf222e]"><CircleAlert className="h-3.5 w-3.5" />{candidate.reason}</span> : null}
                  </span>
                </label>;
              })}
            </div>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-1 flex w-full items-center gap-2 text-sm font-semibold text-[#24292f]">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#24292f] text-xs text-white">2</span>
              选择执行目标
            </legend>
            {loading && executionOptions.length === 0 ? <div role="status" className="border-y border-[#d0d7de] px-3 py-8 text-center text-sm text-[#57606a]">正在读取执行目标...</div> : null}
            {executionOptions.length > 0 ? <div className="divide-y divide-[#d8dee4] border-y border-[#d0d7de]">{executionOptions.map((option) => {
              const checked = targetKey(option) === executionTargetKey;
              const TargetIcon = option.type === "linux_worker_pool" ? Server : Laptop;
              return <label key={targetKey(option)} className={`flex gap-3 px-3 py-3 transition-colors ${option.ready ? checked ? "cursor-pointer bg-[#dafbe1]" : "cursor-pointer hover:bg-[#f6f8fa]" : "cursor-not-allowed bg-[#f6f8fa] opacity-70"}`}>
                <input type="radio" name="execution-target" value={targetKey(option)} checked={checked} disabled={!option.ready} onChange={() => setExecutionTargetKey(targetKey(option))} className="sr-only" />
                <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${checked ? "border-[#1f883d] bg-[#1f883d]" : "border-[#8c959f] bg-white"}`} aria-hidden="true">{checked ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2"><TargetIcon className="h-4 w-4 shrink-0 text-[#57606a]" /><span className="text-sm font-semibold text-[#24292f]">{option.displayName}</span></span>
                  {option.reason ? <span className="mt-2 flex items-center gap-1 text-xs font-medium text-[#cf222e]"><CircleAlert className="h-3.5 w-3.5" />{option.reason}</span> : null}
                </span>
              </label>;
            })}</div> : null}
          </fieldset>

          <section className="grid gap-3" aria-labelledby="loop-preflight-title">
            <div className="flex items-center gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#24292f] text-xs text-white">3</span><h2 id="loop-preflight-title" className="text-sm font-semibold text-[#24292f]">启动前检查</h2></div>
            {selectedLoop && selectedTarget?.ready ? <div className="border border-[#2da44e33] bg-[#dafbe1] px-3 py-3 text-sm text-[#116329]" role="status">
              <div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-semibold">预检通过</p><p className="mt-1 text-xs leading-5">{selectedLoop.name} v{selectedLoop.versionNumber} · {selectedTarget.displayName}</p></div></div>
              <ul className="mt-3 grid gap-2 border-t border-[#2da44e26] pt-3 text-xs"><li className="flex items-center gap-2"><Check className="h-3.5 w-3.5" />Loop 版本已固定</li><li className="flex items-center gap-2"><Check className="h-3.5 w-3.5" />执行目标配置完整</li></ul>
            </div> : <div className="border border-[#d4a72c33] bg-[#fff8c5] px-3 py-3 text-xs leading-5 text-[#9a6700]">请选择可用的 Loop 和执行目标后再启动。</div>}
            <p className="flex items-start gap-2 text-xs leading-5 text-[#57606a]"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0969da]" />启动后会生成不可变运行快照；后续修改项目 Loop 配置不会影响本次运行。</p>
          </section>
        </div> : null}

        {canStartLoop && !loading && loops.length === 0 && !message ? <div className="border border-dashed border-[#d0d7de] px-3 py-8 text-center text-sm text-[#57606a]">当前项目没有可启动的任务 Loop。</div> : null}
        {message ? <div role={message.includes("已启动") || message.includes("已更新") ? "status" : "alert"} className={`mt-4 border px-3 py-2 text-xs ${message.includes("已启动") || message.includes("已更新") ? "border-[#2da44e33] bg-[#f0fff4] text-[#116329]" : "border-[#f1aeb5] bg-[#fff5f5] text-[#cf222e]"}`}>{message}</div> : null}
      </div>

      {canStartLoop ? <footer className="shrink-0 border-t border-[#d0d7de] bg-white px-4 py-3">
        {newLoopRunId ? <Link href={`/loop-runs/${encodeURIComponent(newLoopRunId)}`} className="mb-3 flex h-9 w-full items-center justify-center gap-2 rounded-md border border-[#d0d7de] text-sm font-semibold text-[#24292f]"><ExternalLink className="h-3.5 w-3.5" />进入 Loop 工作流</Link> : null}
        <button type="button" disabled={pending || loading || !selectedLoop || !selectedTarget?.ready} onClick={() => void startLoop()} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[#1f883d] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1a7f37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f883d] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#8c959f]">
          {pending ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none" aria-hidden="true" /> : loopRun ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {pending ? "正在创建运行..." : loopRun ? "重新启动 Loop" : "启动 Loop"}
        </button>
        {selectedLoop ? <p className="mt-2 text-center text-xs leading-5 text-[#6e7781]">本次使用 {selectedLoop.name} v{selectedLoop.versionNumber}</p> : null}
      </footer> : null}
    </aside>
  );
}

function targetKey(option: Pick<ExecutionOption, "type" | "id">): string {
  return `${option.type}:${option.id}`;
}

function runStatusLabel(status: string): string {
  return ({ pending: "待启动", running: "进行中", waiting: "等待中", paused: "已暂停", cancelled: "已中止", failed: "失败", exhausted: "失败", completed: "已完成" } as Record<string, string>)[status] ?? status;
}
