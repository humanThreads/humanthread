"use client";

import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { DangerConfirmDialog } from "../settings-dialog";

type WorkerPool = {
  id: string;
  displayName: string;
  status: "active" | "revoked";
  maxConcurrentRuns: number;
  configuration: Record<string, unknown>;
  health?: "idle" | "running" | "degraded" | "offline" | "revoked";
  capacity?: number;
  currentRuns?: number;
  lastSeenAt?: string | null;
  runtime?: "docker" | "kubernetes";
  taskGroupName?: string | null;
  aliveInstanceCount?: number;
  instances?: WorkerPoolInstance[];
};

type WorkerPoolInstance = {
  instanceId: string;
  health: NonNullable<WorkerPool["health"]>;
  requestedConcurrency: number;
  currentRuns: number;
  lastSeenAt: string | null;
};

type WorkerModelSite = {
  id: string;
  name: string;
  endpoint: string;
  status: "active" | "revoked";
  models?: Array<{ name: string; label: string }>;
};

function formatModelCatalogue(models: WorkerModelSite["models"]): string {
  return (models ?? []).map((model) => `${model.name}=${model.label}`).join("\n");
}

// One "name=label" per line. A missing or blank label is rejected so a model
// can never be selectable without a human-readable name.
function parseModelCatalogue(value: string): Array<{ name: string; label: string }> {
  const models = value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    const name = separator < 0 ? "" : line.slice(0, separator).trim();
    const label = separator < 0 ? "" : line.slice(separator + 1).trim();
    return { name, label };
  });
  if (models.some((model) => !model.name || !model.label)) {
    throw new Error("模型清单格式应为每行 name=显示名称");
  }
  if (new Set(models.map((model) => model.name)).size !== models.length) {
    throw new Error("模型清单中存在重复的模型名称");
  }
  return models;
}

async function request(path: string, options?: RequestInit): Promise<unknown> {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "Worker Pool 请求失败");
  return payload;
}

const HEALTH_LABELS: Record<NonNullable<WorkerPool["health"]>, string> = {
  idle: "空闲",
  running: "运行中",
  degraded: "异常",
  offline: "离线",
  revoked: "已撤销",
};

function displayLastSeen(value: string | null | undefined): string {
  if (!value) return "未在线";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "未在线";
  return parsed.toISOString().replace("T", " ").replace(".000Z", "");
}

