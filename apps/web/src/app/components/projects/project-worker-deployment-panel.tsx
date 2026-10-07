"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel, StatusPill, WorkbenchButton } from "../workbench-ui";
import { workerRuntimeEnvironmentSchema, type WorkerRuntimeEnvironment } from "../../../lib/orchestration/worker-runtime-environment";
import { resolveProjectWorkerDeploymentConfiguration, type ProjectWorkerDeploymentConfiguration } from "../../../lib/orchestration/project-worker-deployment-configuration";

type WorkerPool = { id: string; displayName: string; status: "active" | "revoked" };
type WorkerResource = { poolId: string; repositoryUrl?: string; branchPolicy?: { allowedBranches: string[] } };
type WorkerImageSource = {
  id: string;
  ownerType: "platform" | "company";
  companyId: string | null;
  name: string;
  repository: string;
  versions: Array<{ id: string; tag: string; digest: string; publishedAt: string | null }>;
};
type Runtime = "docker" | "kubernetes";
type DeploymentResult = { runtime: Runtime; name: string; configVersion: number; commands: Array<{ operation: "deploy" | "update" | "uninstall"; command: string }> };

export type ProjectWorkerDeploymentApi = {
  loadPools(): Promise<WorkerPool[]>;
  loadImageSources?(): Promise<WorkerImageSource[]>;
  savePool(input: { expectedVersion: number; poolId: string }): Promise<{ version: number }>;
  saveImageVersion?(input: { expectedVersion: number; workerImageVersionId: string }): Promise<{ version: number; workerImageVersionId: string }>;
  saveDeploymentConfiguration?(input: { expectedVersion: number; configuration: ProjectWorkerDeploymentConfiguration }): Promise<{ version: number; environmentConfigurationVersion: number; configuration: ProjectWorkerDeploymentConfiguration }>;
  generateCommands(input: Record<string, unknown>): Promise<DeploymentResult>;
};

