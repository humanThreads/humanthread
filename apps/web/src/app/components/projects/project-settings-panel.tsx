"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Panel, WorkbenchButton } from "../workbench-ui";
import { DevelopmentTemplateLoopPreviews, normalizeDevelopmentTemplateLoopVersions, type DevelopmentTemplateLoopPreview } from "./development-template-loop-previews";
import { ProjectRepositoryCredentialWizard } from "./project-repository-credential-wizard";
import { ProjectWorkerRuntimeEnvironment } from "./project-worker-runtime-environment";
import { workerRuntimeEnvironmentSchema, type WorkerRuntimeEnvironment } from "../../../lib/orchestration/worker-runtime-environment";

export function ProjectSettingsPanel({
  projectId,
  spaceId,
  shortCode,
  version,
  canEdit,
  developmentTemplateKey,
  developmentTemplateVersion,
  developmentTemplateConfig,
  productionBranch,
  stagingBranch,
  releaseAgentProfileId,
  developmentLoopVersionId,
  releaseLoopVersionId,
  environmentConfiguration,
  environmentConfigurationVersion,
  workerResource,
  section = "all",
}: {
  projectId: string;
  spaceId: string;
  shortCode: string | null | undefined;
  version: number;
  canEdit: boolean;
  developmentTemplateKey: string | null;
  developmentTemplateVersion: number | null;
  developmentTemplateConfig: unknown;
  productionBranch: string | null;
  stagingBranch: string | null;
  releaseAgentProfileId: string | null;
  developmentLoopVersionId?: string | null;
  releaseLoopVersionId?: string | null;
  environmentConfiguration?: unknown;
  environmentConfigurationVersion?: number;
  workerResource?: { repositoryUrl: string; branchPolicy: { allowedBranches: string[] } };
  section?: "all" | "short-code" | "environment";
}) {
  const router = useRouter();
  const [value, setValue] = useState(shortCode ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [developmentError, setDevelopmentError] = useState<string | null>(null);
  const [developmentPending, setDevelopmentPending] = useState(false);
  const [upgradeConfirmed, setUpgradeConfirmed] = useState(false);
  const [templates, setTemplates] = useState<Array<{
    key: string;
    kind?: string;
    name: string;
    version: number;
    executionPolicy?: Record<string, unknown>;
    triggerPolicy?: Record<string, unknown>;
    developmentLoopVersionId?: string | null;
    releaseLoopVersionId?: string | null;
  }>>([]);
  const [loopVersions, setLoopVersions] = useState<DevelopmentTemplateLoopPreview[]>([]);
  const [releaseAgents, setReleaseAgents] = useState<Array<{ id: string; name: string; provider: string }>>([]);
  const [templateKey, setTemplateKey] = useState(developmentTemplateKey ?? "");
  const [templateVersion, setTemplateVersion] = useState(developmentTemplateVersion ?? 1);
  const [production, setProduction] = useState(productionBranch ?? readConfigString(developmentTemplateConfig, "productionBranch"));
  const [staging, setStaging] = useState(stagingBranch ?? readConfigString(developmentTemplateConfig, "stagingBranch"));
  const [releaseAgent, setReleaseAgent] = useState(releaseAgentProfileId ?? readConfigString(developmentTemplateConfig, "releaseAgentProfileId"));
  const initialEnvironment = readEnvironmentConfiguration(environmentConfiguration);
  const [environmentEntries, setEnvironmentEntries] = useState(initialEnvironment.entries);
  const [workerRuntime, setWorkerRuntime] = useState<WorkerRuntimeEnvironment | undefined>(initialEnvironment.workerRuntime);
  const [environmentPending, setEnvironmentPending] = useState(false);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  const [editingEnvironmentIndex, setEditingEnvironmentIndex] = useState<number | null>(null);
  const [environmentDraft, setEnvironmentDraft] = useState<EnvironmentEntry>(() => emptyEnvironmentEntry());
  const [managedSecrets, setManagedSecrets] = useState<ManagedSecret[]>([]);
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [secretPending, setSecretPending] = useState<string | null>(null);
  const developmentConfigured = Boolean(developmentTemplateKey);

  useEffect(() => {
    if (!canEdit || !spaceId || section !== "all") return;
    const controller = new AbortController();
    void fetch(`/api/development-templates?spaceId=${encodeURIComponent(spaceId)}&projectId=${encodeURIComponent(projectId)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.clone().json() as { ok: boolean; result?: { templates?: Array<{ key: string; kind?: string; name: string; version: number; executionPolicy?: Record<string, unknown>; triggerPolicy?: Record<string, unknown>; developmentLoopVersionId?: string | null; releaseLoopVersionId?: string | null }>; loopVersions?: DevelopmentTemplateLoopPreview[]; agentProfiles?: Array<{ id: string; name: string; provider: string }> }; error?: string };
        if (!response.ok || !body.ok) throw new Error(body.error ?? "开发模板加载失败");
        setTemplates(body.result?.templates ?? []);
        setLoopVersions(normalizeDevelopmentTemplateLoopVersions(body.result?.loopVersions));
        setReleaseAgents(body.result?.agentProfiles ?? []);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setDevelopmentError(cause instanceof Error ? cause.message : "开发模板加载失败");
      });
    return () => controller.abort();
  }, [canEdit, projectId, section, spaceId]);

  useEffect(() => {
    if (!canEdit || !projectId || section !== "environment") return;
    const controller = new AbortController();
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/environment-secrets`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { ok?: boolean; result?: ManagedSecret[]; error?: string };
        if (!response.ok || !body.ok) throw new Error(body.error ?? "托管凭证加载失败");
        const secrets = Array.isArray(body.result) ? body.result : [];
        setManagedSecrets(secrets);
        const configuredNames = new Set(secrets.filter((secret) => secret.status === "configured").map((secret) => secret.name));
        setEnvironmentEntries((current) => current.map((entry) => entry.sourceType === "humanthread" && configuredNames.has(entry.name) ? { ...entry, status: "configured" } : entry));
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setEnvironmentError(cause instanceof Error ? cause.message : "托管凭证加载失败");
      });
    return () => controller.abort();
  }, [canEdit, projectId, section]);

  if (!canEdit) return null;
  const activeTemplate = selectedTemplate(templates, developmentTemplateKey ?? "", developmentTemplateVersion ?? 0);
  const persistedPrevious = { developmentLoopVersionId, releaseLoopVersionId };
  const selected = selectedTemplate(templates, templateKey, templateVersion);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shortCode: value, expectedVersion: version }),
      });
      const body = await response.json() as { error?: string; code?: string };
      if (!response.ok) throw new Error(body.error ?? (body.code === "version_conflict" ? "项目已被其他人更新，请刷新后重试。" : "项目简称保存失败。"));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "项目简称保存失败。");
    } finally {
      setPending(false);
    }
  }

  async function submitDevelopmentMode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (developmentPending) return;
    if (!templateKey || !production.trim() || !staging.trim() || !releaseAgent) {
      setDevelopmentError("请填写开发模式、生产分支、预发分支和发版 Agent。");
      return;
    }
    if (production.trim() === staging.trim()) {
      setDevelopmentError("预发分支不能与生产分支相同。");
      return;
    }
    if (developmentConfigured && !upgradeConfirmed) {
      setUpgradeConfirmed(true);
      setDevelopmentError(null);
      return;
    }
    setDevelopmentPending(true);
    setDevelopmentError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(developmentConfigured ? {
          expectedVersion: version,
          developmentTemplateUpgrade: {
            key: templateKey,
            version: templateVersion,
            config: { productionBranch: production.trim(), stagingBranch: staging.trim(), releaseAgentProfileId: releaseAgent, taskBranchPattern: "{year}-{shortId}" },
          },
        } : {
          developmentTemplateKey: templateKey,
          developmentTemplateVersion: templateVersion,
          developmentTemplateConfig: { productionBranch: production.trim(), stagingBranch: staging.trim(), releaseAgentProfileId: releaseAgent, taskBranchPattern: "{year}-{shortId}" },
          expectedVersion: version,
        }),
      });
      const body = await response.json() as { ok: boolean; error?: string; code?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? (body.code === "version_conflict" ? "项目已被其他人更新，请刷新后重试。" : "开发模式保存失败。"));
      router.refresh();
    } catch (cause) {
      setDevelopmentError(cause instanceof Error ? cause.message : "开发模式保存失败。");
    } finally {
      setDevelopmentPending(false);
    }
  }

  async function submitEnvironment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEnvironmentPending(true); setEnvironmentError(null);
    try {
      const entries = environmentEntries.map(({ id, ...entry }) => id && /^[a-f0-9]{32}$/u.test(id) ? { id, ...entry } : entry);
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: version, environmentConfiguration: { schemaVersion: 1, entries, ...(workerRuntime ? { workerRuntime } : {}) } }) });
      const body = await response.json() as { ok: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "环境配置保存失败");
      router.refresh();
    } catch (cause) { setEnvironmentError(cause instanceof Error ? cause.message : "环境配置保存失败"); }
    finally { setEnvironmentPending(false); }
  }

  function editEnvironment(index: number) {
    setEditingEnvironmentIndex(index);
    setEnvironmentDraft(environmentEntries[index] ?? emptyEnvironmentEntry());
  }

  function saveEnvironmentDraft() {
    const name = environmentDraft.name.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/u.test(name) || !environmentDraft.purpose.trim() || !environmentDraft.reference.trim() || environmentDraft.executionTargets.length === 0) {
      setEnvironmentError("请填写有效的变量名、用途、执行端与来源引用。");
      return;
    }
    const next = { ...environmentDraft, name, purpose: environmentDraft.purpose.trim(), reference: environmentDraft.reference.trim() };
    setEnvironmentEntries((current) => editingEnvironmentIndex === null ? [...current, next] : current.map((entry, index) => index === editingEnvironmentIndex ? next : entry));
    setEditingEnvironmentIndex(null); setEnvironmentDraft(emptyEnvironmentEntry()); setEnvironmentError(null);
  }

  async function saveManagedSecret(name: string) {
    const normalizedName = name.trim().toUpperCase();
    const secretValue = secretValues[normalizedName]?.trim() ?? "";
    if (!secretValue) {
      setEnvironmentError(`请输入 ${normalizedName} 的凭证值。`);
      return;
    }
    const existing = managedSecrets.some((secret) => secret.name === normalizedName && secret.status === "configured");
    setSecretPending(normalizedName); setEnvironmentError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/environment-secrets`, {
        method: existing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: normalizedName, value: secretValue }),
      });
      const body = await response.json() as { ok?: boolean; result?: ManagedSecret; error?: string };
      if (!response.ok || !body.ok || !body.result) throw new Error(body.error ?? "托管凭证保存失败");
      setManagedSecrets((current) => [...current.filter((secret) => secret.name !== normalizedName), body.result!].sort((a, b) => a.name.localeCompare(b.name)));
      setEnvironmentEntries((current) => current.map((entry) => entry.name === normalizedName ? { ...entry, status: "configured" } : entry));
      setSecretValues((current) => ({ ...current, [normalizedName]: "" }));
    } catch (cause) {
      setEnvironmentError(cause instanceof Error ? cause.message : "托管凭证保存失败");
    } finally { setSecretPending(null); }
  }

  return (
    <div className="grid gap-4">
      {(section === "all" || section === "short-code") ? <Panel title="项目设置">
        <form className="grid gap-4" onSubmit={submit}>
        <label className="grid max-w-md gap-1.5 text-sm font-semibold text-[#24292f]" htmlFor="project-short-code">
          项目简称
          <input id="project-short-code" aria-label="项目简称" aria-describedby="project-short-code-help" value={value} onChange={(event) => setValue(event.target.value.toUpperCase().replace(/[^A-Z0-9]/gu, "").slice(0, 12))} disabled={pending} className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#0969da] focus:ring-2 focus:ring-[#0969da33] disabled:bg-[#f6f8fa]" required minLength={2} maxLength={12} />
          <span id="project-short-code-help" className="font-normal text-xs leading-5 text-[#57606a]">2-12 位大写字母或数字；同一 Team 内不能重复。</span>
        </label>
        {error ? <p role="alert" className="text-sm text-[#cf222e]">{error}</p> : null}
        <div>
          <WorkbenchButton type="submit" size="small" variant="primary" disabled={pending || value.trim().length < 2}>
            {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" size={14} aria-hidden="true" /> : null}
            {pending ? "保存中" : "保存简称"}
          </WorkbenchButton>
        </div>
        </form>
      </Panel> : null}
      {section === "all" ? <Panel title="开发模式">
        {developmentConfigured ? <div className="grid gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{developmentTemplateKey === "branch-development" ? "分支开发" : developmentTemplateKey}</span><span className="rounded-full bg-[#dafbe1] px-2 py-0.5 text-xs font-semibold text-[#1a7f37]">已配置</span></div>
          <dl className="grid gap-2 sm:grid-cols-3"><div><dt className="text-xs text-[#57606a]">生产分支</dt><dd className="font-mono text-[#24292f]">{productionBranch ?? "未设置"}</dd></div><div><dt className="text-xs text-[#57606a]">预发分支</dt><dd className="font-mono text-[#24292f]">{stagingBranch ?? "未设置"}</dd></div><div><dt className="text-xs text-[#57606a]">发版 Agent</dt><dd className="text-[#24292f]">{releaseAgents.find((agent) => agent.id === releaseAgentProfileId)?.name ?? releaseAgentProfileId ?? "未设置"}</dd></div></dl>
          <p className="text-xs leading-5 text-[#57606a]">该项目已绑定任务开发 Loop 和里程碑 Loop。配置变更只影响后续新运行，不会修改已经创建的 Loop 运行。</p>
        </div> : null}
        <form className="mt-4 grid gap-4 border-t border-[#d8dee4] pt-4" onSubmit={(event) => void submitDevelopmentMode(event)}>
          <div className="grid gap-2 border border-[#d0d7de] bg-[#f6f8fa] p-3 text-sm leading-5 text-[#57606a]">
            <p><strong className="text-[#24292f]">开发模式是什么？</strong>它是一组项目级约束，决定任务分支规则、预发合并方式、业务测试和生产发布门禁。初始化后会一次性绑定两个 Loop，后续按模板执行。</p>
            {selectedTemplate(templates, templateKey, templateVersion)?.kind === "branch-development" ? <p><strong className="text-[#24292f]">分支开发模式会做什么？</strong>每个任务在独立的 <code className="font-mono text-[#24292f]">{"{year}-{shortId}"}</code> 分支完成并测试，不直接进入预发；里程碑发版时，系统逐一合入任务分支、处理冲突、重跑业务测试，人工确认通过后才进入生产。</p> : <p><strong className="text-[#24292f]">当前模板会做什么？</strong>它会按模板定义初始化项目约束，并绑定对应的 Loop；选择模板后，下方会显示该模板的分支、集成和触发策略。</p>}
          </div>
          <label className="grid max-w-md gap-1.5 text-sm font-semibold" htmlFor="project-development-template">开发模式<select id="project-development-template" aria-label="开发模式" value={templateKey ? templateOptionValue(templateKey, templateVersion) : ""} onChange={(event) => { const template = templates.find((candidate) => templateOptionValue(candidate.key, candidate.version) === event.target.value); setTemplateKey(template?.key ?? ""); setTemplateVersion(template?.version ?? 1); setUpgradeConfirmed(false); }} disabled={developmentPending} className="h-10 rounded-md border border-[#d0d7de] bg-white px-3 text-sm font-normal"><option value="">请选择</option>{templates.map((template) => <option key={`${template.key}:${template.version}`} value={templateOptionValue(template.key, template.version)}>{template.name}</option>)}</select></label>
          {selected ? <><TemplatePreview template={selected} /><DevelopmentTemplateLoopPreviews template={selected} loopVersions={loopVersions} /></> : <p className="text-xs text-[#57606a]">请选择一个模板查看它的具体约束，再填写分支和发版 Agent。</p>}
          <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold" htmlFor="project-production-branch">生产分支<input id="project-production-branch" aria-label="生产分支" value={production} onChange={(event) => setProduction(event.target.value)} disabled={developmentPending} className="h-10 rounded-md border border-[#d0d7de] bg-white px-3 font-mono text-sm font-normal" /></label><label className="grid gap-1.5 text-sm font-semibold" htmlFor="project-staging-branch">预发分支<input id="project-staging-branch" aria-label="预发分支" value={staging} onChange={(event) => setStaging(event.target.value)} disabled={developmentPending} className="h-10 rounded-md border border-[#d0d7de] bg-white px-3 font-mono text-sm font-normal" /></label></div>
          <label className="grid max-w-md gap-1.5 text-sm font-semibold" htmlFor="project-release-agent">发版 Agent<select id="project-release-agent" aria-label="发版 Agent" value={releaseAgent} onChange={(event) => setReleaseAgent(event.target.value)} disabled={developmentPending} className="h-10 rounded-md border border-[#d0d7de] bg-white px-3 text-sm font-normal"><option value="">请选择</option>{releaseAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.provider}</option>)}</select></label>
          {developmentError ? <p role="alert" className="text-sm text-[#cf222e]">{developmentError}</p> : null}
          {developmentConfigured && upgradeConfirmed ? <UpgradeDisclosure previous={activeTemplate} next={selected} persistedPrevious={persistedPrevious} loopVersions={loopVersions} /> : null}
          <div><WorkbenchButton type="submit" size="small" variant="primary" disabled={developmentPending || !templates.length}>{developmentPending ? "保存中" : developmentConfigured ? upgradeConfirmed ? "确认升级" : "准备升级" : "初始化开发模式"}</WorkbenchButton></div>
        </form>
      </Panel> : null}
      {(section === "all" || section === "environment") ? <Panel title="环境配置">
        <form className="grid gap-3" onSubmit={(event) => void submitEnvironment(event)}>
          <p className="text-xs leading-5 text-[#57606a]">项目只维护一套环境配置。这里保存变量名、用途、执行端、来源和状态，不保存 Token、密码或其他明文凭证。当前配置版本：{environmentConfigurationVersion ?? 1}</p>
          <ProjectWorkerRuntimeEnvironment value={workerRuntime} onChange={setWorkerRuntime} />
          {environmentEntries.map((entry, index) => <div key={entry.id ?? entry.name} className="grid gap-2 rounded-md border border-[#d0d7de] bg-white p-3 text-sm"><div className="flex items-center justify-between"><span className="font-mono font-semibold">{entry.name}</span><span className={entry.status === "configured" ? "text-[#1a7f37]" : "text-[#9a6700]"}>{entry.status === "configured" ? "已配置" : entry.status === "missing" ? "待补充" : "待校验"}</span></div><span className="text-xs text-[#57606a]">{entry.purpose} · {entry.sourceType} · {entry.executionTargets.join("、")}</span>{entry.sourceType === "humanthread" ? <ManagedSecretEditor name={entry.name} configured={managedSecrets.some((secret) => secret.name === entry.name && secret.status === "configured")} value={secretValues[entry.name] ?? ""} pending={secretPending === entry.name} onChange={(next) => setSecretValues((current) => ({ ...current, [entry.name]: next }))} onSave={() => void saveManagedSecret(entry.name)} /> : null}<div className="flex gap-3"><button type="button" className="text-xs text-[#0969da]" onClick={() => editEnvironment(index)}>编辑 {entry.name}</button><button type="button" className="text-xs text-[#cf222e]" onClick={() => setEnvironmentEntries((current) => current.filter((_, itemIndex) => itemIndex !== index))}>删除 {entry.name}</button></div></div>)}
          {environmentEntries.length === 0 ? <p className="text-sm text-[#57606a]">尚未配置环境项，可在后续引导中添加。</p> : null}
          <fieldset className="grid gap-3 rounded-md border border-[#d0d7de] bg-[#f6f8fa] p-3"><legend className="px-1 text-sm font-semibold">{editingEnvironmentIndex === null ? "新增环境配置" : `编辑 ${environmentDraft.name || "环境配置"}`}</legend><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs font-semibold">环境变量名<input aria-label="环境变量名" value={environmentDraft.name} onChange={(event) => { const name = event.currentTarget.value; setEnvironmentDraft((draft) => ({ ...draft, name })); }} className="rounded border border-[#d0d7de] bg-white px-2 py-2 font-mono text-sm font-normal" /></label><label className="grid gap-1 text-xs font-semibold">配置用途<input aria-label="配置用途" value={environmentDraft.purpose} onChange={(event) => { const purpose = event.currentTarget.value; setEnvironmentDraft((draft) => ({ ...draft, purpose })); }} className="rounded border border-[#d0d7de] bg-white px-2 py-2 text-sm font-normal" /></label><label className="grid gap-1 text-xs font-semibold">来源类型<select aria-label="来源类型" value={environmentDraft.sourceType} onChange={(event) => { const sourceType = event.currentTarget.value as EnvironmentEntry["sourceType"]; setEnvironmentDraft((draft) => ({ ...draft, sourceType })); }} className="rounded border border-[#d0d7de] bg-white px-2 py-2 text-sm font-normal"><option value="humanthread">HumanThread 托管</option><option value="nacos">Nacos</option><option value="project_file">项目配置文件</option><option value="process">进程环境</option></select></label><label className="grid gap-1 text-xs font-semibold">来源引用<input aria-label="来源引用" value={environmentDraft.reference} onChange={(event) => { const reference = event.currentTarget.value; setEnvironmentDraft((draft) => ({ ...draft, reference })); }} placeholder="变量名或配置路径" className="rounded border border-[#d0d7de] bg-white px-2 py-2 text-sm font-normal" /></label></div><div className="flex flex-wrap gap-3 text-xs"><span className="font-semibold">可用端：</span>{(["worker", "local_agent"] as const).map((target) => <label key={target} className="flex items-center gap-1"><input type="checkbox" checked={environmentDraft.executionTargets.includes(target)} onChange={(event) => { const checked = event.currentTarget.checked; setEnvironmentDraft((draft) => ({ ...draft, executionTargets: checked ? [...draft.executionTargets, target] : draft.executionTargets.filter((item) => item !== target) })); }} />{target === "worker" ? "Worker" : "Local Agent"}</label>)}<label className="flex items-center gap-1">状态<select aria-label="配置状态" value={environmentDraft.status} onChange={(event) => { const status = event.currentTarget.value as EnvironmentEntry["status"]; setEnvironmentDraft((draft) => ({ ...draft, status })); }} className="rounded border border-[#d0d7de] bg-white px-1"><option value="missing">待补充</option><option value="unverified">待校验</option><option value="configured">已配置</option></select></label></div><div className="flex gap-2"><WorkbenchButton type="button" size="small" onClick={saveEnvironmentDraft}>添加到列表</WorkbenchButton>{editingEnvironmentIndex !== null ? <WorkbenchButton type="button" size="small" variant="secondary" onClick={() => { setEditingEnvironmentIndex(null); setEnvironmentDraft(emptyEnvironmentEntry()); }}>取消编辑</WorkbenchButton> : null}</div></fieldset>
          {environmentError ? <p role="alert" className="text-sm text-[#cf222e]">{environmentError}</p> : null}
          <div><WorkbenchButton type="submit" size="small" variant="primary" disabled={environmentPending}>{environmentPending ? "保存中" : "保存环境配置"}</WorkbenchButton></div>
        </form>
        {section === "environment" ? <ProjectRepositoryCredentialWizard
          projectId={projectId}
          version={version}
          canEdit={canEdit}
          {...(workerResource?.repositoryUrl ? { initialRepositoryUrl: workerResource.repositoryUrl } : {})}
          {...(workerResource?.branchPolicy.allowedBranches ? { initialBranches: workerResource.branchPolicy.allowedBranches } : {})}
        /> : null}
      </Panel> : null}
    </div>
  );
}

function readConfigString(value: unknown, key: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : "";
}

type EnvironmentEntry = {
  id?: string;
  name: string;
  purpose: string;
  executionTargets: Array<"local_agent" | "worker">;
  sourceType: "humanthread" | "nacos" | "project_file" | "process";
  sourceConfig?: { projectPath?: string; namespace?: string; group?: string; dataId?: string };
  status: "configured" | "missing" | "unverified";
  reference: string;
  revision: number;
};

type ManagedSecret = {
  id: string;
  projectId: string;
  name: string;
  fingerprint: string;
  status: "configured" | "revoked";
  version: number;
  createdAt: string;
  updatedAt: string;
};

function ManagedSecretEditor({ name, configured, value, pending, onChange, onSave }: { name: string; configured: boolean; value: string; pending: boolean; onChange: (value: string) => void; onSave: () => void }) {
  return <div className="grid gap-2 rounded border border-[#d8dee4] bg-[#f6f8fa] p-2"><div className="flex items-center justify-between text-xs"><span className="font-semibold">HumanThread 托管凭证</span><span className={configured ? "text-[#1a7f37]" : "text-[#9a6700]"}>{configured ? "已配置（不回显）" : "未配置"}</span></div><div className="flex flex-wrap items-center gap-2"><input aria-label={`${name} 托管凭证`} type="password" autoComplete="new-password" value={value} onChange={(event) => onChange(event.currentTarget.value)} placeholder={configured ? "输入新值以轮换" : "输入凭证值"} className="min-w-0 flex-1 rounded border border-[#d0d7de] bg-white px-2 py-1.5 text-sm" /><WorkbenchButton type="button" size="small" onClick={onSave} disabled={pending || !value.trim()}>{pending ? "保存中" : configured ? "轮换" : "录入凭证"}</WorkbenchButton></div><p className="text-[11px] leading-4 text-[#57606a]">凭证加密保存，仅在项目授权的执行端运行时读取；页面不会显示明文。</p></div>;
}

function readEnvironmentConfiguration(value: unknown): { entries: EnvironmentEntry[]; workerRuntime?: WorkerRuntimeEnvironment } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { entries: [] };
  const workerRuntimeResult = workerRuntimeEnvironmentSchema.safeParse((value as { workerRuntime?: unknown }).workerRuntime);
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return workerRuntimeResult.success ? { entries: [], workerRuntime: workerRuntimeResult.data } : { entries: [] };
  return { entries: entries.flatMap((candidate): EnvironmentEntry[] => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const item = candidate as Partial<EnvironmentEntry>;
    return typeof item.id === "string" && typeof item.name === "string" && typeof item.purpose === "string" && typeof item.reference === "string"
      && Array.isArray(item.executionTargets) && (item.sourceType === "humanthread" || item.sourceType === "nacos" || item.sourceType === "project_file" || item.sourceType === "process")
      && (item.status === "configured" || item.status === "missing" || item.status === "unverified") && typeof item.revision === "number"
      ? [{ id: item.id, name: item.name, purpose: item.purpose, reference: item.reference, executionTargets: item.executionTargets.filter((target): target is "local_agent" | "worker" => target === "local_agent" || target === "worker"), sourceType: item.sourceType, status: item.status, revision: item.revision, ...(item.sourceConfig && typeof item.sourceConfig === "object" ? { sourceConfig: item.sourceConfig } : {}) }]
      : [];
  }), ...(workerRuntimeResult.success ? { workerRuntime: workerRuntimeResult.data } : {}) };
}

function emptyEnvironmentEntry(): EnvironmentEntry {
  return { name: "", purpose: "", executionTargets: ["worker"], sourceType: "humanthread", reference: "", status: "missing", revision: 1 };
}

type DevelopmentTemplatePreview = {
  key: string;
  kind?: string;
  name: string;
  version: number;
  executionPolicy?: Record<string, unknown>;
  triggerPolicy?: Record<string, unknown>;
  developmentLoopVersionId?: string | null;
  releaseLoopVersionId?: string | null;
};

function selectedTemplate(templates: DevelopmentTemplatePreview[], key: string, version: number) {
  return templates.find((template) => template.key === key && template.version === version) ?? null;
}

function templateOptionValue(key: string, version: number) {
  return JSON.stringify([key, version]);
}

function UpgradeDisclosure({ previous, next, persistedPrevious, loopVersions }: { previous: DevelopmentTemplatePreview | null; next: DevelopmentTemplatePreview | null; persistedPrevious: { developmentLoopVersionId?: string | null | undefined; releaseLoopVersionId?: string | null | undefined }; loopVersions: readonly DevelopmentTemplateLoopPreview[] }) {
  const changes = [
    ["任务开发 Loop", persistedPrevious.developmentLoopVersionId, next?.developmentLoopVersionId],
    ["里程碑 Loop", persistedPrevious.releaseLoopVersionId, next?.releaseLoopVersionId],
  ];
  return <div className="grid gap-2 border border-[#d8dee4] bg-[#fff8c5] p-3 text-xs leading-5 text-[#57606a]">
    <p>确认后将切换开发模式，并同时更新两个关联 Loop。每个 Loop 始终使用其当前激活版本。</p>
    <ul className="grid gap-1">{changes.map(([role, previousId, nextId]) => <li key={role}><span className="font-semibold text-[#24292f]">{role}</span>：{loopVersionLabel(previousId, loopVersions, "当前版本不可用")} 至 {loopVersionLabel(nextId, loopVersions, "目标版本不可用")}</li>)}</ul>
  </div>;
}

function loopVersionLabel(id: string | null | undefined, loopVersions: readonly DevelopmentTemplateLoopPreview[], fallback: string) {
  if (!id) return <code className="font-mono">{fallback}</code>;
  const version = loopVersions.find((candidate) => candidate.id === id);
  return <>{version?.definition?.name ?? fallback}</>;
}

function TemplatePreview({ template }: { template: DevelopmentTemplatePreview }) {
  const policy = template.executionPolicy ?? {};
  const triggers = template.triggerPolicy?.releaseTriggers;
  const branchPattern = typeof policy.taskBranchPattern === "string" ? policy.taskBranchPattern : "按模板定义";
  const integration = policy.integrationMode === "local_merge_test_push" ? "本地合并、测试后推送预发" : "按模板定义";
  return <div className="grid gap-2 border border-[#d0d7de] p-3 text-xs leading-5 text-[#57606a]">
    <div className="font-semibold text-[#24292f]">{template.name}</div>
    <div className="grid gap-1 sm:grid-cols-3"><span>任务分支：<code className="font-mono text-[#24292f]">{branchPattern}</code></span><span>集成方式：{integration}</span><span>发版触发：{Array.isArray(triggers) && triggers.length > 0 ? triggers.map(String).join("、") : "按模板定义"}</span></div>
    <p>初始化后会生成一个任务开发 Loop 和一个里程碑 Loop；上方分支和 Agent 字段会写入项目配置，Loop 绑定始终解析到各自当前激活版本。</p>
  </div>;
}
