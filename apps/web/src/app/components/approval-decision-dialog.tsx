"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Ban, Check, ExternalLink, FileText, RotateCcw, ShieldCheck, X, XCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { ApprovalDecisionItem as ApprovalReadModelItem } from "@/lib/orchestration/approval-read-model";

type ApprovalDecision = "approved" | "changes_requested" | "rejected";

export type ApprovalDecisionItem = Pick<ApprovalReadModelItem,
  | "id"
  | "type"
  | "taskShortId"
  | "taskTitle"
  | "projectName"
  | "loopLabel"
  | "nodeKey"
  | "nodeLabel"
  | "prompt"
  | "routes"
  | "action"
  | "scope"
  | "policyReason"
  | "upstreamOutput"
  | "reviewArtifacts"
>;

export interface ApprovalDecisionOption {
  decision: ApprovalDecision;
  edgeId: string | null;
  label: string;
}

export function validateApprovalDecision(input: { decision: ApprovalDecision; reason: string }) {
  if (input.reason.trim()) return null;
  if (input.decision === "changes_requested") return "请填写退回原因";
  return input.decision === "rejected" ? "请填写驳回原因" : null;
}

export function getApprovalDecisionOptions(approval: ApprovalDecisionItem): ApprovalDecisionOption[] {
  if (approval.type !== "loop_human_gate") {
    return [
      { decision: "approved", edgeId: null, label: "批准操作" },
      { decision: "rejected", edgeId: null, label: "驳回操作" },
    ];
  }
  if (!approval.routes) return [];
  return [
    decisionOption("approved", "同意", approval.routes.pass),
    decisionOption("changes_requested", "退回", approval.routes.rework),
    decisionOption("rejected", "拒绝", approval.routes.reject),
  ].filter((option): option is ApprovalDecisionOption => option !== null);
}

function decisionOption(
  decision: ApprovalDecision,
  label: string,
  edgeIds: string[],
): ApprovalDecisionOption | null {
  return edgeIds.length === 0
    ? null
    : { decision, edgeId: edgeIds.length === 1 ? edgeIds[0]! : null, label };
}

function routeIdsForDecision(approval: ApprovalDecisionItem, decision: ApprovalDecision): string[] {
  if (approval.type !== "loop_human_gate" || !approval.routes) return [];
  if (decision === "approved") return approval.routes.pass;
  if (decision === "changes_requested") return approval.routes.rework;
  return approval.routes.reject;
}

function approvalTitle(approval: ApprovalDecisionItem): string {
  if (approval.taskShortId && approval.taskTitle) return `${approval.taskShortId} · ${approval.taskTitle}`;
  return approval.taskShortId ?? approval.taskTitle ?? approval.type;
}

function approvalContext(approval: ApprovalDecisionItem): string | null {
  const loopNode = [approval.loopLabel, approval.nodeLabel].filter(Boolean).join(" · ");
  return [approval.projectName, loopNode].filter(Boolean).join(" · ") || null;
}

export function ApprovalDecisionSummary({ approval }: { approval: ApprovalDecisionItem }) {
  const context = approvalContext(approval);
  return <>
    <div className="min-w-0">
      <p className="break-words text-sm font-semibold text-[#24292f]">{approvalTitle(approval)}</p>
      {context ? <p className="mt-1 break-words text-xs text-[#59636e]">{context}</p> : null}
      {approval.prompt ? <p className="mt-2 break-words text-sm text-[#24292f]">{approval.prompt}</p> : <p className="mt-2 break-words text-sm text-[#59636e]">{approval.action}</p>}
    </div>
    <dl className="grid gap-3 rounded-md border border-[#d0d7de] bg-[#f6f8fa] p-3 text-sm">
      <div><dt className="text-xs font-semibold text-[#59636e]">请求范围</dt><dd className="mt-1 break-words font-mono text-xs">{approval.scope}</dd></div>
      <div><dt className="text-xs font-semibold text-[#59636e]">策略原因</dt><dd className="mt-1 break-words">{approval.policyReason}</dd></div>
    </dl>
  </>;
}