export function WorkerPoolSettings({ companyId }: { companyId?: string; projectId?: string }) {
  const companyQuery = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
  const companyPayload = companyId ? { companyId } : {};
  const [pools, setPools] = useState<WorkerPool[]>([]);
  const [modelSites, setModelSites] = useState<WorkerModelSite[]>([]);
  const [name, setName] = useState("");
  const [concurrency, setConcurrency] = useState(1);
  const [modelSiteName, setModelSiteName] = useState("");
  const [modelSiteEndpoint, setModelSiteEndpoint] = useState("");
  const [modelSiteApiKey, setModelSiteApiKey] = useState("");
  const [modelSiteModels, setModelSiteModels] = useState("");
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [editingModels, setEditingModels] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [revealPoolId, setRevealPoolId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void Promise.all([request(`/api/worker-pools${companyQuery}`), request(`/api/worker-model-sites${companyQuery}`)]).then(([poolPayload, sitePayload]) => {
      const pools = poolPayload && typeof poolPayload === "object" && Array.isArray(Reflect.get(poolPayload, "pools"))
        ? Reflect.get(poolPayload, "pools") as WorkerPool[] : [];
      const modelSites = sitePayload && typeof sitePayload === "object" && Array.isArray(Reflect.get(sitePayload, "result"))
        ? Reflect.get(sitePayload, "result") as WorkerModelSite[] : [];
      setPools(pools);
      setModelSites(modelSites);
    }).catch((error) => setNotice(error instanceof Error ? error.message : "无法加载 Linux Worker 配置"));
  }, [companyQuery]);

  async function createPool() {
    if (!name.trim()) return;
    setPending(true); setNotice(null);
    try {
      const payload = await request("/api/worker-pools", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: name.trim(), maxConcurrentRuns: concurrency, configuration: {}, ...companyPayload }),
      }) as { pool?: WorkerPool; bootstrapToken?: string };
      if (payload.pool) setPools((current) => [...current, payload.pool!]);
      setIssuedToken(typeof payload.bootstrapToken === "string" ? payload.bootstrapToken : null);
      setName("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "无法创建 Worker Pool"); }
    finally { setPending(false); }
  }

  async function reveal() {
    if (!revealPoolId || !password) return;
    setPending(true); setNotice(null);
    try {
      const payload = await request(`/api/worker-pools/${encodeURIComponent(revealPoolId)}/token`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reveal", password, ...companyPayload }),
      }) as { bootstrapToken?: string };
      setIssuedToken(typeof payload.bootstrapToken === "string" ? payload.bootstrapToken : null);
      setPassword(""); setRevealPoolId(null);
    } catch (error) { setNotice(error instanceof Error ? error.message : "无法显示 Token"); }
    finally { setPending(false); }
  }

  async function createModelSite() {
    if (!modelSiteName.trim() || !modelSiteEndpoint.trim() || !modelSiteApiKey) return;
    let models: Array<{ name: string; label: string }>;
    try { models = parseModelCatalogue(modelSiteModels); }
    catch (error) { setNotice(error instanceof Error ? error.message : "模型清单格式无效"); return; }
    setPending(true); setNotice(null);
    try {
      const payload = await request("/api/worker-model-sites", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: modelSiteName.trim(), endpoint: modelSiteEndpoint.trim(), apiKey: modelSiteApiKey, models, ...companyPayload }),
      }) as { result?: WorkerModelSite };
      if (payload.result) setModelSites((current) => [...current, payload.result!]);
      setModelSiteName("");
      setModelSiteEndpoint("");
      setModelSiteApiKey("");
      setModelSiteModels("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "无法保存模型站点"); }
    finally { setPending(false); }
  }

  function editSiteModels(site: WorkerModelSite) {
    setEditingSiteId(site.id);
    setEditingModels(formatModelCatalogue(site.models));
    setNotice(null);
  }

  async function saveSiteModels(site: WorkerModelSite) {
    let models: Array<{ name: string; label: string }>;
    try { models = parseModelCatalogue(editingModels); }
    catch (error) { setNotice(error instanceof Error ? error.message : "模型清单格式无效"); return; }
    setPending(true); setNotice(null);
    try {
      const payload = await request(`/api/worker-model-sites/${encodeURIComponent(site.id)}${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ models }),
      }) as { result?: WorkerModelSite };
      if (payload.result) setModelSites((current) => current.map((item) => item.id === site.id ? { ...item, ...payload.result! } : item));
      setEditingSiteId(null);
    } catch (error) { setNotice(error instanceof Error ? error.message : "无法更新站点模型"); }
    finally { setPending(false); }
  }

  async function revokePool(pool: WorkerPool) {
    await request(`/api/worker-pools/${encodeURIComponent(pool.id)}${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`, { method: "DELETE" });
    setPools((current) => current.filter((item) => item.id !== pool.id));
  }

  async function revokeModelSite(site: WorkerModelSite) {
    await request(`/api/worker-model-sites/${encodeURIComponent(site.id)}${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`, { method: "DELETE" });
    setModelSites((current) => current.filter((item) => item.id !== site.id));
  }

  return <section className="border-y border-[#d0d7de] bg-white">
    <header className="border-b border-[#d0d7de] px-4 py-3"><h2 className="text-sm font-semibold text-[#24292f]">Linux Worker Pool</h2><p className="mt-1 text-xs text-[#57606a]">{companyId ? "资源仅供本公司项目调度。" : "资源仅供当前用户的个人项目调度。"} 模型站点 Key 仅加密保存，运行时凭据不会回显。</p></header>
    <div className="grid gap-4 p-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-end">
        <label className="text-xs font-medium text-[#57606a]">Worker Pool 名称<input aria-label="Worker Pool 名称" value={name} onChange={(event) => setName(event.currentTarget.value)} className="mt-1 w-full border border-[#d0d7de] px-2 py-2 text-sm text-[#24292f]" /></label>
        <label className="text-xs font-medium text-[#57606a]">最大并发<input aria-label="最大并发" type="number" min={1} max={128} value={concurrency} onChange={(event) => setConcurrency(Math.min(128, Math.max(1, Number(event.currentTarget.value) || 1)))} className="mt-1 w-full border border-[#d0d7de] px-2 py-2 text-sm text-[#24292f]" /></label>
        <button type="button" disabled={pending || !name.trim()} onClick={() => void createPool()} className="border border-[#0969da] bg-[#0969da] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">创建 Worker Pool</button>
      </div>
      {issuedToken ? <div className="border border-[#9a6700] bg-[#fff8c5] px-3 py-2 text-xs text-[#24292f]"><code className="break-all">{issuedToken}</code></div> : null}
      {notice ? <p role="alert" className="text-xs text-[#cf222e]">{notice}</p> : null}
      <div className="divide-y divide-[#d8dee4] border-y border-[#d8dee4]">{pools.length === 0 ? <p className="px-3 py-3 text-sm text-[#57606a]">尚无 Worker Pool</p> : pools.map((pool) => <div key={pool.id}>
        <div className="flex flex-wrap items-center gap-3 px-3 py-3"><strong className="mr-auto text-sm text-[#24292f]">{pool.displayName}</strong><span className="text-xs text-[#57606a]">运行/容量 {pool.currentRuns ?? 0}/{pool.capacity ?? 0}</span><span className="text-xs text-[#57606a]">运行 {pool.currentRuns ?? 0}</span><span className="text-xs text-[#57606a]">{pool.health ? HEALTH_LABELS[pool.health] : pool.status === "active" ? "离线" : "已撤销"}</span><span className="text-xs text-[#57606a]">最近在线 {displayLastSeen(pool.lastSeenAt)}</span>{pool.runtime === "kubernetes" ? <><span className="text-xs text-[#57606a]">Kubernetes 任务组 {pool.taskGroupName ?? pool.displayName}</span><span className="text-xs text-[#57606a]">存活实例 {pool.aliveInstanceCount ?? 0}</span></> : <span className="text-xs text-[#57606a]">实例 {pool.instances?.length ?? 0}</span>}{pool.status === "active" ? <><button type="button" onClick={() => { setRevealPoolId(pool.id); setIssuedToken(null); }} className="text-xs font-semibold text-[#0969da]">显示 Token</button><DangerConfirmDialog triggerLabel={`删除 Worker Pool ${pool.displayName}`} triggerIcon={<Trash2 size={14} aria-hidden="true" />} triggerSize="small" title="删除 Worker Pool" description={`删除后 ${pool.displayName} 将立即撤销连接，不能再接收新任务。历史 Loop 绑定会保留。`} actionLabel="确认删除 Worker Pool" onConfirm={() => revokePool(pool)} /></> : null}</div>
        {(pool.instances?.length ?? 0) > 0 ? <div className="grid divide-y divide-[#d8dee4] bg-[#f6f8fa] px-3">{pool.instances?.map((instance) => <div key={instance.instanceId} className="flex flex-wrap items-center gap-3 py-2 text-xs text-[#57606a]"><strong className="mr-auto font-medium text-[#24292f]">{instance.instanceId}</strong><span>运行/容量 {instance.currentRuns}/{instance.requestedConcurrency}</span><span>{HEALTH_LABELS[instance.health]}</span><span>最近在线 {displayLastSeen(instance.lastSeenAt)}</span></div>)}</div> : null}
      </div>)}</div>
      {revealPoolId ? <div className="grid gap-3 border border-[#d0d7de] p-3 sm:grid-cols-[minmax(0,1fr)_auto]"><label className="text-xs font-medium text-[#57606a]">当前密码<input aria-label="当前密码" type="password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} className="mt-1 w-full border border-[#d0d7de] px-2 py-2 text-sm text-[#24292f]" /></label><button type="button" disabled={pending || !password} onClick={() => void reveal()} className="self-end border border-[#0969da] px-3 py-2 text-sm font-semibold text-[#0969da] disabled:opacity-50">确认显示</button></div> : null}
      <section className="border-t border-[#d0d7de] pt-4">
        <h3 className="text-sm font-semibold text-[#24292f]">Worker 模型站点</h3>
        <p className="mt-1 text-xs text-[#57606a]">模型清单每行填写 <code>模型名称=显示名称</code>，例如 <code>gpt-5.6-terra=GPT-5.6 Terra</code>。只有清单中的模型才能在创建会话时选择。</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <label className="text-xs font-medium text-[#57606a]">名称<input aria-label="模型站点名称" value={modelSiteName} onChange={(event) => setModelSiteName(event.currentTarget.value)} className="mt-1 w-full border border-[#d0d7de] px-2 py-2 text-sm text-[#24292f]" /></label>
          <label className="text-xs font-medium text-[#57606a]">端点 URL<input aria-label="模型站点 URL" value={modelSiteEndpoint} onChange={(event) => setModelSiteEndpoint(event.currentTarget.value)} className="mt-1 w-full border border-[#d0d7de] px-2 py-2 text-sm text-[#24292f]" /></label>
          <label className="text-xs font-medium text-[#57606a]">API Key<input aria-label="模型站点 Key" type="password" autoComplete="off" value={modelSiteApiKey} onChange={(event) => setModelSiteApiKey(event.currentTarget.value)} className="mt-1 w-full border border-[#d0d7de] px-2 py-2 text-sm text-[#24292f]" /></label>
          <button type="button" disabled={pending || !modelSiteName.trim() || !modelSiteEndpoint.trim() || !modelSiteApiKey} onClick={() => void createModelSite()} className="border border-[#0969da] px-3 py-2 text-sm font-semibold text-[#0969da] disabled:opacity-50">保存模型站点</button>
        </div>
        <label className="mt-3 grid gap-1 text-xs font-medium text-[#57606a]">模型清单（可选）
          <textarea aria-label="模型站点模型清单" rows={3} value={modelSiteModels} onChange={(event) => setModelSiteModels(event.currentTarget.value)} placeholder={"gpt-5.6-terra=GPT-5.6 Terra"} className="w-full border border-[#d0d7de] px-2 py-2 font-mono text-sm text-[#24292f]" />
        </label>
        <div className="mt-3 divide-y divide-[#d8dee4] border-y border-[#d8dee4]">{modelSites.length === 0 ? <p className="px-3 py-3 text-sm text-[#57606a]">尚无模型站点</p> : modelSites.map((site) => <div key={site.id}>
          <div className="flex flex-wrap items-center gap-3 px-3 py-3">
            <strong className="text-sm text-[#24292f]">{site.name}</strong>
            <span className="mr-auto break-all text-xs text-[#57606a]">{site.endpoint}</span>
            <span className="text-xs text-[#57606a]">{(site.models?.length ?? 0) === 0 ? "未配置模型" : `${site.models!.length} 个模型`}</span>
            <span className="text-xs text-[#57606a]">{site.status === "active" ? "可用" : "已撤销"}</span>
            {site.status === "active" ? <>
              <button type="button" aria-label={`配置站点模型 ${site.name}`} onClick={() => editSiteModels(site)} className="text-xs font-semibold text-[#0969da]"><Pencil aria-hidden="true" size={12} className="inline" /> 配置模型</button>
              <DangerConfirmDialog triggerLabel={`删除模型站点 ${site.name}`} triggerIcon={<Trash2 size={14} aria-hidden="true" />} triggerSize="small" title="删除模型站点" description={`删除后 ${site.name} 将不能再用于新的 Loop 配置，历史配置会保留。`} actionLabel="确认删除模型站点" onConfirm={() => revokeModelSite(site)} />
            </> : null}
          </div>
          {site.status === "active" && (site.models?.length ?? 0) > 0 ? <div className="flex flex-wrap gap-2 px-3 pb-3">{site.models!.map((model) => <span key={model.name} className="border border-[#d8dee4] bg-[#f6f8fa] px-2 py-1 text-xs text-[#57606a]"><code>{model.name}</code> · <span>{model.label}</span></span>)}</div> : null}
          {editingSiteId === site.id ? <div className="grid gap-2 border-t border-[#d8dee4] bg-[#f6f8fa] px-3 py-3">
            <label className="grid gap-1 text-xs font-medium text-[#57606a]">模型清单（每行 name=显示名称）
              <textarea aria-label={`站点模型清单 ${site.name}`} rows={4} value={editingModels} onChange={(event) => setEditingModels(event.currentTarget.value)} placeholder={"gpt-5.6-terra=GPT-5.6 Terra"} className="w-full border border-[#d0d7de] px-2 py-2 font-mono text-sm text-[#24292f]" />
            </label>
            <div className="flex gap-2">
              <button type="button" disabled={pending} aria-label={`保存站点模型 ${site.name}`} onClick={() => void saveSiteModels(site)} className="border border-[#0969da] bg-[#0969da] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">保存</button>
              <button type="button" disabled={pending} onClick={() => setEditingSiteId(null)} className="border border-[#d0d7de] px-3 py-2 text-sm font-semibold text-[#57606a] disabled:opacity-50">取消</button>
            </div>
          </div> : null}
        </div>)}</div>
      </section>
    </div>
  </section>;
}
