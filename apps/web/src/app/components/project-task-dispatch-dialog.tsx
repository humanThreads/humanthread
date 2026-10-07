"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Send, X } from "lucide-react";
import { useState } from "react";

export function ProjectTaskDispatchDialog({ open, projectId, milestones, profiles, onClose }: {
  open: boolean;
  projectId: string;
  milestones: Array<{ id: string; name: string }>;
  profiles: Array<{ id: string; name: string; provider: string }>;
  onClose(): void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !pending) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-[#1f2328]/45" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(680px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-md border border-[#d0d7de] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#d8dee4] px-5 py-4"><div><Dialog.Title className="text-base font-semibold text-[#1f2328]">派发任务</Dialog.Title><Dialog.Description className="mt-1 text-sm text-[#59636e]">定义目标、执行范围和验收证据。</Dialog.Description></div><Dialog.Close disabled={pending} className="grid size-8 place-items-center rounded hover:bg-[#f3f4f6]" aria-label="关闭"><X className="size-4" /></Dialog.Close></div>
        <form className="grid gap-4 p-5" onSubmit={async (event) => { event.preventDefault(); setPending(true); setError(null); const form = new FormData(event.currentTarget); try { const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "任务派发失败"); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : "任务派发失败"); } finally { setPending(false); } }}>
          <label className="grid gap-1.5 text-sm font-medium text-[#1f2328]">任务标题<input required name="title" className="h-10 rounded-md border border-[#8c959f] px-3 font-normal" /></label>
          <label className="grid gap-1.5 text-sm font-medium text-[#1f2328]">任务目标<textarea required name="objective" rows={3} className="rounded-md border border-[#8c959f] px-3 py-2 font-normal" /></label>
          <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">里程碑<select name="milestoneId" className="h-10 rounded-md border border-[#8c959f] px-3 font-normal">{milestones.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="grid gap-1.5 text-sm font-medium">执行 Agent<select name="preferredAgentProfileId" className="h-10 rounded-md border border-[#8c959f] px-3 font-normal"><option value="">按能力队列</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.provider}</option>)}</select></label></div>
          <label className="grid gap-1.5 text-sm font-medium">允许修改的路径<input required name="allowedPaths" placeholder="apps/web/**" className="h-10 rounded-md border border-[#8c959f] px-3 font-mono text-sm font-normal" /></label>
          <label className="grid gap-1.5 text-sm font-medium">必需检查<input required name="requiredChecks" placeholder="test, typecheck" className="h-10 rounded-md border border-[#8c959f] px-3 font-normal" /></label>
          <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">最大尝试次数<input required min={1} max={20} type="number" name="maxAttempts" defaultValue={4} className="h-10 rounded-md border border-[#8c959f] px-3 font-normal" /></label><label className="grid gap-1.5 text-sm font-medium">最长运行分钟<input required min={5} type="number" name="timeoutMinutes" defaultValue={60} className="h-10 rounded-md border border-[#8c959f] px-3 font-normal" /></label></div>
          {error ? <p role="alert" className="rounded border border-[#cf222e] bg-[#ffebe9] px-3 py-2 text-sm text-[#cf222e]">{error}</p> : null}
          <div className="flex justify-end gap-2 border-t border-[#d8dee4] pt-4"><button type="button" disabled={pending} onClick={onClose} className="h-9 rounded-md border border-[#d0d7de] px-4 text-sm font-medium">取消</button><button type="submit" disabled={pending} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1f883d] px-4 text-sm font-semibold text-white disabled:opacity-60"><Send className="size-4" />{pending ? "派发中" : "派发任务"}</button></div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
