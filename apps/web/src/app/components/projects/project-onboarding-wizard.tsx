"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Panel, StatusPill, WorkbenchButton } from "../workbench-ui";

export type ProjectOnboardingStep = { key: "loops" | "local-rules" | "credentials" | "execution" | "verification"; title: string; description: string; status: "not_started" | "in_progress" | "unverified" | "completed" | "blocked"; href: string | null };

export type ProjectWorkerValidationApi = {
  start(input: { poolId: string }): Promise<{ report: WorkerValidationReport }>;
};

type WorkerValidationReport = {
  status: "passed" | "pending" | "failed" | "executor_not_configured" | "stale_configuration";
  reason: string | null;
  checks: Array<{
    key: "registration" | "heartbeat" | "capabilities" | "configuration_version" | "claim";
    status: "passed" | "pending" | "failed" | "executor_not_configured" | "stale_configuration";
    summary: string;
  }>;
};

export function buildProjectInitCommand(projectId: string): string {
  return `ht init --project ${projectId}`;
}

const localRulesStorageKey = (projectId: string) => `humanthread:onboarding:${projectId}:local-rules`;

export function deriveProjectOnboardingSteps(input: { projectId: string; hasEnabledProjectLoop: boolean; environmentConfiguration: unknown; hasWorkerResource: boolean; repositoryCredentialVerified?: boolean; localRulesVerified?: boolean; workerValidationPassed?: boolean }): ProjectOnboardingStep[] {
  const entries = readEntries(input.environmentConfiguration);
  const missingConfiguration = entries.some((entry) => entry.status === "missing");
  const environmentConfigurationReady = entries.length > 0 && entries.every((entry) => entry.status === "configured");
  const credentialsReady = !missingConfiguration
    && (environmentConfigurationReady || (entries.length === 0 && input.repositoryCredentialVerified === true));
  const prefix = `/projects/${encodeURIComponent(input.projectId)}/settings`;
  return [
    { key: "loops", title: "选择 Loop 范围", description: "先确定项目级 Loop、任务级 Loop 与默认流程。", status: input.hasEnabledProjectLoop ? "completed" : "in_progress", href: `${prefix}?tab=loops` },
    { key: "local-rules", title: "初始化本地规则", description: "在项目目录执行带项目标识的初始化命令，并整理 .humanthread 规则、Skill、MCP 与 Loop 约定。", status: !input.hasEnabledProjectLoop ? "blocked" : input.localRulesVerified ? "completed" : "unverified", href: null },
    { key: "credentials", title: "推导并校验凭证", description: "仅保存来源与状态；项目配置文件优先级最高，不能把敏感值写入平台。", status: !input.hasEnabledProjectLoop ? "blocked" : missingConfiguration ? "blocked" : credentialsReady ? "completed" : "in_progress", href: `${prefix}?tab=environment` },
    { key: "execution", title: "选择执行方式", description: "选择 Local Agent、Docker 或 Kubernetes；Docker 固定 Worker，Kubernetes 允许健康副本迁移。", status: !credentialsReady ? "blocked" : input.hasWorkerResource ? "completed" : "in_progress", href: `${prefix}?tab=workers` },
    { key: "verification", title: "完成并验证", description: "检查 Worker 注册、心跳、能力与无副作用 claim；未配置执行器时必须保持待验证或阻塞。", status: !input.hasEnabledProjectLoop || !credentialsReady || !input.hasWorkerResource ? "blocked" : input.workerValidationPassed ? "completed" : "unverified", href: null },
  ];
}

