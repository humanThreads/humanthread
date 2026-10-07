"use client";

import { useState } from "react";

type StorageConfig = { provider: "local" | "oss" | "s3"; rootPath?: string; bucket?: string; endpoint?: string; region?: string; credentialRef?: string; scan: "configured" | "unconfigured" };

export function StorageSettingsForm({ initial }: { initial: StorageConfig | null }) {
  const [config, setConfig] = useState<StorageConfig>(initial ?? { provider: "local", rootPath: "apps/web/storage", scan: "unconfigured" });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function save() {
    setPending(true); setMessage(null);
    try {
      const response = await fetch("/api/settings/storage", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ config }) });
      const body = await response.json() as { ok?: boolean; error?: string };
      setMessage(response.ok && body.ok ? "文件存储配置已保存" : body.error ?? "保存失败");
    } catch { setMessage("保存失败"); } finally { setPending(false); }
  }
  return <div className="grid gap-3 md:max-w-2xl"><label className="grid gap-1 text-sm font-semibold">存储方式<select aria-label="文件存储方式" value={config.provider} onChange={(event) => setConfig({ ...config, provider: event.target.value as StorageConfig["provider"] })} className="h-9 rounded border px-2 text-sm"><option value="local">服务器本地路径</option><option value="oss">阿里云 OSS</option><option value="s3">兼容 S3</option></select></label>{config.provider === "local" ? <label className="grid gap-1 text-sm font-semibold">本地路径<input aria-label="本地存储路径" value={config.rootPath ?? ""} onChange={(event) => setConfig({ ...config, rootPath: event.target.value })} className="h-9 rounded border px-2 text-sm" /></label> : <><label className="grid gap-1 text-sm font-semibold">对象存储端点<input aria-label="对象存储端点" value={config.endpoint ?? ""} onChange={(event) => setConfig({ ...config, endpoint: event.target.value })} className="h-9 rounded border px-2 text-sm" /></label><label className="grid gap-1 text-sm font-semibold">Bucket<input aria-label="对象存储 Bucket" value={config.bucket ?? ""} onChange={(event) => setConfig({ ...config, bucket: event.target.value })} className="h-9 rounded border px-2 text-sm" /></label>{config.provider === "s3" ? <label className="grid gap-1 text-sm font-semibold">Region<input aria-label="对象存储 Region" value={config.region ?? ""} onChange={(event) => setConfig({ ...config, region: event.target.value })} className="h-9 rounded border px-2 text-sm" /></label> : null}<label className="grid gap-1 text-sm font-semibold">凭据引用<input aria-label="凭据引用" value={config.credentialRef ?? ""} onChange={(event) => setConfig({ ...config, credentialRef: event.target.value })} className="h-9 rounded border px-2 text-sm" /></label></>}<label className="grid gap-1 text-sm font-semibold">病毒扫描<select aria-label="病毒扫描状态" value={config.scan} onChange={(event) => setConfig({ ...config, scan: event.target.value as StorageConfig["scan"] })} className="h-9 rounded border px-2 text-sm"><option value="unconfigured">未配置（pending_scan）</option><option value="configured">已配置</option></select></label><button type="button" disabled={pending} onClick={() => void save()} className="h-9 w-fit rounded bg-[#0969da] px-3 text-sm font-semibold text-white disabled:opacity-50">{pending ? "保存中…" : "保存文件存储配置"}</button>{message ? <p role="status" className="text-sm text-[#57606a]">{message}</p> : null}</div>;
}
