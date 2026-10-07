"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { StatusPill, WorkbenchButton } from "../../components/workbench-ui";

export type WorkerImageCatalogSource = {
  id: string;
  name: string;
  repository: string;
  status?: string;
  versions: Array<{ id: string; tag: string; digest: string; status: string }>;
};

type CatalogAction = (input:
  | { kind: "source"; name: string; repository: string }
  | { kind: "version"; sourceId: string; tag: string; digest: string }
  | { kind: "version-status"; versionId: string; status: "active" | "disabled" }
) => Promise<{ ok: boolean; formError?: string }>;

export function WorkerImageCatalogForm({
  sources,
  action,
}: {
  sources: WorkerImageCatalogSource[];
  action: CatalogAction;
}) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState("");
  const [name, setName] = useState("");
  const [repository, setRepository] = useState("");
  const [tag, setTag] = useState("");
  const [digest, setDigest] = useState("");
  const [managementSourceId, setManagementSourceId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [versionStatuses, setVersionStatuses] = useState<Record<string, "active" | "disabled">>({});
  const [pending, startTransition] = useTransition();
  const managedSources = managementSourceId ? sources.filter((source) => source.id === managementSourceId) : sources;
  const versionRows = managedSources.flatMap((source) => source.versions.map((version) => ({ source, version })));

  function submitSource() {
    startTransition(async () => {
      const result = await action({ kind: "source", name, repository });
      setMessage(result.ok ? "镜像来源已新增，可以继续新增版本。" : result.formError ?? "新增镜像来源失败。" );
      if (result.ok) {
        setName("");
        setRepository("");
        router.refresh();
      }
    });
  }

  function submitVersion() {
    startTransition(async () => {
      const result = await action({ kind: "version", sourceId, tag, digest });
      setMessage(result.ok ? "镜像版本已新增，可以继续管理或在项目中选择。" : result.formError ?? "新增镜像版本失败。" );
      if (result.ok) {
        setTag("");
        setDigest("");
        router.refresh();
      }
    });
  }

  function toggleVersion(versionId: string, currentStatus: "active" | "disabled") {
    const nextStatus = currentStatus === "active" ? "disabled" : "active";
    startTransition(async () => {
      const result = await action({ kind: "version-status", versionId, status: nextStatus });
      setMessage(result.ok
        ? nextStatus === "disabled" ? "镜像版本已禁用" : "镜像版本已启用"
        : result.formError ?? "镜像版本状态更新失败。");
      if (result.ok) setVersionStatuses((current) => ({ ...current, [versionId]: nextStatus }));
    });
  }

  return <div className="grid gap-5 xl:max-w-5xl">
    <div className="grid gap-3 rounded-md border border-[#d0d7de] p-4">
      <h3 className="text-sm font-semibold text-[#24292f]">新增镜像来源</h3>
      <label className="grid gap-1 text-sm font-semibold">来源名称<input aria-label="来源名称" value={name} onChange={(event) => setName(event.currentTarget.value)} className="h-9 rounded border px-2 font-normal" /></label>
      <label className="grid gap-1 text-sm font-semibold">镜像仓库<input aria-label="镜像仓库" value={repository} onChange={(event) => setRepository(event.currentTarget.value)} maxLength={767} placeholder="registry.example.com/library/worker" className="h-9 rounded border px-2 font-mono text-xs font-normal" /></label>
      <WorkbenchButton type="button" size="small" disabled={pending || !name.trim() || !repository.trim()} onClick={submitSource}>新增镜像来源</WorkbenchButton>
    </div>
    <div className="grid gap-3 rounded-md border border-[#d0d7de] p-4">
      <h3 className="text-sm font-semibold text-[#24292f]">新增不可变镜像版本</h3>
      <label className="grid gap-1 text-sm font-semibold">镜像来源<select aria-label="镜像来源" value={sourceId} onChange={(event) => setSourceId(event.currentTarget.value)} className="h-9 rounded border bg-white px-2 font-normal"><option value="">选择镜像来源</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name} · {source.repository}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-semibold">镜像 Tag<input aria-label="镜像 Tag" value={tag} onChange={(event) => setTag(event.currentTarget.value)} placeholder="20260917-build" className="h-9 rounded border px-2 font-mono text-xs font-normal" /></label>
      <label className="grid gap-1 text-sm font-semibold">镜像 Digest<input aria-label="镜像 Digest" value={digest} onChange={(event) => setDigest(event.currentTarget.value)} placeholder="sha256:..." className="h-9 rounded border px-2 font-mono text-xs font-normal" /></label>
      <WorkbenchButton type="button" size="small" disabled={pending || !sourceId || !tag.trim() || !digest.trim()} onClick={submitVersion}>新增镜像版本</WorkbenchButton>
    </div>
    <div className="grid gap-3 rounded-md border border-[#d0d7de] p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#24292f]">镜像版本管理</h3>
          <p className="mt-1 text-xs leading-5 text-[#57606a]">禁用后不会再出现在项目的新部署选择中；已经运行的 Worker 不受影响。</p>
        </div>
        <label className="grid min-w-64 gap-1 text-sm font-semibold">筛选镜像来源<select aria-label="筛选镜像来源" value={managementSourceId} onChange={(event) => setManagementSourceId(event.currentTarget.value)} className="h-9 rounded border bg-white px-2 font-normal"><option value="">全部来源</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name} · {source.repository}</option>)}</select></label>
      </div>
      <div className="overflow-x-auto border-y border-[#d8dee4]">
        <table aria-label="镜像版本列表" className="w-full min-w-[760px] border-collapse text-left text-xs">
          <thead className="bg-[#f6f8fa] text-[#57606a]"><tr><th className="px-3 py-2 font-semibold">来源</th><th className="px-3 py-2 font-semibold">Tag</th><th className="px-3 py-2 font-semibold">Digest</th><th className="px-3 py-2 font-semibold">状态</th><th className="px-3 py-2 text-right font-semibold">操作</th></tr></thead>
          <tbody className="divide-y divide-[#d8dee4]">
            {versionRows.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-[#57606a]">当前筛选下暂无镜像版本。</td></tr> : versionRows.map(({ source, version }) => {
              const status = versionStatuses[version.id] ?? (version.status === "disabled" ? "disabled" : "active");
              return <tr key={`${source.id}:${version.id}`}>
                <td className="px-3 py-2 align-top"><strong className="block text-[#24292f]">{source.name}</strong><span className="mt-0.5 block break-all text-[#57606a]">{source.repository}</span>{source.status === "disabled" ? <StatusPill tone="warning">来源已禁用</StatusPill> : null}</td>
                <td className="px-3 py-2 align-top font-mono text-[#24292f]">{version.tag}</td>
                <td className="max-w-md px-3 py-2 align-top font-mono text-[#57606a]"><span className="block break-all">{version.digest}</span></td>
                <td className="px-3 py-2 align-top"><StatusPill tone={status === "active" ? "success" : "default"}>{status === "active" ? "已启用" : "已禁用"}</StatusPill></td>
                <td className="px-3 py-2 text-right align-top"><WorkbenchButton type="button" size="small" variant="secondary" disabled={pending} onClick={() => toggleVersion(version.id, status)}>{status === "active" ? "禁用" : "启用"}</WorkbenchButton></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </div>
    <p className="text-xs leading-5 text-[#57606a]">项目只能从已启用目录选择镜像版本；部署命令始终使用 Digest，不会使用可变 Tag。</p>
    {message ? <p role="status" className="text-sm text-[#57606a]">{message}</p> : null}
  </div>;
}