export function ProjectOnboardingWizard({ projectId, hasEnabledProjectLoop, environmentConfiguration, hasWorkerResource, repositoryCredentialVerified, workerPoolId, workerValidationApi: suppliedWorkerValidationApi }: { projectId: string; hasEnabledProjectLoop: boolean; environmentConfiguration: unknown; hasWorkerResource: boolean; repositoryCredentialVerified?: boolean; workerPoolId?: string; workerValidationApi?: ProjectWorkerValidationApi }) {
  const localRulesVerified = useSyncExternalStore(
    (onStoreChange) => subscribeLocalRulesVerification(projectId, onStoreChange),
    () => readLocalRulesVerification(projectId),
    () => false,
  );
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const locallyVerified = typeof window !== "undefined" && window.localStorage.getItem(localRulesStorageKey(projectId)) === "completed";
    const initialSteps = deriveProjectOnboardingSteps({ projectId, hasEnabledProjectLoop, environmentConfiguration, hasWorkerResource, ...(repositoryCredentialVerified === undefined ? {} : { repositoryCredentialVerified }), localRulesVerified: locallyVerified });
    const firstIncomplete = initialSteps.findIndex((step) => step.status !== "completed");
    return firstIncomplete >= 0 ? firstIncomplete : 0;
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [validationPending, setValidationPending] = useState(false);
  const [validationReport, setValidationReport] = useState<WorkerValidationReport | null>(null);
  const workerValidationApi = useMemo(() => suppliedWorkerValidationApi ?? createWorkerValidationApi(projectId), [projectId, suppliedWorkerValidationApi]);
  const steps = useMemo(() => deriveProjectOnboardingSteps({ projectId, hasEnabledProjectLoop, environmentConfiguration, hasWorkerResource, ...(repositoryCredentialVerified === undefined ? {} : { repositoryCredentialVerified }), localRulesVerified, workerValidationPassed: validationReport?.status === "passed" }), [projectId, hasEnabledProjectLoop, environmentConfiguration, hasWorkerResource, repositoryCredentialVerified, localRulesVerified, validationReport]);
  const firstIncompleteIndex = steps.findIndex((step) => step.status !== "completed");
  const effectiveSelectedIndex = localRulesVerified && selectedIndex === 1 && firstIncompleteIndex > 1 ? firstIncompleteIndex : selectedIndex;
  const selected = steps[effectiveSelectedIndex] ?? steps[0]!;
  const previous = effectiveSelectedIndex > 0 ? steps[effectiveSelectedIndex - 1] : null;
  const nextIncompleteIndex = steps.findIndex((step, index) => index > effectiveSelectedIndex && step.status !== "completed");
  const next = nextIncompleteIndex >= 0 ? steps[nextIncompleteIndex] : null;
  async function copyInitCommand() {
    try {
      await navigator.clipboard.writeText(buildProjectInitCommand(projectId));
      setNotice("初始化命令已复制。请在项目根目录执行后，再点击“我已执行，标记完成”。");
    } catch {
      setNotice("浏览器未能访问剪贴板，请手动复制命令。");
    }
  }
  function confirmLocalRules() {
    window.localStorage.setItem(localRulesStorageKey(projectId), "completed");
    window.dispatchEvent(new Event("humanthread-onboarding-local-rules"));
    setNotice("本地规则初始化已标记完成，下一步将检查凭证配置。");
  }
  function goNext() {
    if (selected.status !== "completed") return;
    if (nextIncompleteIndex >= 0) setSelectedIndex(nextIncompleteIndex);
  }
  function selectStep(index: number) {
    const firstIncomplete = steps.findIndex((step) => step.status !== "completed");
    if (firstIncomplete >= 0 && index > firstIncomplete) {
      setSelectedIndex(firstIncomplete);
      setNotice("请先完成当前步骤，再查看后续步骤。");
      return;
    }
    setNotice(null);
    setSelectedIndex(index);
  }
  async function startWorkerValidation() {
    if (!workerPoolId) {
      setNotice("当前项目尚未绑定 Worker Pool，无法开始校验。");
      return;
    }
    setValidationPending(true);
    setNotice(null);
    setValidationReport(null);
    try {
      const result = await workerValidationApi.start({ poolId: workerPoolId });
      setValidationReport(result.report);
      setNotice(result.report.reason ?? "Worker 校验已通过。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Worker 校验发起失败。");
    } finally {
      setValidationPending(false);
    }
  }
  return <Panel title="开箱向导"><p className="mb-4 text-sm leading-6 text-[#57606a]">每一步都必须完成对应动作并重新校验，不能只移动步骤指示器。平台不会把未验证的外部能力标记为完成。</p><div className="mb-4 border-y border-[#d8dee4] py-3"><p className="text-sm font-semibold text-[#24292f]">当前步骤：{selected.title}</p><p className="mt-1 text-xs leading-5 text-[#57606a]">{selected.description}</p>{selected.key === "local-rules" ? <div className="mt-3 grid gap-2"><code className="block w-fit rounded bg-[#f6f8fa] px-2 py-1 text-xs">{buildProjectInitCommand(projectId)}</code><div className="flex flex-wrap gap-2"><WorkbenchButton type="button" size="small" variant="secondary" onClick={() => void copyInitCommand()}>复制初始化命令</WorkbenchButton><WorkbenchButton type="button" size="small" variant="primary" onClick={confirmLocalRules} disabled={selected.status === "completed"}>我已执行，标记完成</WorkbenchButton></div></div> : null}{selected.key === "verification" ? <div className="mt-3 grid gap-3"><WorkbenchButton type="button" size="small" variant="primary" onClick={() => void startWorkerValidation()} disabled={validationPending}>{validationPending ? "校验中" : validationReport?.status === "pending" ? "重新检查校验结果" : "开始 Worker 校验"}</WorkbenchButton>{validationReport ? <div aria-label="Worker 校验报告" className="overflow-hidden rounded-md border border-[#d0d7de] bg-[#f6f8fa]"><div className="border-b border-[#d8dee4] px-3 py-2"><span className="text-xs font-semibold text-[#24292f]">本次校验结果</span><span className="ml-2 text-xs text-[#57606a]">{validationStatusLabel(validationReport.status)}</span></div><ul className="divide-y divide-[#d8dee4]">{validationReport.checks.map((check) => <li key={check.key} className="flex items-start justify-between gap-3 px-3 py-2 text-xs"><span className="text-[#24292f]">{check.summary}</span><StatusPill tone={check.status === "passed" ? "success" : check.status === "failed" ? "danger" : "warning"}>{validationStatusLabel(check.status)}</StatusPill></li>)}</ul></div> : null}</div> : null}{selected.href ? <div className="mt-3"><WorkbenchButton href={selected.href} size="small" variant="secondary">打开此项配置</WorkbenchButton></div> : null}{notice ? <p role="status" className={`mt-3 text-xs ${validationReport?.status === "failed" ? "text-[#cf222e]" : "text-[#0969da]"}`}>{notice}</p> : null}</div><ol className="grid gap-2">{steps.map((step, index) => <li key={step.key}><button type="button" aria-pressed={selectedIndex === index} aria-label={`选择步骤：${step.title}`} onClick={() => selectStep(index)} className={`grid w-full grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-md border p-3 text-left transition ${selectedIndex === index ? "border-[#0969da] bg-[#ddf4ff]" : "border-[#d0d7de] bg-white hover:border-[#8c959f]"}`}><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f6f8fa] text-sm font-semibold">{index + 1}</span><span><span className="flex flex-wrap items-center gap-2"><strong>{step.title}</strong><StatusPill tone={step.status === "completed" ? "success" : step.status === "blocked" ? "danger" : step.status === "unverified" ? "warning" : "blue"}>{statusLabel(step.status)}</StatusPill></span><span className="mt-1 block text-xs leading-5 text-[#57606a]">{step.description}</span></span></button></li>)}</ol><div className="mt-4 flex flex-wrap gap-2">{previous ? <WorkbenchButton type="button" variant="secondary" onClick={() => setSelectedIndex(selectedIndex - 1)}>上一步</WorkbenchButton> : null}{selected.status === "completed" && next ? <WorkbenchButton type="button" variant="primary" onClick={goNext}>下一步</WorkbenchButton> : selected.href ? <WorkbenchButton href={selected.href} variant="primary">去完成此项</WorkbenchButton> : selected.key === "verification" ? <p className="text-sm text-[#9a6700]">校验通过前，当前步骤会保持待验证。</p> : <p className="text-sm text-[#9a6700]">请先完成当前步骤，再进入下一步。</p>}</div></Panel>;
}

function readLocalRulesVerification(projectId: string): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(localRulesStorageKey(projectId)) === "completed";
}

function subscribeLocalRulesVerification(projectId: string, onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const eventName = "humanthread-onboarding-local-rules";
  const onCustomChange = () => onStoreChange();
  const onStorageChange = (event: StorageEvent) => {
    if (event.key === localRulesStorageKey(projectId)) onStoreChange();
  };
  window.addEventListener(eventName, onCustomChange);
  window.addEventListener("storage", onStorageChange);
  return () => {
    window.removeEventListener(eventName, onCustomChange);
    window.removeEventListener("storage", onStorageChange);
  };
}

function createWorkerValidationApi(projectId: string): ProjectWorkerValidationApi {
  return {
    async start(input) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/worker-validation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", poolId: input.poolId }),
      });
      const body = await response.json() as { ok?: boolean; report?: WorkerValidationReport; error?: string };
      if (!response.ok || !body.ok || !body.report) throw new Error(body.error ?? "Worker 校验发起失败。");
      return { report: body.report };
    },
  };
}

function readEntries(value: unknown): Array<{ status: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const entries = (value as { entries?: unknown }).entries;
  return Array.isArray(entries) ? entries.flatMap((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && typeof (entry as { status?: unknown }).status === "string" ? [{ status: (entry as { status: string }).status }] : []) : [];
}

function statusLabel(status: ProjectOnboardingStep["status"]) { return status === "completed" ? "已完成" : status === "blocked" ? "阻塞" : status === "unverified" ? "待验证" : status === "in_progress" ? "配置中" : "未开始"; }

function validationStatusLabel(status: WorkerValidationReport["status"] | WorkerValidationReport["checks"][number]["status"]) {
  return status === "passed" ? "通过" : status === "pending" ? "等待确认" : status === "failed" ? "失败" : status === "stale_configuration" ? "配置待更新" : "执行器未配置";
}
