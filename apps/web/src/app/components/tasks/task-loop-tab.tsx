"use client";

import type { WorkflowInteractionField, WorkflowInteractionView } from "@humanthread/shared";
import type { LoopRunProjection } from "../../../lib/orchestration/loop-read-model";
import { Ban, CheckCircle2, CircleAlert, Clock3, Pause, Play, RefreshCw, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkflowApprovalControls } from "../loops/workflow-approval-controls";
import { WorkflowInteractionComposer } from "../loops/workflow-interaction-composer";
import { WorkflowInteractionThread } from "../loops/workflow-interaction-thread";
import { TaskAutomation } from "./task-automation";
import { createTaskCommandId } from "../../../lib/tasks/task-command-id";

type TaskLoopRun = {
  id: string;
  status: string;
  statusReason?: string | null;
  currentIteration: number;
  stopReason: string | null;
  version: number;
  progress?: { completed: number; total: number; percent?: number };
  pendingInteraction?: { id: string; kind: string; status: string } | null;
};

type TaskLoopTabProps = {
  taskId: string;
  version: number;
  canDispatch: boolean;
  showAutomation?: boolean;
  agentProfiles: readonly { id: string; name: string; provider: string; status: string }[];
  agentRun: { id: string; status: string; createdAt: Date | string; agentProfile: { id: string; name: string; provider: string } } | null;
  loopRun: TaskLoopRun | null;
  onVersionChange(version: number): void;
};

type InteractionCapabilities = {
  canReply?: boolean;
  canConfirm?: boolean;
  canDecideApproval?: boolean;
};