function ApprovalReviewPreviews({ approval }: { approval: ApprovalDecisionItem }) {
  const [expanded, setExpanded] = useState(false);
  const artifacts = approval.reviewArtifacts ?? [];
  const upstreamOutput = approval.upstreamOutput ?? "";
  if (artifacts.length === 0 && !upstreamOutput) return null;
  return <section className="grid gap-3" aria-label="Agent 审阅页">
    {upstreamOutput ? <div className="rounded-md border border-[#d0d7de] bg-[#f6f8fa]">
      <header className="flex min-w-0 items-center gap-2 border-b border-[#d8dee4] px-3 py-2">
        <FileText className="size-4 shrink-0 text-[#59636e]" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#24292f]">上一节点产出</span>
        <button type="button" onClick={() => setExpanded((value) => !value)} className="shrink-0 text-xs font-semibold text-[#0969da] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0969da]">
          {expanded ? "收起" : "展开"}
        </button>
      </header>
      <pre className={`overflow-x-auto whitespace-pre-wrap break-words px-3 py-2 text-xs text-[#24292f] ${expanded ? "" : "max-h-32 overflow-y-hidden"}`}>{upstreamOutput}</pre>
    </div> : null}
    {artifacts.map((artifact) => <div key={artifact.artifactId} className="overflow-hidden rounded-md border border-[#d0d7de] bg-[#f6f8fa]">
      <header className="flex min-w-0 items-center gap-2 border-b border-[#d8dee4] px-3 py-2">
        <FileText className="size-4 shrink-0 text-[#59636e]" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#24292f]">{artifact.fileName}</span>
        <a href={artifact.href} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#0969da] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0969da]">
          <ExternalLink className="size-3.5" />在新窗口打开
        </a>
      </header>
      <iframe
        title={`审阅页：${artifact.fileName}`}
        src={artifact.href}
        sandbox=""
        referrerPolicy="no-referrer"
        loading="lazy"
        className="block h-[min(58vh,560px)] w-full bg-white"
      />
    </div>)}
  </section>;
}

