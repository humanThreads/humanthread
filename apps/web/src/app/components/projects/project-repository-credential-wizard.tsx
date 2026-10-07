"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  Copy,
  ExternalLink,
  GitBranch,
  KeyRound,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  projectRepositoryAuthModeSchema,
  projectRepositoryConfigurationSchema,
  providerRepositoryLinks,
  repositorySshUrl,
  type ProjectRepositoryAuthMode,
  type ProjectRepositoryConfiguration,
  type ProjectRepositoryCreationMode,
  type ProjectRepositoryProvider,
  type RepositoryVerificationResult,
} from "@humanthread/shared";

import { WorkbenchButton } from "../workbench-ui";

type RepositoryCredential = {
  name: string;
  status: "configured" | "revoked";
};

type RepositoryView = {
  projectId: string;
  version: number;
  repositoryUrl: string | null;
  branchPolicy: { allowedBranches: string[] } | null;
  configuration: ProjectRepositoryConfiguration | null;
  credentials: RepositoryCredential[];
};

type LoadedState = {
  version: number;
  repositoryUrl: string;
  branches: string;
  configuration: ProjectRepositoryConfiguration | null;
  credentials: RepositoryCredential[];
};

const inputClass = "rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-normal text-[#24292f] outline-none focus:border-[#0969da] focus:ring-2 focus:ring-[#0969da]/15";

function repositoryView(value: unknown): RepositoryView {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("项目仓库配置无效");
  const record = value as Record<string, unknown>;
  const configuration = record.configuration === null || record.configuration === undefined
    ? null
    : projectRepositoryConfigurationSchema.parse(record.configuration);
  return {
    projectId: typeof record.projectId === "string" ? record.projectId : "",
    version: typeof record.version === "number" ? record.version : 0,
    repositoryUrl: typeof record.repositoryUrl === "string" ? record.repositoryUrl : null,
    branchPolicy: record.branchPolicy && typeof record.branchPolicy === "object" && !Array.isArray(record.branchPolicy)
      && Array.isArray(Reflect.get(record.branchPolicy, "allowedBranches"))
      ? { allowedBranches: Reflect.get(record.branchPolicy, "allowedBranches").filter((branch: unknown): branch is string => typeof branch === "string") }
      : null,
    configuration,
    credentials: Array.isArray(record.credentials)
      ? record.credentials.flatMap((credential) => credential && typeof credential === "object" && !Array.isArray(credential)
        && typeof Reflect.get(credential, "name") === "string"
        && (Reflect.get(credential, "status") === "configured" || Reflect.get(credential, "status") === "revoked")
        ? [{ name: Reflect.get(credential, "name") as string, status: Reflect.get(credential, "status") as "configured" | "revoked" }]
        : [])
      : [],
  };
}