export function TaskLoopTab({ taskId, version, canDispatch, showAutomation = true, agentProfiles, agentRun, loopRun, onVersionChange }: TaskLoopTabProps) {
  const [projection, setProjection] = useState<LoopRunProjection | null>(null);
  const [interaction, setInteraction] = useState<WorkflowInteractionView | null>(null);
  const [globalCapabilities, setGlobalCapabilities] = useState<InteractionCapabilities>({});
  const [loading, setLoading] = useState(Boolean(loopRun));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!loopRun) {
      setProjection(null);
      setInteraction(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [projectionResponse, interactionsResponse] = await Promise.all([
        fetch(`/api/loop-runs/${encodeURIComponent(loopRun.id)}`, { headers: { accept: "application/json" } }),
        fetch(`/api/loop-runs/${encodeURIComponent(loopRun.id)}/interactions`, { headers: { accept: "application/json" } }),
      ]);
      if (!projectionResponse.ok || !interactionsResponse.ok) throw new Error("Loop 运行详情暂不可用");
      const projectionBody = await projectionResponse.json() as { result?: LoopRunProjection };
      const interactionBody = await interactionsResponse.json() as { interactions?: WorkflowInteractionView[]; capabilities?: InteractionCapabilities };
      const interactions = Array.isArray(interactionBody.interactions) ? interactionBody.interactions : [];
      setProjection(projectionBody.result ?? null);
      setInteraction(interactions.find((item) => item.status === "open") ?? interactions.at(-1) ?? null);
      setGlobalCapabilities(interactionBody.capabilities ?? {});
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Loop 运行详情暂不可用");
    } finally {
      setLoading(false);
    }
  }, [loopRun]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    if (!loopRun) return () => window.clearTimeout(initialLoad);
    const timer = window.setInterval(() => void load(), 10_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [load, loopRun]);

  const mutateInteraction = useCallback(async (path: string, body: Record<string, unknown>) => {
    if (!loopRun || !interaction) return;
    const response = await fetch(`/api/loop-runs/${encodeURIComponent(loopRun.id)}/interactions/${encodeURIComponent(interaction.id)}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || result.ok !== true) throw new Error(result.error ?? "交互更新失败");
    await load();
  }, [interaction, load, loopRun]);

  const progress = useMemo(() => {
    if (projection) {
      const total = projection.nodes.length;
      const completed = projection.nodes.filter((node) => ["completed", "succeeded", "skipped"].includes(node.status)).length;
      return { completed, total, percent: total > 0 ? Math.round((completed / total) * 100) : projection.run.status === "completed" ? 100 : 0 };
    }
    return loopRun?.progress ?? { completed: 0, total: 0, percent: 0 };
  }, [loopRun, projection]);

  const selectedRecoveryNodeKey = projection?.nodes.find((node) => ["failed", "blocked"].includes(node.status))?.nodeKey
    ?? projection?.nodes.find((node) => !["completed", "succeeded", "skipped"].includes(node.status))?.nodeKey
    ?? "start";

  const fields = interactionFields(interaction);
  const interactionCapabilities = interaction?.capabilities;
  const actionForApi = (action: "resume_checkpoint" | "route_upstream" | "terminate") => action === "route_upstream"
    ? { type: action, targetNodeKey: selectedRecoveryNodeKey }
    : { type: action };

  return <div className="grid gap-4 p-4" aria-label="任务 Loop 工作区">
    {showAutomation ? <TaskAutomation
      taskId={taskId}
      version={version}
      canDispatch={canDispatch}
      agentProfiles={agentProfiles}
      agentRun={agentRun}
      loopRun={loopRun}
      onVersionChange={onVersionChange}
    /> : null}
    {!loopRun ? <div className="border border-dashed border-[#d0d7de] px-4 py-8 text-center text-sm text-[#57606a]">尚未启动 Loop，启动后可在这里查看运行进度、开放讨论和人工介入。</div> : null}
    {loopRun ? <>
      <section className="border border-[#d0d7de] bg-white p-4" aria-label="Loop 运行进度">
        <div className="flex items-center gap-2"><Workflow aria-hidden="true" className="h-4 w-4 text-[#57606a]" /><h2 className="text-sm font-semibold text-[#24292f]">Loop 运行进度</h2><RunStatusIcon status={projection?.run.status ?? loopRun.status} /></div>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[#57606a]"><span>{progress.completed}/{progress.total || "-"} 节点完成</span><span className="font-semibold tabular-nums text-[#24292f]">{progress.percent}%</span></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#d8dee4]" role="progressbar" aria-label={`Loop 运行进度 ${progress.percent}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><div className="h-full rounded-full bg-[#0969da] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${progress.percent}%` }} /></div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[#57606a]"><span>运行 {loopRun.id}</span><span>迭代 {loopRun.currentIteration}</span>{loopRun.stopReason ? <span className="text-[#cf222e]">{loopRun.stopReason}</span> : null}<button type="button" onClick={() => void load()} className="ml-auto inline-flex items-center gap-1 rounded-md border border-[#d0d7de] px-2 py-1 font-semibold text-[#24292f]"><RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />刷新</button></div>
      </section>
      {loading && !interaction ? <div className="text-sm text-[#57606a]" role="status">正在加载 Loop 交互...</div> : null}
      {error ? <div className="border border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-sm text-[#cf222e]" role="alert">{error}</div> : null}
      {interaction ? <section className="border border-[#d0d7de] bg-white" aria-label="Loop 开放讨论与人工介入"><WorkflowInteractionThread interaction={interaction} /><WorkflowInteractionComposer interaction={interaction} fields={fields} enabled={interactionCapabilities?.canReply === true} onSubmit={(message) => mutateInteraction("/messages", { commandId: createTaskCommandId(), message })} /><WorkflowApprovalControls interaction={interaction} canConfirm={globalCapabilities.canConfirm === true} canDecideApproval={globalCapabilities.canDecideApproval === true} onConfirm={(reason) => mutateInteraction("/confirm", { commandId: createTaskCommandId(), expectedVersion: interaction.version, reason })} onDecide={(decision, reason, selectedEdgeId) => mutateInteraction("/decision", { commandId: createTaskCommandId(), expectedVersion: interaction.version, decision, reason, selectedEdgeId })} onConfirmPosition={() => mutateInteraction("/speaker-confirmation", { commandId: createTaskCommandId() })} onSubmitIntervention={(action, reason, manualConflict) => mutateInteraction("/submit", { commandId: createTaskCommandId(), expectedVersion: interaction.version, action: actionForApi(action), reason, manualConflict })} onDelegateConflictSpeaker={(speakerUserId) => mutateInteraction("/conflict-speaker", { commandId: createTaskCommandId(), expectedVersion: interaction.version, speakerUserId })} /></section> : <div className="border border-dashed border-[#d0d7de] px-4 py-8 text-center text-sm text-[#57606a]">当前没有开放讨论或人工介入。</div>}
    </> : null}
  </div>;
}

function RunStatusIcon({ status }: { status: string }) {
  const Icon = status === "running" ? Play : status === "paused" ? Pause : status === "cancelled" ? Ban : status === "failed" || status === "exhausted" ? CircleAlert : status === "completed" ? CheckCircle2 : Clock3;
  return <Icon aria-label={`Loop 状态：${runStatusLabel(status)}`} className="ml-auto h-4 w-4 text-[#57606a]" />;
}

function runStatusLabel(status: string) {
  return ({ pending: "待启动", running: "进行中", waiting: "等待中", paused: "已暂停", cancelled: "已中止", failed: "失败", exhausted: "失败", completed: "已完成" } as Record<string, string>)[status] ?? status;
}

function interactionFields(interaction: WorkflowInteractionView | null): WorkflowInteractionField[] {
  const policy = interaction?.policySnapshot && typeof interaction.policySnapshot === "object" ? interaction.policySnapshot as Record<string, unknown> : {};
  return Array.isArray(policy.structuredFields) ? policy.structuredFields as WorkflowInteractionField[] : [];
}
