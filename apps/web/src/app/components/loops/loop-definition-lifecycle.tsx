"use client";

import { Archive, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DangerConfirmDialog } from "../settings-dialog";

export interface LoopDefinitionLifecycleModel {
  canArchive: boolean;
  canDelete: boolean;
  referenceCount: number;
  references: {
    versions: number;
    bindings: number;
    runs: number;
    receipts: number;
    grants: number;
  };
}

export interface LoopDefinitionLifecycleApi {
  mutate(mode: "archive" | "delete"): Promise<unknown>;
}

export function LoopDefinitionLifecycle({
  definitionId,
  draftRevision,
  origin,
  status,
  lifecycle,
  api: suppliedApi,
}: {
  definitionId: string;
  draftRevision: number;
  origin: "platform" | "space";
  status: string;
  lifecycle: LoopDefinitionLifecycleModel;
  api?: LoopDefinitionLifecycleApi;
}) {
  const router = useRouter();
  const api = useMemo(
    () => suppliedApi ?? createBrowserApi(definitionId, draftRevision),
    [definitionId, draftRevision, suppliedApi],
  );
  const [error, setError] = useState<string | null>(null);

  if (origin === "platform" || (!lifecycle.canArchive && !lifecycle.canDelete)) return null;

  async function mutate(mode: "archive" | "delete") {
    setError(null);
    try {
      await api.mutate(mode);
      router.push("/loops");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Loop 生命周期操作失败");
    }
  }

  return (
    <section aria-label="Loop 生命周期" className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-[#d0d7de] bg-white px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[#24292f]">定义生命周期</p>
        <p className="mt-0.5 max-w-3xl text-xs leading-5 text-[#57606a]">
          {lifecycle.referenceCount > 0
            ? `当前有 ${lifecycle.referenceCount} 项历史引用；归档会保留运行、绑定和证据。`
            : status === "draft"
              ? "当前草稿没有历史引用，可以归档或永久删除。"
              : "归档后将从常规 Loop 目录隐藏，并保留已有历史。"}
        </p>
        {error ? <p role="alert" className="mt-1 break-words text-xs font-medium text-[#cf222e]">{error}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {lifecycle.canArchive ? (
          <DangerConfirmDialog
            triggerLabel="归档 Loop"
            triggerIcon={<Archive aria-hidden="true" className="h-4 w-4" />}
            title="归档 Loop"
            description="归档后该定义不会出现在常规目录中，但历史运行、绑定与证据仍然可追溯。"
            actionLabel="确认归档"
            onConfirm={() => mutate("archive")}
          />
        ) : null}
        {lifecycle.canDelete ? (
          <DangerConfirmDialog
            triggerLabel="删除 Loop"
            triggerIcon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
            title="永久删除 Loop"
            description="该草稿没有任何历史引用。删除后无法恢复。"
            actionLabel="确认删除"
            confirmationText="DELETE"
            onConfirm={() => mutate("delete")}
          />
        ) : null}
      </div>
    </section>
  );
}

function createBrowserApi(definitionId: string, draftRevision: number): LoopDefinitionLifecycleApi {
  return {
    async mutate(mode) {
      const response = await fetch(`/api/loops/${encodeURIComponent(definitionId)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: commandId(), expectedRevision: draftRevision, mode }),
      });
      const body = await response.json() as { ok?: boolean; result?: unknown; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Loop 生命周期操作失败");
      return body.result;
    },
  };
}

function commandId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `loop-lifecycle-${Date.now().toString(36)}`;
}