function branchesText(value: string[] | null | undefined): string {
  return (value && value.length > 0 ? value : ["main"]).join("\n");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function verificationLabel(result: RepositoryVerificationResult): string {
  if (result.status === "passed") return "已校验";
  if (result.status === "pending_verification") return "待校验";
  if (result.status === "executor_not_configured") return "校验执行器未配置";
  return "校验失败";
}

function verificationTone(result: RepositoryVerificationResult): string {
  if (result.status === "passed") return "border-[#1f883d] bg-[#dafbe1] text-[#116329]";
  if (result.status === "failed") return "border-[#cf222e] bg-[#ffebe9] text-[#82071e]";
  if (result.status === "executor_not_configured") return "border-[#bf8700] bg-[#fff8c5] text-[#7d4e00]";
  return "border-[#0969da] bg-[#ddf4ff] text-[#0a3069]";
}

function failureMessage(code: RepositoryVerificationResult["failureCode"]): string {
  switch (code) {
    case "private_host_not_allowed": return "私仓地址未加入站点出站白名单。";
    case "repository_not_found": return "仓库不存在或当前凭证无权访问。";
    case "credential_rejected": return "Git 凭证无效或已过期。";
    case "permission_denied": return "Git 凭证权限不足。";
    case "default_branch_unavailable": return "未找到可读取的默认分支。";
    case "verification_timeout": return "拉取校验超时，请检查网络和仓库可达性。";
    case "executor_not_configured": return "验证执行器未配置，当前不能判定仓库已连接。";
    case "secret_cleanup_failed": return "临时凭证清理失败，已阻止继续使用。";
    default: return "仓库拉取校验失败，请检查地址和凭证权限。";
  }
}

export function ProjectRepositoryCredentialWizard({
  projectId,
  version,
  canEdit,
  initialRepositoryUrl,
  initialBranches,
}: {
  projectId: string;
  version: number;
  canEdit: boolean;
  initialRepositoryUrl?: string;
  initialBranches?: string[];
}) {
  const [loaded, setLoaded] = useState<LoadedState>({
    version,
    repositoryUrl: initialRepositoryUrl ?? "",
    branches: branchesText(initialBranches),
    configuration: null,
    credentials: [],
  });
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState<ProjectRepositoryProvider>("github");
  const [creationMode, setCreationMode] = useState<ProjectRepositoryCreationMode>("existing");
  const [privateBaseUrl, setPrivateBaseUrl] = useState("");
  const [privateWebUrl, setPrivateWebUrl] = useState("");
  const [privateTokenHelpUrl, setPrivateTokenHelpUrl] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState(initialRepositoryUrl ?? "");
  const [branches, setBranches] = useState(branchesText(initialBranches));
  const [authMode, setAuthMode] = useState<ProjectRepositoryAuthMode>("project_token");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"https" | "ssh" | null>(null);
  const initialBranchesKey = initialBranches?.join("\n") ?? "";
  const initialRepositoryUrlValue = initialRepositoryUrl ?? "";
  const initialBranchesText = branchesText(initialBranches);

  const applyRepositoryView = useCallback((view: RepositoryView) => {
    setLoaded({
      version: view.version,
      repositoryUrl: view.repositoryUrl ?? initialRepositoryUrlValue,
      branches: view.branchPolicy?.allowedBranches.length ? view.branchPolicy.allowedBranches.join("\n") : initialBranchesText,
      configuration: view.configuration,
      credentials: view.credentials,
    });
  }, [initialBranchesText, initialRepositoryUrlValue]);

  const fetchRepositoryView = useCallback(async (signal?: AbortSignal): Promise<RepositoryView> => {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/repository-configuration`,
      signal ? { signal } : undefined,
    );
    const body = await response.json() as { ok?: boolean; result?: unknown; error?: string };
    if (!response.ok || !body.ok) throw new Error(body.error ?? "项目仓库配置加载失败");
    return repositoryView(body.result);
  }, [projectId]);

  async function waitForVerification(): Promise<RepositoryVerificationResult> {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const view = await fetchRepositoryView();
      applyRepositoryView(view);
      if (!view.configuration) throw new Error("项目仓库配置已失效，请重新配置。");
      if (view.configuration.verification.status !== "pending_verification") return view.configuration.verification;
      await wait(1_000);
    }
    throw new Error("项目仓库校验仍在进行中，请稍后刷新查看结果。");
  }

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    void fetchRepositoryView(controller.signal)
      .then((view) => {
        applyRepositoryView(view);
        setWizardOpen(view.configuration === null);
        if (view.configuration) {
          setProvider(view.configuration.provider);
          setCreationMode(view.configuration.creationMode);
          setPrivateBaseUrl(view.configuration.privateBaseUrl ?? "");
          setPrivateWebUrl(view.configuration.privateWebUrl ?? "");
          setPrivateTokenHelpUrl(view.configuration.privateTokenHelpUrl ?? "");
          setAuthMode(view.configuration.authMode);
          setRepositoryUrl(view.repositoryUrl ?? initialRepositoryUrlValue);
          setBranches(view.branchPolicy?.allowedBranches.length ? view.branchPolicy.allowedBranches.join("\n") : initialBranchesText);
        }
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "项目仓库配置加载失败");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [applyRepositoryView, fetchRepositoryView, initialBranchesKey, initialBranchesText, initialRepositoryUrlValue, projectId]);

  let links: ReturnType<typeof providerRepositoryLinks>;
  try {
    links = providerRepositoryLinks({ provider, privateBaseUrl, privateWebUrl, privateTokenHelpUrl });
  } catch {
    links = {
      createRepositoryUrl: null,
      repositoryListUrl: null,
      createTokenUrl: null,
      defaultUsername: "oauth2",
      tokenLabel: "项目 Token",
      tokenPermissions: ["read_repository", "write_repository", "由私仓管理员确认额外权限"],
    };
  }
  const sshUrl = (() => {
    try {
      return repositorySshUrl(repositoryUrl);
    } catch {
      return "";
    }
  })();
  const accountPasswordDisabled = provider === "github";
  const configuration = loaded.configuration;

  function selectProvider(next: ProjectRepositoryProvider) {
    setProvider(next);
    if (next === "github") setAuthMode("project_token");
  }

  async function saveAndVerify() {
    if (!canEdit || pending) return;
    const allowedBranches = [...new Set(branches.split(/[\s,]+/u).map((branch) => branch.trim()).filter(Boolean))];
    if (!repositoryUrl.trim() || allowedBranches.length === 0) {
      setError("请填写 Git 仓库地址和至少一个允许分支。");
      return;
    }
    if (provider === "private" && !privateBaseUrl.trim()) {
      setError("请填写私仓 HTTPS 根地址。");
      return;
    }
    if (!secret.trim()) {
      setError("请填写 Git 凭证。");
      return;
    }
    projectRepositoryAuthModeSchema.parse(authMode);
    setPending(true);
    setError(null);
    try {
      const configurationResponse = await fetch(`/api/projects/${encodeURIComponent(projectId)}/repository-configuration`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: loaded.version,
          repositoryUrl: repositoryUrl.trim(),
          allowedBranches,
          provider,
          creationMode,
          authMode,
          privateBaseUrl: provider === "private" ? privateBaseUrl.trim() || null : null,
          privateWebUrl: provider === "private" ? privateWebUrl.trim() || null : null,
          privateTokenHelpUrl: provider === "private" ? privateTokenHelpUrl.trim() || null : null,
        }),
      });
      const configurationBody = await configurationResponse.json() as { ok?: boolean; result?: { version?: number }; error?: string };
      if (!configurationResponse.ok || !configurationBody.ok) throw new Error(configurationBody.error ?? "项目仓库配置保存失败");
      const savedVersion = configurationBody.result?.version ?? loaded.version + 1;

      const credentialResponse = await fetch(`/api/projects/${encodeURIComponent(projectId)}/repository-credentials`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authMode, username: username.trim(), secret }),
      });
      const credentialBody = await credentialResponse.json() as { ok?: boolean; result?: { credentialNames?: string[] }; error?: string };
      if (!credentialResponse.ok || !credentialBody.ok) throw new Error(credentialBody.error ?? "项目仓库凭证保存失败");

      const verificationResponse = await fetch(`/api/projects/${encodeURIComponent(projectId)}/repository-verification`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const verificationBody = await verificationResponse.json() as { ok?: boolean; result?: RepositoryVerificationResult & { version?: number }; error?: string };
      if (!verificationResponse.ok || !verificationBody.ok || !verificationBody.result) throw new Error(verificationBody.error ?? "项目仓库校验入队失败");
      setLoaded((current) => ({
        ...current,
        version: verificationBody.result?.version ?? savedVersion,
        repositoryUrl: repositoryUrl.trim(),
        branches: allowedBranches.join("\n"),
        credentials: (credentialBody.result?.credentialNames ?? []).map((name) => ({ name, status: "configured" })),
      }));
      setSecret("");
      setUsername(username.trim());
      setWizardOpen(false);
      setStep(1);
      const result = await waitForVerification();
      if (result.status === "failed" || result.status === "executor_not_configured") setError(failureMessage(result.failureCode));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "项目仓库配置失败");
    } finally {
      setPending(false);
    }
  }

  async function reverify() {
    if (!canEdit || pending || !configuration) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/repository-verification`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await response.json() as { ok?: boolean; result?: { version?: number; status?: string }; error?: string };
      if (!response.ok || !body.ok || !body.result) throw new Error(body.error ?? "项目仓库校验入队失败");
      setLoaded((current) => ({
        ...current,
        version: body.result?.version ?? current.version,
        configuration: current.configuration ? { ...current.configuration, verification: { status: "pending_verification", verifiedAt: null, defaultBranch: null, headSha: null, failureCode: null, apiChecked: false } } : current.configuration,
      }));
      const result = await waitForVerification();
      if (result.status === "failed" || result.status === "executor_not_configured") setError(failureMessage(result.failureCode));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "项目仓库校验失败");
    } finally {
      setPending(false);
    }
  }

  async function copy(value: string, kind: "https" | "ssh") {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(kind);
      window.setTimeout(() => setCopyStatus(null), 1_500);
    } catch {
      setError("浏览器未允许复制，请手动选择地址复制。");
    }
  }

  if (!canEdit) return null;
  if (loading) return <RepositoryFrame><p className="text-sm text-[#57606a]">正在读取项目仓库配置…</p></RepositoryFrame>;

  return <RepositoryFrame>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-[#24292f]">项目仓库</h3>
        <p className="mt-1 text-xs leading-5 text-[#57606a]">项目级 Git 提供方、加密凭证与真实拉取校验；凭证保存后不会回显。</p>
      </div>
      {configuration ? <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${verificationTone(configuration.verification)}`}>{verificationLabel(configuration.verification)}</span> : <span className="rounded-full border border-[#bf8700] bg-[#fff8c5] px-2.5 py-1 text-xs font-semibold text-[#7d4e00]">未配置</span>}
    </div>

    {configuration ? <div className="mt-4 grid gap-3 rounded-md border border-[#d8dee4] bg-[#f6f8fa] p-3 text-sm sm:grid-cols-2">
      <Summary label="提供方" value={configuration.provider === "github" ? "GitHub" : configuration.provider === "gitlab" ? "GitLab" : "私仓"} />
      <Summary label="认证方式" value={configuration.authMode === "project_token" ? "项目 Token" : "账户密码"} />
      <Summary label="仓库地址" value={loaded.repositoryUrl} mono />
      <Summary label="默认分支" value={configuration.verification.defaultBranch ?? "待校验"} />
      <Summary label="最近校验" value={configuration.verification.verifiedAt ? new Date(configuration.verification.verifiedAt).toLocaleString("zh-CN") : "尚未通过"} />
      <Summary label="HEAD" value={configuration.verification.headSha ? configuration.verification.headSha.slice(0, 12) : "—"} mono />
      <div className="sm:col-span-2 flex flex-wrap gap-2">
        <WorkbenchButton type="button" size="small" onClick={() => { setWizardOpen(true); setStep(1); }}><RotateCcw size={14} />重新配置</WorkbenchButton>
        <WorkbenchButton type="button" size="small" disabled={pending} onClick={() => void reverify()}><ShieldCheck size={14} />重新校验</WorkbenchButton>
        <WorkbenchButton type="button" size="small" onClick={() => setCopyOpen(true)}><Copy size={14} />复制仓库地址</WorkbenchButton>
        {links.repositoryListUrl ? <a href={links.repositoryListUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-[#d0d7de] bg-white px-2.5 text-xs font-semibold text-[#24292f] hover:bg-[#f6f8fa]">打开仓库列表<ExternalLink size={13} /></a> : null}
      </div>
    </div> : null}

    {wizardOpen ? <div className="mt-4 border-t border-[#d8dee4] pt-4">
      <ol className="mb-4 grid gap-2 sm:grid-cols-4" aria-label="仓库凭证配置步骤">
        {["选择提供方", "选择仓库", "配置凭证", "保存并校验"].map((label, index) => <li key={label} className={`rounded-md border px-3 py-2 text-xs font-semibold ${step === index + 1 ? "border-[#0969da] bg-[#ddf4ff] text-[#0a3069]" : "border-[#d0d7de] bg-white text-[#57606a]"}`}>{index + 1}. {label}</li>)}
      </ol>

      {step === 1 ? <div className="grid gap-4">
        <fieldset><legend className="text-sm font-semibold text-[#24292f]">Git 提供方</legend><div className="mt-2 grid gap-2 sm:grid-cols-3">{([["github", "GitHub"], ["gitlab", "GitLab"], ["private", "私仓"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={provider === value} onClick={() => selectProvider(value)} className={`rounded-md border px-3 py-3 text-left text-sm font-semibold ${provider === value ? "border-[#0969da] bg-[#ddf4ff] text-[#0a3069]" : "border-[#d0d7de] bg-white text-[#24292f]"}`}><GitBranch className="mb-2 size-4" />{label}</button>)}</div></fieldset>
        {provider === "private" ? <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold">私仓 HTTPS 根地址<input aria-label="私仓地址" value={privateBaseUrl} onChange={(event) => setPrivateBaseUrl(event.currentTarget.value)} placeholder="https://git.example.com" className={inputClass} /></label>
          <label className="grid gap-1 text-xs font-semibold">私仓 Web 地址（可选）<input aria-label="私仓 Web 地址" value={privateWebUrl} onChange={(event) => setPrivateWebUrl(event.currentTarget.value)} className={inputClass} /></label>
          <label className="grid gap-1 text-xs font-semibold sm:col-span-2">Token 帮助地址（可选）<input aria-label="私仓 Token 帮助地址" value={privateTokenHelpUrl} onChange={(event) => setPrivateTokenHelpUrl(event.currentTarget.value)} className={inputClass} /></label>
        </div> : null}
      </div> : null}

      {step === 2 ? <div className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <WorkbenchButton type="button" size="small" variant={creationMode === "new" ? "primary" : "secondary"} onClick={() => setCreationMode("new")}>新建仓库</WorkbenchButton>
          <WorkbenchButton type="button" size="small" variant={creationMode === "existing" ? "primary" : "secondary"} onClick={() => setCreationMode("existing")}>已有仓库</WorkbenchButton>
        </div>
        {creationMode === "new" ? <div className="rounded-md border border-[#b6d7f2] bg-[#ddf4ff] p-3 text-sm leading-6 text-[#0a3069]">
          <p>先在提供方创建仓库，完成后回到这里填写实际 HTTPS 地址。</p>
          {links.createRepositoryUrl ? <a href={links.createRepositoryUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-semibold text-[#0969da] hover:underline">打开仓库创建页<ExternalLink size={14} /></a> : <p className="mt-2 font-semibold">由管理员补充创建入口。</p>}
        </div> : null}
        <label className="grid gap-1 text-xs font-semibold">Git 仓库 HTTPS 地址<input aria-label="Git 仓库地址" value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.currentTarget.value)} placeholder="https://github.com/org/repository.git" className={inputClass} /></label>
        <label className="grid gap-1 text-xs font-semibold">允许分支<textarea aria-label="Git 允许分支" value={branches} onChange={(event) => setBranches(event.currentTarget.value)} rows={3} className={`${inputClass} font-mono`} /></label>
        <div><WorkbenchButton type="button" size="small" onClick={() => setCopyOpen(true)} disabled={!repositoryUrl.trim()}><Copy size={14} />复制仓库地址</WorkbenchButton></div>
      </div> : null}

      {step === 3 ? <div className="grid gap-4">
        <fieldset><legend className="text-sm font-semibold text-[#24292f]">认证方式</legend><div className="mt-2 flex flex-wrap gap-2">
          <WorkbenchButton type="button" size="small" variant={authMode === "project_token" ? "primary" : "secondary"} onClick={() => setAuthMode("project_token")}>项目 Token</WorkbenchButton>
          <WorkbenchButton type="button" size="small" disabled={accountPasswordDisabled} variant={authMode === "account_password" ? "primary" : "secondary"} onClick={() => setAuthMode("account_password")}>账户密码</WorkbenchButton>
        </div>{accountPasswordDisabled ? <p className="mt-2 text-xs text-[#9a6700]">GitHub 不支持 Git HTTPS 账户密码，请使用 Fine-grained Token。</p> : null}</fieldset>
        <div className="rounded-md border border-[#d8dee4] bg-[#f6f8fa] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="text-sm text-[#24292f]">{links.tokenLabel}</strong><p className="mt-1 text-xs text-[#57606a]">最小权限：{links.tokenPermissions.join("；")}</p></div>{links.createTokenUrl ? <a href={links.createTokenUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-[#d0d7de] bg-white px-2.5 text-xs font-semibold text-[#24292f] hover:bg-[#f6f8fa]">创建 Token<ExternalLink size={13} /></a> : null}</div>
        </div>
        <label className="grid gap-1 text-xs font-semibold">Git 用户名{authMode === "project_token" ? "（可选，留空使用安全默认值）" : ""}<input aria-label="Git 用户名" value={username} onChange={(event) => setUsername(event.currentTarget.value)} autoComplete="username" className={inputClass} /></label>
        <label className="grid gap-1 text-xs font-semibold">{authMode === "project_token" ? "项目 Token" : "Git 密码"}<input aria-label="Git 凭证" type="password" value={secret} onChange={(event) => setSecret(event.currentTarget.value)} autoComplete="new-password" className={inputClass} /></label>
      </div> : null}

      {step === 4 ? <div className="grid gap-3 rounded-md border border-[#d8dee4] bg-[#f6f8fa] p-3 text-sm">
        <Summary label="提供方" value={provider === "github" ? "GitHub" : provider === "gitlab" ? "GitLab" : "私仓"} />
        <Summary label="仓库地址" value={repositoryUrl || "未填写"} mono />
        <Summary label="认证方式" value={authMode === "project_token" ? "项目 Token" : "账户密码"} />
        <Summary label="允许分支" value={branches.split(/[\s,]+/u).filter(Boolean).join("、") || "未填写"} />
        <p className="text-xs leading-5 text-[#57606a]">保存后会对已保存凭证执行 <code>git ls-remote --symref</code> 与浅拉取。校验通过前不会显示“已连接”。</p>
      </div> : null}

      {error ? <p role="alert" className="mt-3 text-sm text-[#cf222e]">{error}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {step > 1 ? <WorkbenchButton type="button" size="small" onClick={() => setStep(step - 1)} disabled={pending}>上一步</WorkbenchButton> : null}
        {step < 4 ? <WorkbenchButton type="button" size="small" variant="primary" onClick={() => { setError(null); setStep(step + 1); }} disabled={(step === 1 && provider === "private" && !privateBaseUrl.trim()) || (step === 2 && !repositoryUrl.trim()) || (step === 3 && !secret.trim())}>下一步</WorkbenchButton> : <WorkbenchButton type="button" size="small" variant="primary" onClick={() => void saveAndVerify()} disabled={pending}><KeyRound size={14} />{pending ? "保存并校验中" : "保存并校验"}</WorkbenchButton>}
        {configuration ? <WorkbenchButton type="button" size="small" onClick={() => setWizardOpen(false)} disabled={pending}>取消</WorkbenchButton> : null}
      </div>
    </div> : null}

    {error && !wizardOpen ? <p role="alert" className="mt-3 text-sm text-[#cf222e]">{error}</p> : null}

    <Dialog.Root open={copyOpen} onOpenChange={setCopyOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-[#1f2328]/45" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[min(680px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[#d0d7de] bg-white p-5 shadow-xl outline-none">
          <div className="flex items-start justify-between gap-4"><div><Dialog.Title className="text-base font-semibold text-[#24292f]">复制仓库地址</Dialog.Title><Dialog.Description className="mt-1 text-sm text-[#57606a]">选择 HTTPS 或 SSH 地址。地址不包含用户名、Token 或其他凭证。</Dialog.Description></div><Dialog.Close className="grid h-8 w-8 place-items-center rounded-md text-[#57606a] hover:bg-[#f6f8fa]" aria-label="关闭复制仓库地址"><X size={17} /></Dialog.Close></div>
          <div className="mt-4 grid gap-3">
            <CopyRow label="HTTPS" value={repositoryUrl} copied={copyStatus === "https"} onCopy={() => void copy(repositoryUrl, "https")} />
            {repositoryUrl && sshUrl ? <CopyRow label="SSH" value={sshUrl} copied={copyStatus === "ssh"} onCopy={() => void copy(sshUrl, "ssh")} /> : null}
            {links.repositoryListUrl ? <a href={links.repositoryListUrl} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-[#0969da] hover:underline">打开仓库<ExternalLink size={14} /></a> : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </RepositoryFrame>;
}

function RepositoryFrame({ children }: { children: React.ReactNode }) {
  return <section className="mt-5 border-t border-[#d8dee4] pt-4">{children}</section>;
}

function Summary({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><div className="text-xs font-semibold text-[#57606a]">{label}</div><div className={`mt-1 break-all text-sm text-[#24292f] ${mono ? "font-mono" : ""}`}>{value}</div></div>;
}

function CopyRow({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return <div className="flex items-center gap-2 rounded-md border border-[#d0d7de] bg-[#f6f8fa] p-2"><span className="w-14 shrink-0 text-xs font-semibold text-[#57606a]">{label}</span><code className="min-w-0 flex-1 break-all text-xs text-[#24292f]">{value}</code><WorkbenchButton type="button" size="small" onClick={onCopy} aria-label={`复制${label}地址`}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "已复制" : "复制"}</WorkbenchButton></div>;
}
