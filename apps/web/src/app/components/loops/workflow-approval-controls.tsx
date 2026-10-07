"use client";

import type { WorkflowInteractionView } from "@humanthread/shared";
import { ArrowRightLeft, Check, RotateCcw, Send, ShieldCheck, Square, X } from "lucide-react";
import { useState } from "react";

type InterventionAction = "resume_checkpoint" | "route_upstream" | "terminate";

export function WorkflowApprovalControls({
  interaction,
  canConfirm = false,
  canDecideApproval = false,
  selectedEdgeId = "continue",
  onConfirm,
  onDecide,
  onConfirmPosition = () => undefined,
  onSubmitIntervention = () => undefined,
  onDelegateConflictSpeaker = () => undefined,
}: {
  interaction: WorkflowInteractionView | Record<string, unknown>;
  canConfirm?: boolean;
  canDecideApproval?: boolean;
  selectedEdgeId?: string;
  onConfirm?: (reason: string) => Promise<void> | void;
  onDecide?: (decision: "approved" | "rejected", reason: string, selectedEdgeId: string) => Promise<void> | void;
  onConfirmPosition?: () => Promise<void> | void;
  onSubmitIntervention?: (action: InterventionAction, reason: string, manualConflict: boolean) => Promise<void> | void;
  onDelegateConflictSpeaker?: (speakerUserId: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const status = typeof interaction.status === "string" ? interaction.status : "open";
  const kind = typeof interaction.kind === "string" ? interaction.kind : "requirement_conversation";
  if (status !== "open") {
    return <div className="border-t border-[#d0d7de] bg-[#f6f8fa] px-4 py-3 text-xs text-[#57606a]">{status === "rejected" ? "用户已拒绝" : status === "approved" ? "用户已批准" : status === "confirmed" ? "用户已确认" : "交互已结束"}</div>;
  }
  const run = async (callback: () => Promise<void> | void) => {
    if (busy) return;
    setBusy(true);
    try { await callback(); } finally { setBusy(false); }
  };
  if (kind === "runtime_intervention") {
    return <WorkflowInterventionControls
      interaction={interaction}
      busy={busy}
      run={run}
      onConfirmPosition={onConfirmPosition}
      onSubmitIntervention={onSubmitIntervention}
      onDelegateConflictSpeaker={onDelegateConflictSpeaker}
    />;
  }
  return (
    <section aria-label="审批与确认" className="border-t border-[#d0d7de] bg-white px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-[#24292f]"><ShieldCheck aria-hidden="true" className="h-4 w-4" />需要人工确认</div>
      <textarea aria-label="审批说明" value={reason} onChange={(event) => setReason(event.currentTarget.value)} placeholder="可填写说明" className="mt-3 min-h-16 w-full resize-y rounded-md border border-[#d0d7de] px-3 py-2 text-sm text-[#24292f]" />
      {kind === "requirement_conversation" ? (
        <button type="button" disabled={!canConfirm || busy} onClick={() => void run(() => onConfirm?.(reason))} className="mt-2 inline-flex items-center gap-2 rounded-md bg-[#0969da] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Check aria-hidden="true" className="h-4 w-4" />确认需求</button>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={!canDecideApproval || busy} onClick={() => void run(() => onDecide?.("approved", reason, selectedEdgeId))} className="inline-flex items-center gap-2 rounded-md bg-[#1f883d] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Check aria-hidden="true" className="h-4 w-4" />同意</button>
          <button type="button" disabled={!canDecideApproval || busy || reason.trim().length === 0} onClick={() => void run(() => onDecide?.("rejected", reason, selectedEdgeId))} className="inline-flex items-center gap-2 rounded-md border border-[#cf222e] px-3 py-2 text-sm font-semibold text-[#cf222e] disabled:opacity-50"><X aria-hidden="true" className="h-4 w-4" />拒绝</button>
        </div>
      )}
    </section>
  );
}

function WorkflowInterventionControls({
  interaction,
  busy,
  run,
  onConfirmPosition,
  onSubmitIntervention,
  onDelegateConflictSpeaker,
}: {
  interaction: WorkflowInteractionView | Record<string, unknown>;
  busy: boolean;
  run: (callback: () => Promise<void> | void) => Promise<void>;
  onConfirmPosition?: () => Promise<void> | void;
  onSubmitIntervention?: (action: InterventionAction, reason: string, manualConflict: boolean) => Promise<void> | void;
  onDelegateConflictSpeaker?: (speakerUserId: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<InterventionAction>("resume_checkpoint");
  const [manualConflict, setManualConflict] = useState(false);
  const [delegateTarget, setDelegateTarget] = useState("");
  const capabilities = record(interaction.capabilities);
  const discussion = record(interaction.discussionState);
  const phase = discussion.phase === "conflict_resolution" ? "conflict_resolution" : "ordinary";
  const canConfirmPosition = capabilities.canConfirmOwnPosition === true;
  const canSubmit = capabilities.canSubmit === true || capabilities.canResolveConflict === true;
  const canDelegate = capabilities.canDelegateConflictSpeaker === true;
  const candidates = Array.isArray(capabilities.conflictSpeakerCandidates)
    ? capabilities.conflictSpeakerCandidates.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object")
    : [];
  const missingCount = typeof discussion.missingConfirmationCount === "number" ? discussion.missingConfirmationCount : 0;
  const speakers = Array.isArray(discussion.speakers) ? discussion.speakers : [];
  const submit = () => void run(() => onSubmitIntervention?.(action, reason, manualConflict));

  return (
    <section aria-label="人工介入处理" className="border-t border-[#d0d7de] bg-white px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-[#24292f]"><ShieldCheck aria-hidden="true" className="h-4 w-4" />{phase === "conflict_resolution" ? "冲突二次确认" : "人工介入处理"}</div>
      {phase === "ordinary" ? (
        <>
          {canConfirmPosition ? <button type="button" disabled={busy} onClick={() => void run(() => onConfirmPosition?.())} className="mt-3 inline-flex items-center gap-2 rounded-md border border-[#0969da] px-3 py-2 text-sm font-semibold text-[#0969da] disabled:opacity-50"><Check aria-hidden="true" className="h-4 w-4" />确认我的意见</button> : null}
          {speakers.length > 0 && missingCount > 0 ? <p className="mt-3 text-xs leading-5 text-[#7d4e00]">等待所有发言人确认后，任务负责人才能提交</p> : null}
          {speakers.length === 0 ? <p className="mt-3 text-xs leading-5 text-[#57606a]">没有参与人发言，任务负责人可以直接提交</p> : null}
          <InterventionSubmitForm action={action} setAction={setAction} reason={reason} setReason={setReason} manualConflict={manualConflict} setManualConflict={setManualConflict} canSubmit={canSubmit} busy={busy} onSubmit={submit} />
        </>
      ) : (
        <>
          {canDelegate ? <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-52 flex-1 text-xs font-medium text-[#57606a]">转交二次发言人<select aria-label="转交二次发言人" value={delegateTarget} onChange={(event) => setDelegateTarget(event.currentTarget.value)} className="mt-1 w-full rounded-md border border-[#d0d7de] bg-white px-2 py-2 text-sm font-normal text-[#24292f]"><option value="">请选择参与人</option>{candidates.map((candidate, index) => <option key={typeof candidate.userId === "string" ? candidate.userId : String(index)} value={typeof candidate.userId === "string" ? candidate.userId : ""}>{typeof candidate.displayName === "string" ? candidate.displayName : "参与人"}</option>)}</select></label>
            <button type="button" disabled={busy || !delegateTarget} onClick={() => void run(() => onDelegateConflictSpeaker?.(delegateTarget))} className="inline-flex items-center gap-2 rounded-md border border-[#0969da] px-3 py-2 text-sm font-semibold text-[#0969da] disabled:opacity-50"><ArrowRightLeft aria-hidden="true" className="h-4 w-4" />转交发言权</button>
          </div> : null}
          {capabilities.canResolveConflict === true ? <InterventionSubmitForm action={action} setAction={setAction} reason={reason} setReason={setReason} manualConflict={false} setManualConflict={() => undefined} canSubmit={canSubmit} busy={busy} onSubmit={submit} conflict /> : <p className="mt-3 text-xs leading-5 text-[#57606a]">当前发言人可以补充结论并确认提交，其他参与人只读。</p>}
        </>
      )}
    </section>
  );
}

function InterventionSubmitForm({
  action,
  setAction,
  reason,
  setReason,
  manualConflict,
  setManualConflict,
  canSubmit,
  busy,
  onSubmit,
  conflict = false,
}: {
  action: InterventionAction;
  setAction: (value: InterventionAction) => void;
  reason: string;
  setReason: (value: string) => void;
  manualConflict: boolean;
  setManualConflict: (value: boolean) => void;
  canSubmit: boolean;
  busy: boolean;
  onSubmit: () => void;
  conflict?: boolean;
}) {
  const ActionIcon = action === "terminate" ? Square : action === "route_upstream" ? RotateCcw : Send;
  return <div className="mt-3 border-t border-[#d0d7de] pt-3">
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
      <label className="text-xs font-medium text-[#57606a]">恢复动作<select aria-label="恢复动作" value={action} onChange={(event) => setAction(event.currentTarget.value as InterventionAction)} className="mt-1 w-full rounded-md border border-[#d0d7de] bg-white px-2 py-2 text-sm font-normal text-[#24292f]"><option value="resume_checkpoint">补齐依赖并恢复</option><option value="route_upstream">修正范围并回流</option><option value="terminate">终止运行</option></select></label>
      <label className="text-xs font-medium text-[#57606a]">处理说明<textarea aria-label="处理说明" value={reason} onChange={(event) => setReason(event.currentTarget.value)} placeholder="说明本次处理依据" className="mt-1 min-h-16 w-full resize-y rounded-md border border-[#d0d7de] px-2 py-2 text-sm font-normal text-[#24292f]" /></label>
    </div>
    {!conflict ? <label className="mt-2 inline-flex items-center gap-2 text-xs text-[#57606a]"><input type="checkbox" checked={manualConflict} onChange={(event) => setManualConflict(event.currentTarget.checked)} />标记存在冲突，进入二次确认</label> : null}
    <button type="button" disabled={!canSubmit || busy} onClick={onSubmit} className="mt-3 inline-flex items-center gap-2 rounded-md bg-[#1f883d] px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><ActionIcon aria-hidden="true" className="h-4 w-4" />确认提交</button>
  </div>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
