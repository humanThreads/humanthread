"use client";

import type {
  TaskAcceptanceEvidenceStatus,
  TaskAcceptanceReadiness,
} from "@humanthread/orchestration-core";
import {
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  CircleSlash2,
  ClipboardCheck,
  LoaderCircle,
  Send,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { createTaskCommandId } from "../../../lib/tasks/task-command-id";

const STATUS_OPTIONS: Array<{ value: TaskAcceptanceEvidenceStatus; label: string }> = [
  { value: "passed", label: "通过" },
  { value: "failed", label: "未通过" },
  { value: "inconclusive", label: "无法判定" },
  { value: "skipped", label: "已跳过" },
];

function sourceLabel(source: string) {
  if (source === "user") return "人工";
  if (source === "mcp") return "MCP";
  if (source === "automation") return "自动化";
  return "系统";
}

function evidenceStatus(status: TaskAcceptanceEvidenceStatus | "missing") {
  if (status === "passed") return { label: "通过", className: "text-[#1a7f37]", icon: CheckCircle2 };
  if (status === "failed") return { label: "未通过", className: "text-[#cf222e]", icon: XCircle };
  if (status === "inconclusive") return { label: "无法判定", className: "text-[#9a6700]", icon: CircleHelp };
  if (status === "skipped") return { label: "已跳过", className: "text-[#57606a]", icon: CircleSlash2 };
  return { label: "未提交", className: "text-[#57606a]", icon: CircleDashed };
}

function acceptanceError(code: string | undefined, fallback: string | undefined) {
  if (code === "version_conflict") return "任务已被更新，请刷新后重新提交证据。";
  if (code === "task_access_denied" || code === "authorization_denied") return "你没有提交验收证据的权限。";
  if (code === "task_acceptance_evidence_required") return "验收证据尚未全部通过，请先处理缺失或未通过的检查。";
  return fallback || "验收操作失败，请重试。";
}

export function TaskAcceptanceEvidence({
  taskId,
  version,
  statusCategory,
  readiness: initialReadiness,
  canGovern,
  canAccept,
  onVersionChange,
  onAccepted,
}: {
  taskId: string;
  version: number;
  statusCategory: string | null;
  readiness: TaskAcceptanceReadiness;
  canGovern: boolean;
  canAccept: boolean;
  onVersionChange(version: number): void;
  onAccepted(): void;
}) {
  const [readinessOverride, setReadinessOverride] = useState<{
    taskId: string;
    baseVersion: number;
    version: number;
    readiness: TaskAcceptanceReadiness;
  } | null>(null);
  const [checkKey, setCheckKey] = useState(initialReadiness.missingChecks[0] ?? initialReadiness.blockingChecks[0] ?? initialReadiness.requiredChecks[0] ?? "");
  const [status, setStatus] = useState<TaskAcceptanceEvidenceStatus>("passed");
  const [summary, setSummary] = useState("");
  const [evidenceMarkdown, setEvidenceMarkdown] = useState("");
  const [pending, setPending] = useState<"evidence" | "accept" | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "status"; text: string } | null>(null);

  const readiness = readinessOverride?.taskId === taskId
    && (readinessOverride.baseVersion === version || readinessOverride.version <= version)
    ? readinessOverride.readiness
    : initialReadiness;

  const latestByCheck = new Map(readiness.latestEvidence.map((evidence) => [evidence.checkKey, evidence]));
  const blockers = [...readiness.missingChecks, ...readiness.blockingChecks];

  async function submitEvidence() {
    if (!checkKey || !summary.trim()) return;
    setPending("evidence");
    setMessage(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/commands/submit_acceptance_evidence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: createTaskCommandId(),
          expectedVersion: version,
          checkKey,
          status,
          summary: summary.trim(),
          ...(evidenceMarkdown.trim() ? { evidenceMarkdown: evidenceMarkdown.trim() } : {}),
        }),
      });
      const body = await response.json() as {
        ok: boolean;
        result?: { version: number; readiness: TaskAcceptanceReadiness };
        code?: string;
        error?: string;
      };
      if (!response.ok || !body.ok || !body.result) {
        throw Object.assign(new Error(body.error), { code: body.code });
      }
      setReadinessOverride({
        taskId,
        baseVersion: version,
        version: body.result.version,
        readiness: body.result.readiness,
      });
      onVersionChange(body.result.version);
      setSummary("");
      setEvidenceMarkdown("");
      setMessage({ kind: "status", text: "验收证据已记录，仍需单独执行最终验收。" });
    } catch (error) {
      const record = error && typeof error === "object" ? error as { code?: string; message?: string } : {};
      setMessage({ kind: "error", text: acceptanceError(record.code, record.message) });
    } finally {
      setPending(null);
    }
  }

  async function acceptTask() {
    setPending("accept");
    setMessage(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/commands/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: createTaskCommandId(),
          expectedVersion: version,
        }),
      });
      const body = await response.json() as { ok: boolean; result?: { version: number }; code?: string; error?: string };
      if (!response.ok || !body.ok || !body.result) {
        throw Object.assign(new Error(body.error), { code: body.code });
      }
      onVersionChange(body.result.version);
      onAccepted();
    } catch (error) {
      const record = error && typeof error === "object" ? error as { code?: string; message?: string } : {};
      setMessage({ kind: "error", text: acceptanceError(record.code, record.message) });
    } finally {
      setPending(null);
    }
  }

  return <section aria-label="自动验收" className="shrink-0 border-b border-[#d0d7de] bg-[#f6f8fa] px-4 py-3">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="inline-flex items-center gap-2 text-sm font-semibold text-[#24292f]">
        <ClipboardCheck size={16} className="text-[#57606a]" />自动验收
      </div>
      <span className={readiness.ready ? "text-xs font-medium text-[#1a7f37]" : "text-xs text-[#57606a]"}>
        {readiness.policyErrors.length > 0
          ? "验收策略配置无效，请先修复任务配置。"
          : readiness.ready
            ? "所有必需检查均已通过，可以执行最终验收。"
            : blockers.length ? `仍需提交：${blockers.join("、")}` : "等待验收证据"}
      </span>
      {canAccept && statusCategory === "in_review" ? <button
        type="button"
        disabled={!readiness.ready || pending !== null}
        onClick={() => void acceptTask()}
        className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-[#1f883d] px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#afb8c1]"
      >
        {pending === "accept" ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <CheckCircle2 size={14} />}
        通过验收
      </button> : null}
    </div>

    <div className="mt-2 divide-y divide-[#d8dee4] border-y border-[#d8dee4]">
      {readiness.requiredChecks.map((requiredCheck) => {
        const evidence = latestByCheck.get(requiredCheck);
        const state = evidenceStatus(evidence?.status ?? "missing");
        const StatusIcon = state.icon;
        return <div key={requiredCheck} className="grid min-w-0 gap-1 py-2 text-xs sm:grid-cols-[minmax(8rem,0.7fr)_minmax(12rem,1.3fr)_auto] sm:items-center sm:gap-3">
          <span className="min-w-0 break-words font-medium text-[#24292f]">{requiredCheck}</span>
          <span className="min-w-0 break-words text-[#57606a]">{evidence?.summary ?? "尚无验收证据"}</span>
          <span className={`inline-flex items-center gap-1 font-medium ${state.className}`}>
            <StatusIcon size={14} />{state.label}{evidence ? ` · ${sourceLabel(evidence.source)}` : ""}
          </span>
        </div>;
      })}
    </div>

    {canGovern ? <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-[minmax(8rem,0.7fr)_minmax(8rem,0.7fr)_minmax(14rem,1.6fr)_auto]">
      <label className="grid min-w-0 gap-1 text-xs font-medium text-[#24292f]">检查
        <select aria-label="验收检查" value={checkKey} onChange={(event) => setCheckKey(event.target.value)} disabled={pending !== null} className="h-9 min-w-0 rounded-md border border-[#d0d7de] bg-white px-2 text-sm">
          {readiness.requiredChecks.map((requiredCheck) => <option key={requiredCheck} value={requiredCheck}>{requiredCheck} · 必需</option>)}
        </select>
      </label>
      <label className="grid min-w-0 gap-1 text-xs font-medium text-[#24292f]">结果
        <select aria-label="证据结果" value={status} onChange={(event) => setStatus(event.target.value as TaskAcceptanceEvidenceStatus)} disabled={pending !== null} className="h-9 min-w-0 rounded-md border border-[#d0d7de] bg-white px-2 text-sm">
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label className="grid min-w-0 gap-1 text-xs font-medium text-[#24292f]">摘要
        <input aria-label="证据摘要" required maxLength={2_000} value={summary} onChange={(event) => setSummary(event.target.value)} disabled={pending !== null} placeholder="记录可复核的检查结论" className="h-9 min-w-0 rounded-md border border-[#d0d7de] bg-white px-2 text-sm placeholder:text-[#6e7781]" />
      </label>
      <button type="button" disabled={!checkKey || !summary.trim() || pending !== null} onClick={() => void submitEvidence()} className="mt-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[#1f883d] bg-white px-3 text-sm font-semibold text-[#1a7f37] disabled:cursor-not-allowed disabled:border-[#d0d7de] disabled:text-[#8c959f]">
        {pending === "evidence" ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <Send size={14} />}
        提交验收证据
      </button>
      <label className="grid min-w-0 gap-1 text-xs font-medium text-[#24292f] sm:col-span-4">证据详情（可选）
        <textarea aria-label="证据详情" maxLength={10_000} rows={2} value={evidenceMarkdown} onChange={(event) => setEvidenceMarkdown(event.target.value)} disabled={pending !== null} placeholder="命令、报告地址、版本或其他复核信息" className="min-h-16 min-w-0 resize-y rounded-md border border-[#d0d7de] bg-white px-2 py-1.5 text-sm placeholder:text-[#6e7781]" />
      </label>
    </div> : null}
    {message ? <div role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "mt-2 text-xs text-[#cf222e]" : "mt-2 text-xs text-[#57606a]"}>{message.text}</div> : null}
  </section>;
}