export function ApprovalDecisionDialog({ open, approval, onClose, onDecided }: {
  open: boolean;
  approval: ApprovalDecisionItem;
  onClose(): void;
  onDecided(input: { approvalId: string; decision: ApprovalDecision }): void;
}) {
  const options = getApprovalDecisionOptions(approval);
  const initialOption = options[0];
  const [decision, setDecision] = useState<ApprovalDecision>(initialOption?.decision ?? "approved");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(() => {
    if (!initialOption) return null;
    return initialOption.edgeId ?? routeIdsForDecision(approval, initialOption.decision)[0] ?? null;
  });
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const routeIds = routeIdsForDecision(approval, decision);
  const configurationError = approval.type === "loop_human_gate" && options.length === 0;

  function chooseDecision(option: ApprovalDecisionOption) {
    setDecision(option.decision);
    setSelectedEdgeId(option.edgeId ?? routeIdsForDecision(approval, option.decision)[0] ?? null);
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || configurationError) return;
    const validationError = validateApprovalDecision({ decision, reason });
    if (validationError) {
      setError(validationError);
      return;
    }
    if (approval.type === "loop_human_gate" && !selectedEdgeId) {
      setError("请选择审批后的流程路由");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/approvals/${encodeURIComponent(approval.id)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, reason, ...(selectedEdgeId ? { selectedEdgeId } : {}) }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "审批操作失败，请重试");
      onDecided({ approvalId: approval.id, decision });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "审批操作失败，请重试");
    } finally {
      setPending(false);
    }
  }

  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !pending) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-[#1f2328]/45" />
      <Dialog.Content aria-busy={pending} onEscapeKeyDown={(event) => pending && event.preventDefault()} onPointerDownOutside={(event) => pending && event.preventDefault()} className={`fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto border border-[#d0d7de] bg-white shadow-2xl outline-none sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-md ${approval.reviewArtifacts?.length || approval.upstreamOutput ? "sm:w-[min(94vw,1080px)]" : "sm:w-[min(92vw,560px)]"}`}>
        <form onSubmit={(event) => void submit(event)}>
          <header className="flex items-start gap-3 border-b border-[#d0d7de] px-5 py-4">
            <div className="grid size-9 shrink-0 place-items-center rounded-md bg-[#fff8c5] text-[#9a6700]"><ShieldCheck className="size-5" /></div>
            <div className="min-w-0 flex-1"><Dialog.Title className="text-base font-semibold">审批 · {approval.nodeLabel ?? approval.taskShortId ?? "操作"}</Dialog.Title><Dialog.Description className="mt-1 text-sm text-[#59636e]">确认当前任务、流程节点和审批后的去向。</Dialog.Description></div>
            <button type="button" disabled={pending} onClick={onClose} aria-label="关闭审批弹窗" className="grid size-8 place-items-center rounded-md text-[#59636e] hover:bg-[#f3f4f6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0969da] disabled:opacity-50"><X className="size-4" /></button>
          </header>
          <div className="grid gap-4 px-5 py-5">
            <ApprovalDecisionSummary approval={approval} />
            <ApprovalReviewPreviews approval={approval} />
            {configurationError ? <div role="alert" className="rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-sm text-[#cf222e]"><p className="font-semibold">当前节点没有可用的审批路由</p><p className="mt-1 break-all text-xs">节点：{approval.nodeKey ?? "未知节点"}。请检查 Loop 图配置后重试。</p></div> : <>
              <div className={`grid gap-2 ${options.length > 2 ? "sm:grid-cols-3" : "grid-cols-2"}`} role="group" aria-label="审批决定">
                {options.map((option) => {
                  const selected = decision === option.decision;
                  const Icon = option.decision === "approved" ? Check : option.decision === "changes_requested" ? RotateCcw : XCircle;
                  const selectedClass = option.decision === "approved"
                    ? "border-[#1a7f37] bg-[#dafbe1] text-[#116329]"
                    : option.decision === "changes_requested"
                      ? "border-[#9a6700] bg-[#fff8c5] text-[#7d4e00]"
                      : "border-[#cf222e] bg-[#ffebe9] text-[#cf222e]";
                  return <button key={option.decision} type="button" onClick={() => chooseDecision(option)} aria-pressed={selected} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0969da] ${selected ? selectedClass : "border-[#d0d7de] text-[#24292f] hover:bg-[#f6f8fa]"}`}><Icon className="size-4" />{option.label}</button>;
                })}
              </div>
              {routeIds.length > 1 ? <label className="grid gap-1.5 text-sm font-semibold">审批后进入<select value={selectedEdgeId ?? ""} onChange={(event) => { setSelectedEdgeId(event.target.value); setError(null); }} className="h-10 min-w-0 rounded-md border border-[#8c959f] bg-white px-3 font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10">{routeIds.map((edgeId) => <option key={edgeId} value={edgeId}>{edgeId}</option>)}</select></label> : null}
            </>}
            {!configurationError ? <label className="grid gap-1.5 text-sm font-semibold">决定说明{decision === "approved" ? "（可选）" : "（必填）"}<textarea rows={3} value={reason} onChange={(event) => { setReason(event.target.value); setError(null); }} className="rounded-md border border-[#8c959f] px-3 py-2 font-normal outline-none focus:border-[#0969da] focus:ring-4 focus:ring-[#0969da]/10" /></label> : null}
            {error ? <p role="alert" className="rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-sm text-[#cf222e]">{error}</p> : null}
          </div>
          <footer className="flex justify-end gap-2 border-t border-[#d0d7de] px-5 py-4"><button type="button" disabled={pending} onClick={onClose} className="h-9 rounded-md border border-[#d0d7de] px-4 text-sm font-semibold hover:bg-[#f6f8fa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0969da] disabled:opacity-50">取消</button><button type="submit" disabled={pending || configurationError} className={`inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${decision === "approved" ? "bg-[#1f883d] focus-visible:outline-[#1f883d]" : decision === "changes_requested" ? "bg-[#9a6700] focus-visible:outline-[#9a6700]" : "bg-[#cf222e] focus-visible:outline-[#cf222e]"}`}>{configurationError ? <Ban className="size-4" /> : null}{pending ? "提交中" : configurationError ? "无法提交" : decision === "approved" ? "确认同意" : decision === "changes_requested" ? "确认退回" : "确认拒绝"}</button></footer>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
