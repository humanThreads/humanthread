import type { DeviceRuntimeProfileUpsertRequest } from "@humanthread/workbench-client";
import { Bot, CheckCircle2, Download, KeyRound, RefreshCw, ShieldOff, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { LocalExecutionConfigStore } from "../../desktop/execution-config-store";
import {
  DEFAULT_LOCAL_WORKER_PREFERENCES,
  LOCAL_WORKER_ACTIVITY_CHANGED,
  publishLocalWorkerPreferences,
} from "../../desktop/worker-preferences";
import {
  buildRuntimeProfileUpload,
  type AgentProvider,
  type LocalRuntimeConfiguration,
  type RuntimeProbeResult,
} from "../../lib/execution-configuration";
import type { LocalRuntime } from "../../lib/runtime";
import { DEFAULT_CODEX_CREDENTIAL_REF } from "../../lib/local-model-configuration";
import type { LocalAccountContext, NativeLocalModelCommands } from "../../lib/native-local-model-commands";
import { ModelSiteSettings } from "./model-site-settings";

export type RuntimeProfile = {
  id: string;
  userId: string;
  localDeviceId: string;
  provider: AgentProvider;
  label: string;
  status: "ready" | "missing" | "unauthenticated" | "disabled";
  version: number;
  capabilities: string[];
  lastValidatedAt: string | null;
};

const PROVIDER_LABELS: Record<AgentProvider, string> = { codex: "Codex", claude: "Claude" };
const DEFAULT_COMMANDS: Record<AgentProvider, string> = { codex: "codex", claude: "claude" };
const ENVIRONMENT_OPTIONS: Record<AgentProvider, Array<{ value: string; label: string }>> = {
  codex: [
    { value: "CODEX_HOME", label: "CODEX_HOME" },
    { value: "OPENAI_API_KEY", label: "OPENAI_API_KEY" },
  ],
  claude: [
    { value: "CLAUDE_CONFIG_DIR", label: "CLAUDE_CONFIG_DIR" },
    { value: "ANTHROPIC_API_KEY", label: "ANTHROPIC_API_KEY" },
  ],
};

function commandId(scope: string): string {
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${scope}:${id}`.slice(0, 128);
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object" && "message" in error) {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "Agent 配置失败";
}

function readinessLabel(status: RuntimeProfile["status"] | RuntimeProbeResult["status"] | null): string {
  if (status === "ready") return "可执行并已登录";
  if (status === "unauthenticated") return "可执行但尚未登录";
  if (status === "missing") return "未找到可执行程序";
  if (status === "disabled") return "已停用";
  return "尚未测试";
}

export function AgentRuntimeSettings(props: {
  nativeAvailable: boolean;
  runtime: LocalRuntime;
  store: LocalExecutionConfigStore | null;
  runtimeProfiles: RuntimeProfile[];
  saveRuntime(input: DeviceRuntimeProfileUpsertRequest): Promise<RuntimeProfile>;
  onRefresh?(): void | Promise<void>;
  localModelCommands?: NativeLocalModelCommands | null;
  localModelAccount?: LocalAccountContext | null;
}) {
  const [provider, setProvider] = useState<AgentProvider>("codex");
  const [commands, setCommands] = useState<Record<AgentProvider, string>>(DEFAULT_COMMANDS);
  const [environmentRefs, setEnvironmentRefs] = useState<Record<AgentProvider, string[]>>({ codex: [], claude: [] });
  const [localRuntime, setLocalRuntime] = useState<LocalRuntimeConfiguration | null>(null);
  const [configuredCredentialRef, setConfiguredCredentialRef] = useState<string | null>(null);
  const [credentialSource, setCredentialSource] = useState<"environment" | "independent">("environment");
  const [credentialInput, setCredentialInput] = useState("");
  const [credentialConfigured, setCredentialConfigured] = useState(false);
  const [probe, setProbe] = useState<RuntimeProbeResult | null>(null);
  const [pending, setPending] = useState<"test" | "install" | "disable" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [workerEnabled, setWorkerEnabled] = useState(DEFAULT_LOCAL_WORKER_PREFERENCES.enabled);
  const [maxConcurrency, setMaxConcurrency] = useState(DEFAULT_LOCAL_WORKER_PREFERENCES.maxConcurrency);
  const [journalRetentionDays, setJournalRetentionDays] = useState(30);
  const [workerPending, setWorkerPending] = useState(false);
  const [activeRunCount, setActiveRunCount] = useState(0);
  const serverProfile = useMemo(
    () => props.runtimeProfiles.find((profile) => profile.provider === provider) ?? null,
    [props.runtimeProfiles, provider],
  );

  useEffect(() => {
    let disposed = false;
    setProbe(null);
    if (!props.store) {
      setLocalRuntime(null);
      return () => { disposed = true; };
    }
    void props.store.getRuntime(provider).then((configuration) => {
      if (disposed) return;
      setLocalRuntime(configuration);
      if (configuration) {
        setCommands((current) => ({ ...current, [provider]: configuration.command }));
        setEnvironmentRefs((current) => ({ ...current, [provider]: configuration.environmentRefs }));
        setCredentialSource(configuration.credentialRef ? "independent" : "environment");
        setCredentialConfigured(Boolean(configuration.credentialRef));
        setConfiguredCredentialRef(configuration.credentialRef ?? null);
      } else if (provider === "codex") {
        setCredentialSource("environment");
        setCredentialConfigured(false);
        setConfiguredCredentialRef(null);
      }
    }).catch((error: unknown) => {
      if (!disposed) setNotice({ tone: "error", text: message(error) });
    });
    return () => { disposed = true; };
  }, [provider, props.store]);

  useEffect(() => {
    let disposed = false;
    void props.store?.getWorkerPreferences().then((preferences) => {
      if (!disposed) {
        setWorkerEnabled(preferences.enabled);
        setMaxConcurrency(preferences.maxConcurrency);
      }
    }).catch((error: unknown) => {
      if (!disposed) setNotice({ tone: "error", text: message(error) });
    });
    void props.store?.getSessionJournalPreferences().then((preferences) => {
      if (!disposed) setJournalRetentionDays(preferences.retentionDays);
    }).catch((error: unknown) => {
      if (!disposed) setNotice({ tone: "error", text: message(error) });
    });
    return () => { disposed = true; };
  }, [props.store]);

  useEffect(() => {
    const onActivity = (event: Event) => {
      const value = (event as CustomEvent<{ activeRunCount?: unknown }>).detail?.activeRunCount;
      if (typeof value === "number" && Number.isInteger(value) && value >= 0) setActiveRunCount(value);
    };
    globalThis.addEventListener(LOCAL_WORKER_ACTIVITY_CHANGED, onActivity);
    return () => globalThis.removeEventListener(LOCAL_WORKER_ACTIVITY_CHANGED, onActivity);
  }, []);

  const nativeAvailable = props.nativeAvailable && Boolean(props.store);
  const providerLabel = PROVIDER_LABELS[provider];
  const credentialRef = configuredCredentialRef ?? localRuntime?.credentialRef ?? DEFAULT_CODEX_CREDENTIAL_REF;
  const runtimeEnvironmentRefs = credentialSource === "independent" && provider === "codex"
    ? environmentRefs[provider].filter((value) => value !== "OPENAI_API_KEY")
    : environmentRefs[provider];

  async function probeRuntime(): Promise<{
    result: RuntimeProbeResult;
    pendingCredential: string | null;
    credentialRef: string;
  }> {
    const pendingCredential = provider === "codex" && credentialSource === "independent"
      ? credentialInput.trim() || null
      : null;
    let resolvedCredentialRef = credentialRef;
    if (provider === "codex" && credentialSource === "independent" && !pendingCredential && !credentialConfigured) {
      const status = await props.localModelCommands?.getCredentialStatus(credentialRef);
      if (!status?.configured) throw new Error("请先输入独立 Key");
      resolvedCredentialRef = status.credentialRef;
    } else if (provider === "codex" && credentialSource === "independent" && props.localModelCommands) {
      const status = await props.localModelCommands.getCredentialStatus(credentialRef);
      resolvedCredentialRef = status.credentialRef;
    }
    const result = await props.runtime.probeAgentRuntime({
      provider,
      command: commands[provider].trim(),
      environmentRefs: runtimeEnvironmentRefs,
      ...(pendingCredential ? { credential: pendingCredential } : {}),
      ...(!pendingCredential && provider === "codex" && credentialSource === "independent" && props.localModelAccount
        ? { credentialContext: { ...props.localModelAccount, credentialRef: resolvedCredentialRef } }
        : {}),
    });
    return { result, pendingCredential, credentialRef: resolvedCredentialRef };
  }

  async function saveWorkerPreferences() {
    if (!props.store) return;
    setWorkerPending(true);
    setNotice(null);
    try {
      const saved = await props.store.setWorkerPreferences({ enabled: workerEnabled, maxConcurrency });
      publishLocalWorkerPreferences(saved);
      setNotice({ tone: "success", text: "Worker 设置已保存" });
    } catch (error) {
      setNotice({ tone: "error", text: message(error) });
    } finally {
      setWorkerPending(false);
    }
  }

  async function saveJournalPreferences() {
    if (!props.store) return;
    setWorkerPending(true);
    setNotice(null);
    try {
      const saved = await props.store.setSessionJournalPreferences({ retentionDays: journalRetentionDays });
      setJournalRetentionDays(saved.retentionDays);
      setNotice({ tone: "success", text: "会话日志保留设置已保存" });
    } catch (error) {
      setNotice({ tone: "error", text: message(error) });
    } finally {
      setWorkerPending(false);
    }
  }

  async function testRuntime() {
    if (!nativeAvailable || !props.store) return;
    setPending("test");
    setNotice(null);
    const previous = await props.store.getRuntime(provider);
    try {
      const { result, pendingCredential, credentialRef: resolvedCredentialRef } = await probeRuntime();
      setProbe(result);
      if (result.status !== "ready" || result.authentication !== "authenticated") {
        throw new Error(result.status === "unauthenticated"
          ? `${providerLabel} 尚未登录`
          : `未找到可用的 ${providerLabel}`);
      }
      if (pendingCredential) {
        if (!props.localModelCommands) throw new Error("独立 Key 存储不可用");
        await props.localModelCommands.setCredential({ credentialRef: resolvedCredentialRef, kind: "openai_api_key", apiKey: pendingCredential });
        setCredentialConfigured(true);
        setConfiguredCredentialRef(resolvedCredentialRef);
        setCredentialInput("");
      }
      const nextVersion = Math.max(serverProfile?.version ?? 0, previous?.version ?? 0) + 1;
      const configuration = await props.store.upsertRuntime({
        runtimeProfileId: serverProfile?.id ?? null,
        provider,
        command: commands[provider].trim(),
        environmentRefs: runtimeEnvironmentRefs,
        credentialRef: credentialSource === "independent" && provider === "codex" ? resolvedCredentialRef : null,
        version: nextVersion,
      });
      setLocalRuntime(configuration);
      const upload = buildRuntimeProfileUpload(configuration, result);
      const saved = await props.saveRuntime({
        commandId: commandId("runtime-upsert"),
        ...(serverProfile ? { expectedVersion: serverProfile.version } : {}),
        provider: upload.provider,
        label: upload.label,
        status: upload.status,
        capabilities: upload.capabilities,
        validatedAt: new Date().toISOString(),
      });
      const synchronized = await props.store.upsertRuntime({
        ...configuration,
        runtimeProfileId: saved.id,
        version: saved.version,
      });
      setLocalRuntime(synchronized);
      setNotice({ tone: "success", text: `${providerLabel} 已在当前设备启用` });
    } catch (error) {
      if (previous) {
        setCommands((current) => ({ ...current, [provider]: previous.command }));
        setEnvironmentRefs((current) => ({ ...current, [provider]: previous.environmentRefs }));
      }
      setNotice({ tone: "error", text: message(error) });
      await props.onRefresh?.();
    } finally {
      setPending(null);
    }
  }

  async function disableRuntime() {
    if (!nativeAvailable || !props.store) return;
    setPending("disable");
    setNotice(null);
    try {
      const nextVersion = Math.max(serverProfile?.version ?? 0, localRuntime?.version ?? 0) + 1;
      await props.store.disableRuntime(provider, nextVersion);
      setLocalRuntime(null);
      setProbe(null);
      await props.saveRuntime({
        commandId: commandId("runtime-disable"),
        ...(serverProfile ? { expectedVersion: serverProfile.version } : {}),
        provider,
        label: providerLabel,
        status: "disabled",
        capabilities: [],
        validatedAt: new Date().toISOString(),
      });
      setNotice({ tone: "success", text: `${providerLabel} 已停用` });
    } catch (error) {
      setNotice({ tone: "error", text: message(error) });
      await props.onRefresh?.();
    } finally {
      setPending(null);
    }
  }

  async function deleteIndependentCredential() {
    if (!nativeAvailable || !props.store || !props.localModelCommands || provider !== "codex") return;
    setPending("disable");
    setNotice(null);
    try {
      await props.localModelCommands.deleteCredential(credentialRef);
      setCredentialConfigured(false);
      setCredentialInput("");
      setCredentialSource("environment");
      setConfiguredCredentialRef(null);
      const current = await props.store.getRuntime(provider);
      if (current) {
        const next = await props.store.upsertRuntime({
          ...current,
          credentialRef: null,
          version: current.version + 1,
        });
        setLocalRuntime(next);
      }
      setNotice({ tone: "success", text: "独立 Key 已删除，已恢复系统环境" });
    } catch (error) {
      setNotice({ tone: "error", text: message(error) });
    } finally {
      setPending(null);
    }
  }

  async function installRuntime() {
    if (!nativeAvailable || !props.store) return;
    setPending("install");
    setNotice(null);
    try {
      await props.runtime.installAgentRuntime({ provider, environmentRefs: runtimeEnvironmentRefs });
      const { result, pendingCredential, credentialRef: resolvedCredentialRef } = await probeRuntime();
      setProbe(result);
      if (result.status === "unauthenticated") {
        setNotice({ tone: "success", text: `${providerLabel} 已安装，请先完成登录后再测试配置` });
      } else if (result.status !== "ready" || result.authentication !== "authenticated") {
        throw new Error(`安装完成，但未找到可用的 ${providerLabel}`);
      } else {
        if (pendingCredential) {
          if (!props.localModelCommands) throw new Error("独立 Key 存储不可用");
          await props.localModelCommands.setCredential({ credentialRef: resolvedCredentialRef, kind: "openai_api_key", apiKey: pendingCredential });
          setCredentialConfigured(true);
          setConfiguredCredentialRef(resolvedCredentialRef);
          setCredentialInput("");
        }
        setNotice({ tone: "success", text: `${providerLabel} 已安装并可用` });
      }
    } catch (error) {
      setNotice({ tone: "error", text: message(error) });
    } finally {
      setPending(null);
    }
  }

  const displayedStatus = probe?.status ?? serverProfile?.status ?? null;
  return (
    <>
      <section aria-labelledby="agent-runtime-settings-title" className="settings-domain-section settings-runtime-section">
      <header>
        <span className="settings-section-icon"><Bot aria-hidden="true" size={18} /></span>
        <div><h2 id="agent-runtime-settings-title">本地 Agent</h2><p>每台设备独立配置，不上传命令、目录或凭据。</p></div>
        <em>{nativeAvailable ? readinessLabel(displayedStatus) : "仅桌面客户端可配置 Agent"}</em>
      </header>
      <div className="runtime-settings-control">
        <div className="runtime-worker-settings">
          <label><input checked={workerEnabled} disabled={!nativeAvailable || workerPending} onChange={(event) => setWorkerEnabled(event.target.checked)} type="checkbox" />执行任务</label>
          <label><span>并发上限</span><input aria-label="并发上限" disabled={!nativeAvailable || workerPending} max={128} min={1} onChange={(event) => setMaxConcurrency(Number(event.target.value))} type="number" value={maxConcurrency} /></label>
          <span>正在执行 {activeRunCount} / 并发上限 {maxConcurrency}</span>
          <button disabled={!nativeAvailable || workerPending || !Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 128} onClick={() => void saveWorkerPreferences()} type="button">保存 Worker 设置</button>
          <label><span>会话日志保留天数</span><input aria-label="会话日志保留天数" disabled={!nativeAvailable || workerPending} max={3650} min={1} onChange={(event) => setJournalRetentionDays(Number(event.target.value))} type="number" value={journalRetentionDays} /></label>
          <span>默认 30 天；删除本地缓存后，服务端无法恢复会话正文。</span>
          <button disabled={!nativeAvailable || workerPending || !Number.isInteger(journalRetentionDays) || journalRetentionDays < 1 || journalRetentionDays > 3650} onClick={() => void saveJournalPreferences()} type="button">保存会话日志设置</button>
        </div>
        <div aria-label="Agent Provider" className="runtime-provider-switch" role="radiogroup">
          {(["codex", "claude"] as const).map((option) => (
            <button aria-checked={provider === option} key={option} onClick={() => setProvider(option)} role="radio" type="button">{PROVIDER_LABELS[option]}</button>
          ))}
        </div>
        <label className="runtime-command-field">
          <span>{providerLabel} 可执行命令</span>
          <input disabled={!nativeAvailable || pending !== null} maxLength={1_024} onChange={(event) => setCommands((current) => ({ ...current, [provider]: event.target.value }))} value={commands[provider]} />
        </label>
        {provider === "codex" ? <div aria-label="Codex 凭据来源" className="runtime-credential-source" role="radiogroup">
          <span>凭据来源</span>
          <button aria-checked={credentialSource === "environment"} disabled={!nativeAvailable || pending !== null} onClick={() => { setCredentialSource("environment"); setCredentialInput(""); }} role="radio" type="button">复用系统环境</button>
          <button aria-checked={credentialSource === "independent"} disabled={!nativeAvailable || pending !== null} onClick={() => setCredentialSource("independent")} role="radio" type="button">使用独立 Key</button>
        </div> : null}
        {provider === "codex" && credentialSource === "independent" ? <div className="runtime-credential-field">
          <label><span><KeyRound aria-hidden="true" size={13} />Codex 独立 Key</span><input aria-label="Codex 独立 Key" autoComplete="new-password" disabled={!nativeAvailable || pending !== null} placeholder={credentialConfigured ? "已配置，不回显" : "输入 API key"} type="password" value={credentialInput} onChange={(event) => setCredentialInput(event.target.value)} /></label>
          <span className="runtime-credential-status">{credentialConfigured ? "已配置" : "尚未配置"}</span>
          {credentialConfigured ? <button aria-label="删除 Codex 独立 Key" className="runtime-credential-delete" disabled={!nativeAvailable || pending !== null} onClick={() => void deleteIndependentCredential()} title="删除独立 Key" type="button"><Trash2 aria-hidden="true" size={14} /></button> : null}
        </div> : null}
        <fieldset className="runtime-environment-fields" disabled={!nativeAvailable || pending !== null || (provider === "codex" && credentialSource === "independent")}>
          <legend>环境引用</legend>
          {ENVIRONMENT_OPTIONS[provider].map((option) => (
            <label key={option.value}><input checked={environmentRefs[provider].includes(option.value)} onChange={(event) => setEnvironmentRefs((current) => ({ ...current, [provider]: event.target.checked ? [...current[provider], option.value] : current[provider].filter((value) => value !== option.value) }))} type="checkbox" />{option.label}</label>
          ))}
        </fieldset>
        <div className="runtime-settings-status" data-status={displayedStatus ?? "unknown"}>
          {displayedStatus === "ready" ? <CheckCircle2 aria-hidden="true" size={16} /> : <Bot aria-hidden="true" size={16} />}
          <span><strong>{readinessLabel(displayedStatus)}</strong><small>{localRuntime ? "配置保存在当前设备" : "测试通过后才会启用"}</small></span>
        </div>
        <div className="runtime-settings-actions">
          {displayedStatus === "missing" ? <button disabled={!nativeAvailable || pending !== null} onClick={() => void installRuntime()} type="button"><Download aria-hidden="true" size={15} />一键安装 {providerLabel}</button> : null}
          <button disabled={!nativeAvailable || pending !== null || !commands[provider].trim()} onClick={() => void testRuntime()} type="button">{pending === "test" ? <RefreshCw aria-hidden="true" className="is-spinning" size={15} /> : <RefreshCw aria-hidden="true" size={15} />}测试 {providerLabel} 配置</button>
          <button disabled={!nativeAvailable || pending !== null || (!localRuntime && serverProfile?.status !== "ready")} onClick={() => void disableRuntime()} type="button"><ShieldOff aria-hidden="true" size={15} />停用 {providerLabel}</button>
        </div>
        {notice ? <p className="runtime-settings-notice" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p> : null}
      </div>
      </section>
      <ModelSiteSettings
        nativeAvailable={nativeAvailable}
        commands={props.localModelCommands ?? null}
      />
    </>
  );
}