export function ProjectWorkerDeploymentPanel({
  projectId,
  projectShortCode,
  projectVersion,
  environmentConfigurationVersion,
  environmentConfiguration,
  deploymentConfiguration,
  workerResource,
  workerImageVersionId,
  api: suppliedApi,
}: {
  projectId: string;
  projectShortCode: string | null | undefined;
  projectVersion: number;
  environmentConfigurationVersion: number;
  environmentConfiguration?: unknown;
  deploymentConfiguration?: unknown;
  workerResource?: WorkerResource;
  workerImageVersionId?: string | null;
  api?: ProjectWorkerDeploymentApi;
}) {
  const api = useMemo(() => suppliedApi ?? createBrowserApi(projectId), [projectId, suppliedApi]);
  const [pools, setPools] = useState<WorkerPool[]>([]);
  const [imageSources, setImageSources] = useState<WorkerImageSource[]>([]);
  const [poolId, setPoolId] = useState(workerResource?.poolId ?? "");
  const [currentProjectVersion, setCurrentProjectVersion] = useState(projectVersion);
  const [runtime, setRuntime] = useState<Runtime>("docker");
  const initialDeployment = resolveProjectWorkerDeploymentConfiguration(deploymentConfiguration);
  const [namespace, setNamespace] = useState(initialDeployment.kubernetes.namespace);
  const [storageClass, setStorageClass] = useState(initialDeployment.kubernetes.storageClass ?? "");
  const [persistentStorage, setPersistentStorage] = useState(initialDeployment.kubernetes.persistentStorage);
  const [minReplicas, setMinReplicas] = useState(initialDeployment.kubernetes.minReplicas);
  const [maxReplicas, setMaxReplicas] = useState(initialDeployment.kubernetes.maxReplicas);
  const [reauthenticationPassword, setReauthenticationPassword] = useState("");
  const [concurrency, setConcurrency] = useState(initialDeployment.concurrency);
  const [sessionJournalRetentionDays, setSessionJournalRetentionDays] = useState(initialDeployment.sessionJournalRetentionDays);
  const [healthPort, setHealthPort] = useState(initialDeployment.healthPort);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>(initialDeployment.capabilities);
  const [currentEnvironmentConfigurationVersion, setCurrentEnvironmentConfigurationVersion] = useState(environmentConfigurationVersion);
  const runtimeEnvironment = readWorkerRuntimeEnvironment(environmentConfiguration);
  const [result, setResult] = useState<DeploymentResult | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [imageSourceId, setImageSourceId] = useState("");
  const [imageVersionId, setImageVersionId] = useState(workerImageVersionId ?? "");
  const platformImageSources = imageSources.filter((source) => source.ownerType === "platform");
  const companyImageSources = imageSources.filter((source) => source.ownerType === "company");

  useEffect(() => { void api.loadPools().then(setPools).catch(() => setNotice("无法加载 Worker Pool，请稍后重试。")); }, [api]);
  useEffect(() => {
    if (!api.loadImageSources) return;
    void api.loadImageSources().then((sources) => {
      setImageSources(sources);
      if (!workerImageVersionId) return;
      const source = sources.find((candidate) => candidate.versions.some((version) => version.id === workerImageVersionId));
      if (source) setImageSourceId(source.id);
    }).catch(() => setNotice("无法加载 Worker 镜像目录，请稍后重试。"));
  }, [api, workerImageVersionId]);

  async function savePool() {
    if (!poolId) { setNotice("请选择 Worker Pool。"); return; }
    setPending(true); setNotice(null);
    try {
      const result = await api.savePool({ expectedVersion: currentProjectVersion, poolId });
      setCurrentProjectVersion(result.version);
      setNotice("项目 Worker Pool 已保存。请继续生成部署命令。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "项目 Worker Pool 保存失败。"); }
    finally { setPending(false); }
  }

  async function generateCommands() {
    if (!poolId) { setNotice("请先选择 Worker Pool。镜像版本由项目已保存配置读取。"); return; }
    if (!reauthenticationPassword) { setNotice("生成部署命令前需要验证当前密码。"); return; }
    setPending(true); setNotice(null);
    try {
      const next = await api.generateCommands({ projectId, poolId, runtime, reauthenticationPassword });
      setResult(next);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Worker 部署命令生成失败。"); }
    finally { setPending(false); }
  }

  async function saveDeploymentConfiguration() {
    if (!api.saveDeploymentConfiguration) { setNotice("Worker 部署配置保存接口不可用。"); return; }
    setPending(true); setNotice(null);
    try {
      const configuration = resolveProjectWorkerDeploymentConfiguration({
        schemaVersion: 1,
        kubernetes: { namespace: namespace.trim(), ...(storageClass.trim() ? { storageClass: storageClass.trim() } : {}), persistentStorage: persistentStorage.trim(), minReplicas, maxReplicas },
        concurrency, sessionJournalRetentionDays, healthPort, capabilities,
      });
      const saved = await api.saveDeploymentConfiguration({ expectedVersion: currentProjectVersion, configuration });
      setCurrentProjectVersion(saved.version);
      setCurrentEnvironmentConfigurationVersion(saved.environmentConfigurationVersion);
      setNotice(`Worker 部署配置已保存（项目版本 ${saved.version}）。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Worker 部署配置保存失败。"); }
    finally { setPending(false); }
  }

  async function saveImageVersion() {
    if (!api.saveImageVersion || !imageVersionId) { setNotice("请选择 Worker 镜像版本。"); return; }
    setPending(true); setNotice(null);
    try {
      const saved = await api.saveImageVersion({ expectedVersion: currentProjectVersion, workerImageVersionId: imageVersionId });
      setCurrentProjectVersion(saved.version);
      setNotice(`Worker 镜像版本已保存（项目版本 ${saved.version}）。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Worker 镜像版本保存失败。"); }
    finally { setPending(false); }
  }

  const selectedImageVersion = imageSources.flatMap((source) => source.versions).find((version) => version.id === imageVersionId);

  async function copyCommand(operation: DeploymentResult["commands"][number]["operation"], command: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("浏览器不支持 Clipboard API");
      await navigator.clipboard.writeText(command);
      setNotice(`已复制${operation === "deploy" ? "部署" : operation === "update" ? "更新" : "卸载"}命令。`);
    } catch {
      setNotice("复制命令失败，请使用支持 Clipboard API 的安全浏览器上下文。");
    }
  }

  return <div className="grid gap-4">
    <Panel title="Worker Pool">
      <p className="mb-4 text-xs leading-5 text-[#57606a]">选择本项目可领取任务的 Worker Pool。Git 仓库与分支策略在“环境与凭证”中单独配置；Docker 固定复用同一 Worker，Kubernetes 可在共享存储的健康副本之间迁移。</p>
      <label className="grid max-w-xl gap-1 text-sm font-semibold">Worker Pool<select aria-label="项目 Worker Pool" value={poolId} onChange={(event) => setPoolId(event.currentTarget.value)} className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-normal"><option value="">选择 Worker Pool</option>{pools.filter((pool) => pool.status === "active").map((pool) => <option key={pool.id} value={pool.id}>{pool.displayName}</option>)}</select></label>
      <div className="mt-4"><WorkbenchButton type="button" size="small" onClick={() => void savePool()} disabled={pending}>保存 Worker Pool</WorkbenchButton></div>
    </Panel>
    <Panel title="Worker 部署命令">
      <div className="grid gap-3 sm:grid-cols-2"><fieldset className="flex gap-4"><legend className="mb-1 text-sm font-semibold">执行方式</legend><label className="text-sm"><input type="radio" name="runtime" checked={runtime === "docker"} onChange={() => setRuntime("docker")} /> Docker</label><label className="text-sm"><input type="radio" name="runtime" checked={runtime === "kubernetes"} onChange={() => setRuntime("kubernetes")} /> Kubernetes</label></fieldset><div className="grid gap-2 text-sm"><span className="font-semibold">Worker 镜像配置</span><select aria-label="Worker 镜像来源" value={imageSourceId} onChange={(event) => { setImageSourceId(event.currentTarget.value); setImageVersionId(""); }} className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm"><option value="">选择镜像来源</option>{platformImageSources.length > 0 ? <optgroup label="平台镜像">{platformImageSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</optgroup> : null}{companyImageSources.length > 0 ? <optgroup label="公司镜像">{companyImageSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</optgroup> : null}</select><select aria-label="Worker 镜像版本" value={imageVersionId} onChange={(event) => setImageVersionId(event.currentTarget.value)} disabled={!imageSourceId} className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm"><option value="">选择镜像版本</option>{imageSources.find((source) => source.id === imageSourceId)?.versions.map((version) => <option key={version.id} value={version.id}>{version.tag}</option>)}</select><input aria-label="Worker 镜像 Digest" value={selectedImageVersion?.digest ?? ""} readOnly className="rounded-md border border-[#d0d7de] bg-[#f6f8fa] px-3 py-2 font-mono text-xs" /><WorkbenchButton type="button" size="small" onClick={() => void saveImageVersion()} disabled={pending || !imageVersionId}>保存 Worker 镜像版本</WorkbenchButton><span className="text-xs font-normal text-[#57606a]">可选平台与本公司镜像目录；部署实际固定使用 Digest。</span></div>{runtime === "kubernetes" ? <><label className="grid gap-1 text-sm font-semibold">Namespace<input aria-label="Namespace" value={namespace} onChange={(event) => setNamespace(event.currentTarget.value)} className="rounded-md border border-[#d0d7de] px-3 py-2 text-sm font-normal" /></label><label className="grid gap-1 text-sm font-semibold">StorageClass（可选）<input aria-label="StorageClass" value={storageClass} onChange={(event) => setStorageClass(event.currentTarget.value)} className="rounded-md border border-[#d0d7de] px-3 py-2 text-sm font-normal" /></label><label className="grid gap-1 text-sm font-semibold">PVC 容量<input aria-label="PVC 容量" value={persistentStorage} onChange={(event) => setPersistentStorage(event.currentTarget.value)} className="rounded-md border border-[#d0d7de] px-3 py-2 text-sm font-normal" /></label><label className="grid gap-1 text-sm font-semibold">HPA 最小副本<input aria-label="HPA 最小副本" type="number" min={1} max={100} value={minReplicas} onChange={(event) => setMinReplicas(Number(event.currentTarget.value) || 1)} className="rounded-md border border-[#d0d7de] px-3 py-2 text-sm font-normal" /></label><label className="grid gap-1 text-sm font-semibold">HPA 最大副本<input aria-label="HPA 最大副本" type="number" min={1} max={100} value={maxReplicas} onChange={(event) => setMaxReplicas(Number(event.currentTarget.value) || 1)} className="rounded-md border border-[#d0d7de] px-3 py-2 text-sm font-normal" /></label></> : null}<label className="grid gap-1 text-sm font-semibold">最大并发任务<input aria-label="最大并发任务" type="number" min={1} max={128} value={concurrency} onChange={(event) => setConcurrency(Number(event.currentTarget.value) || 1)} className="rounded-md border border-[#d0d7de] px-3 py-2 text-sm font-normal" /></label><label className="grid gap-1 text-sm font-semibold">Worker 会话日志保留天数<input aria-label="Worker 会话日志保留天数" type="number" min={1} max={3650} value={sessionJournalRetentionDays} onChange={(event) => setSessionJournalRetentionDays(Number(event.currentTarget.value) || 30)} className="rounded-md border border-[#d0d7de] px-3 py-2 text-sm font-normal" /><span className="text-xs font-normal text-[#57606a]">默认 30 天，复用现有共享 PVC。</span></label><label className="grid gap-1 text-sm font-semibold">健康检查端口<input aria-label="健康检查端口" type="number" min={1} max={65535} value={healthPort} onChange={(event) => setHealthPort(Number(event.target.value) || 8080)} className="rounded-md border border-[#d0d7de] px-3 py-2 text-sm font-normal" /></label><fieldset className="grid gap-2 text-sm"><legend className="font-semibold">Worker 能力</legend><div className="flex flex-wrap gap-3">{["workspace", "files", "commands", "gpu", "unity", "unity_build"].map((capability) => <label key={capability} className="flex items-center gap-1 font-normal"><input type="checkbox" checked={capabilities[capability] === true} onChange={(event) => setCapabilities((current) => ({ ...current, [capability]: event.currentTarget.checked }))} />{capability}</label>)}</div></fieldset><div><WorkbenchButton type="button" size="small" onClick={() => void saveDeploymentConfiguration()} disabled={pending}>保存 Worker 部署配置</WorkbenchButton></div><label className="grid gap-1 text-sm font-semibold">账号当前密码<input aria-label="当前密码" type="password" autoComplete="current-password" value={reauthenticationPassword} onChange={(event) => setReauthenticationPassword(event.currentTarget.value)} className="rounded-md border border-[#d0d7de] px-3 py-2 text-sm font-normal" /></label></div>
      <p className="mt-3 text-xs leading-5 text-[#57606a]">平台只生成部署、更新、卸载命令。部署命令会一次性写入 Worker Pool 注册 Secret；请仅在可信终端执行并妥善保护输出。复制或生成命令不表示 Worker 已部署；执行后仍需通过注册、心跳、能力和无副作用 claim 验证。</p>
      <div className="mt-4"><WorkbenchButton type="button" size="small" variant="primary" onClick={() => void generateCommands()} disabled={pending}>生成部署命令</WorkbenchButton></div>
      {notice ? <p role="alert" className="mt-3 text-sm text-[#cf222e]">{notice}</p> : null}
      {result ? <section className="mt-4 grid gap-3 rounded-md border border-[#d0d7de] p-3"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{result.name}</strong><StatusPill tone="warning">命令已生成，尚未部署</StatusPill></div>{result.commands.map((item) => { const label = item.operation === "deploy" ? "部署" : item.operation === "update" ? "更新" : "卸载"; return <section key={item.operation} className="grid gap-2 text-xs font-semibold text-[#57606a]"><div className="flex items-center justify-between gap-2"><span>{label}</span><WorkbenchButton type="button" size="small" onClick={() => void copyCommand(item.operation, item.command)}>复制{label}命令</WorkbenchButton></div><pre data-testid={`worker-command-${item.operation}`} className="overflow-x-auto whitespace-pre rounded bg-[#f6f8fa] p-2 text-xs font-normal text-[#24292f]">{item.command}</pre></section>; })}</section> : null}
    </Panel>
  </div>;
}

function createBrowserApi(projectId: string): ProjectWorkerDeploymentApi {
  return {
    async loadPools() {
      const response = await fetch(`/api/worker-pools?projectId=${encodeURIComponent(projectId)}`);
      const body = await response.json() as { pools?: WorkerPool[] };
      if (!response.ok) throw new Error("无法加载 Worker Pool");
      return body.pools ?? [];
    },
    async loadImageSources() {
      const response = await fetch(`/api/worker-images/sources?projectId=${encodeURIComponent(projectId)}`);
      const body = await response.json() as { sources?: WorkerImageSource[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "无法加载 Worker 镜像目录");
      return body.sources ?? [];
    },
    async savePool(input) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: input.expectedVersion, workerPoolId: input.poolId }) });
      const body = await response.json() as { ok?: boolean; result?: { version: number }; error?: string };
      if (!response.ok || !body.ok || !body.result) throw new Error(body.error ?? "项目 Worker Pool 保存失败。");
      return body.result;
    },
    async saveImageVersion(input) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: input.expectedVersion, workerImageVersionId: input.workerImageVersionId }) });
      const body = await response.json() as { ok?: boolean; result?: { version: number; workerImageVersionId: string }; error?: string };
      if (!response.ok || !body.ok || !body.result) throw new Error(body.error ?? "Worker 镜像版本保存失败。");
      return body.result;
    },
    async generateCommands(input) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/worker-deployment-commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const body = await response.json() as { ok?: boolean; result?: DeploymentResult; error?: string };
      if (!response.ok || !body.ok || !body.result) throw new Error(body.error ?? "Worker 部署命令生成失败。");
      return body.result;
    },
    async saveDeploymentConfiguration(input) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: input.expectedVersion, workerDeploymentConfiguration: input.configuration }) });
      const body = await response.json() as { ok?: boolean; result?: { version: number; environmentConfigurationVersion: number; configuration: ProjectWorkerDeploymentConfiguration }; error?: string };
      if (!response.ok || !body.ok || !body.result) throw new Error(body.error ?? "Worker 部署配置保存失败。");
      return body.result;
    },
  };
}

function readWorkerRuntimeEnvironment(value: unknown): WorkerRuntimeEnvironment {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const result = workerRuntimeEnvironmentSchema.safeParse((value as { workerRuntime?: unknown }).workerRuntime);
    if (result.success) return result.data;
  }
  return { profile: "custom", mountPath: "/var/lib/humanthread", taskSubpath: "/tasks", variables: [] };
}
