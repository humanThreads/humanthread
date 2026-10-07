"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Archive, CheckCircle2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { WorkbenchButton } from "../workbench-ui";

export type ProjectLifecycleStatus =
  | "draft"
  | "planned"
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "archived";

export interface ProjectLifecyclePanelApi {
  change(input: {
    command: "complete" | "archive";
    expectedVersion: number;
    force?: boolean;
    reason?: string;
  }): Promise<unknown>;
}

const TERMINAL_STATUSES = new Set<ProjectLifecycleStatus>(["completed", "archived", "cancelled"]);

/**
 * Closing a project is a lifecycle decision, not an edit, so it lives in the
 * settings page rather than in the roadmap editor. A project whose milestones
 * are still open can still be closed, but the closer has to say why: the reason
 * is recorded on the `project.completed` event.
 */
export function ProjectLifecyclePanel({
  projectId,
  status,
  version,
  canManage,
  openMilestoneCount,
  api: suppliedApi,
}: {
  projectId: string;
  status: ProjectLifecycleStatus;
  version: number;
  canManage: boolean;
  openMilestoneCount: number;
  api?: ProjectLifecyclePanelApi;
}) {
  const router = useRouter();
  const api = suppliedApi ?? createBrowserApi(projectId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!canManage) return null;

  const canComplete = status !== "completed" && status !== "archived" && status !== "cancelled";
  const canArchive = status === "completed" || status === "cancelled";
  const forced = openMilestoneCount > 0;

  async function run(input: { command: "complete" | "archive"; force?: boolean; reason?: string }) {
    setPending(true);
    setError(null);
    try {
      await api.change({ ...input, expectedVersion: version });
      setCompleteOpen(false);
      setReason("");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "项目生命周期操作失败");
    } finally {
      setPending(false);
    }
  }

  return <section aria-label="项目生命周期" className="grid gap-3">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-[#24292f]">关闭项目</p>
      <p className="mt-1 text-sm leading-6 text-[#57606a]">
        {status === "archived"
          ? "项目已归档，只读保留历史。"
          : status === "completed"
            ? "项目已完成。归档后将从常规列表中隐藏，历史与证据仍可追溯。"
            : status === "cancelled"
              ? "项目已取消。可以归档以从常规列表中隐藏。"
              : "完成项目会把它标记为终态并停止常规推进；之后仍可归档。"}
      </p>
      {forced && canComplete ? <p className="mt-1 text-xs leading-5 text-[#9a6700]">
        仍有 {openMilestoneCount} 个里程碑未完成。强制完成需要填写原因，原因会记录在项目事件里。
      </p> : null}
    </div>
    {error ? <p role="alert" className="break-words text-xs font-medium text-[#cf222e]">{error}</p> : null}
    <div className="flex flex-wrap items-center gap-2">
      {canComplete ? <WorkbenchButton type="button" disabled={pending} onClick={() => setCompleteOpen(true)} size="small" variant="primary"><CheckCircle2 size={14} />完成项目</WorkbenchButton> : null}
      {canArchive ? <WorkbenchButton type="button" disabled={pending} onClick={() => void run({ command: "archive" })} size="small"><Archive size={14} />归档项目</WorkbenchButton> : null}
      {!canComplete && !canArchive ? <span className="text-xs text-[#57606a]">当前状态没有可执行的生命周期操作。</span> : null}
    </div>

    <Dialog.Root open={completeOpen} onOpenChange={(next) => { if (!pending) setCompleteOpen(next); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#1f2328]/45" />
        <Dialog.Content className="fixed inset-x-4 top-1/2 z-50 max-h-[calc(100vh-32px)] -translate-y-1/2 overflow-y-auto rounded-lg border border-[#d0d7de] bg-white shadow-[0_24px_60px_rgba(31,35,40,0.24)] outline-none sm:left-1/2 sm:w-[min(92vw,520px)] sm:-translate-x-1/2">
          <div className="flex items-start gap-3 border-b border-[#d8dee4] px-5 py-4">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#dafbe1] text-[#1f883d]"><CheckCircle2 size={18} aria-hidden="true" /></div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold text-[#24292f]">完成项目</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-5 text-[#57606a]">
                {forced
                  ? `仍有 ${openMilestoneCount} 个里程碑未完成，请说明强制完成的原因。`
                  : "完成后项目进入终态，不再参与常规推进。"}
              </Dialog.Description>
            </div>
            <Dialog.Close disabled={pending} className="grid h-8 w-8 place-items-center rounded-md text-[#57606a] hover:bg-[#f6f8fa] disabled:opacity-50" aria-label="关闭完成项目对话框"><X size={17} aria-hidden="true" /></Dialog.Close>
          </div>
          <div className="grid gap-4 px-5 py-5">
            {forced ? <label className="grid gap-1.5 text-sm font-semibold text-[#24292f]">
              强制完成原因
              <textarea
                aria-label="强制完成原因"
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
                rows={3}
                className="resize-y rounded-md border border-[#8c959f] px-3 py-2 text-sm font-normal outline-none focus:border-[#0969da] focus:ring-2 focus:ring-[#0969da]/10"
                placeholder="例如：剩余范围已转入后续项目"
              />
              <span className="text-xs font-normal text-[#57606a]">必填，将记录在项目完成事件中。</span>
            </label> : null}
            {error ? <p role="alert" className="break-words text-xs font-medium text-[#cf222e]">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <WorkbenchButton type="button" disabled={pending} onClick={() => setCompleteOpen(false)} size="small">取消</WorkbenchButton>
              <WorkbenchButton
                type="button"
                disabled={pending || (forced && reason.trim().length === 0)}
                onClick={() => void run({
                  command: "complete",
                  ...(forced ? { force: true, reason: reason.trim() } : {}),
                })}
                size="small"
                variant="primary"
              >{pending ? "提交中…" : "确认完成"}</WorkbenchButton>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </section>;
}

function createBrowserApi(projectId: string): ProjectLifecyclePanelApi {
  return {
    async change(input) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/lifecycle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: input.command,
          commandId: `project-lifecycle:${projectId}:${input.command}:${Date.now()}`,
          expectedVersion: input.expectedVersion,
          ...(input.force === undefined ? {} : { force: input.force }),
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        }),
      });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "项目生命周期操作失败");
      return body;
    },
  };
}
