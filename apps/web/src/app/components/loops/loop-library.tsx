"use client";

import type { LoopGraphV2 } from "@humanthread/orchestration-core";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { WorkbenchButton } from "../workbench-ui";

const EMPTY_LOOP_GRAPH = {
  schemaVersion: 2,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 8, maxRepeatCount: 2 },
  nodes: [
    { key: "start", label: "开始", type: "start" },
    { key: "end", label: "结束", type: "end" },
  ],
  edges: [
    { id: "start-end", source: "start", target: "end", kind: "normal", outcome: "success" },
  ],
  routingMetadata: {},
} satisfies LoopGraphV2;

export function LoopCreateButton({
  spaces,
  defaultSpaceId,
  onCreated,
}: {
  spaces: Array<{ id: string; label: string }>;
  defaultSpaceId?: string;
  onCreated?: (loopDefinitionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"task" | "project">("task");
  const [spaceId, setSpaceId] = useState(defaultSpaceId ?? spaces[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createDraft() {
    if (!spaceId || !name.trim()) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/loops", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: commandId(),
          spaceId,
          scope,
          name: name.trim(),
          description: description.trim() || null,
          graph: EMPTY_LOOP_GRAPH,
        }),
      });
      const body = await response.json() as {
        ok?: boolean;
        result?: { loopDefinitionId?: string; id?: string };
        error?: string;
      };
      const id = body.result?.loopDefinitionId ?? body.result?.id;
      if (!response.ok || !body.ok || !id) throw new Error(body.error ?? "Loop 创建失败");
      if (onCreated) onCreated(id);
      else window.location.assign(`/loops/${encodeURIComponent(id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Loop 创建失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <WorkbenchButton type="button" size="small" variant="primary" disabled={spaces.length === 0} onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" className="h-3.5 w-3.5" />
        新建 Loop
      </WorkbenchButton>
      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#24292f66] p-4" role="presentation">
          <section className="w-full max-w-lg rounded-md border border-[#d0d7de] bg-white shadow-xl" role="dialog" aria-modal="true" aria-label="新建 Loop">
            <header className="flex items-center justify-between border-b border-[#d0d7de] px-4 py-3">
              <h2 className="text-sm font-semibold text-[#24292f]">新建 Loop</h2>
              <button type="button" className="grid h-7 w-7 place-items-center" onClick={() => setOpen(false)} aria-label="关闭新建 Loop">
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </header>
            <div className="grid gap-4 px-4 py-4">
              <label className="text-xs font-medium text-[#57606a]">
                Space
                <select value={spaceId} onChange={(event) => setSpaceId(event.currentTarget.value)} className="mt-1 w-full rounded-md border border-[#d0d7de] bg-white px-2 py-2 text-sm text-[#24292f]">
                  {spaces.map((space) => <option key={space.id} value={space.id}>{space.label}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-[#57606a]">
                Loop 级别
                <select aria-label="Loop 级别" value={scope} onChange={(event) => setScope(event.currentTarget.value === "project" ? "project" : "task")} className="mt-1 w-full rounded-md border border-[#d0d7de] bg-white px-2 py-2 text-sm text-[#24292f]">
                  <option value="task">任务级 Loop</option>
                  <option value="project">项目级 Loop</option>
                </select>
              </label>
              <label className="text-xs font-medium text-[#57606a]">
                Loop 名称
                <input aria-label="Loop 名称" value={name} maxLength={191} onChange={(event) => setName(event.currentTarget.value)} className="mt-1 w-full rounded-md border border-[#d0d7de] px-3 py-2 text-sm text-[#24292f] outline-none focus:border-[#1f883d] focus:ring-2 focus:ring-[#1f883d22]" />
              </label>
              <label className="text-xs font-medium text-[#57606a]">
                说明
                <textarea value={description} maxLength={10_000} rows={3} onChange={(event) => setDescription(event.currentTarget.value)} className="mt-1 w-full rounded-md border border-[#d0d7de] px-3 py-2 text-sm text-[#24292f] outline-none focus:border-[#1f883d] focus:ring-2 focus:ring-[#1f883d22]" />
              </label>
              <p className="text-xs leading-5 text-[#6e7781]">初始草稿为“开始 → 结束”，人工确认节点可按需添加。</p>
              {error ? <p role="alert" className="text-xs text-[#cf222e]">{error}</p> : null}
            </div>
            <footer className="flex justify-end gap-2 border-t border-[#d0d7de] px-4 py-3">
              <WorkbenchButton type="button" size="small" onClick={() => setOpen(false)}>取消</WorkbenchButton>
              <WorkbenchButton type="button" size="small" variant="primary" disabled={pending || !spaceId || !name.trim()} onClick={createDraft}>
                {pending ? "创建中" : "创建草稿"}
              </WorkbenchButton>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}

function commandId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `loop-create-${Date.now().toString(36)}`;
}
