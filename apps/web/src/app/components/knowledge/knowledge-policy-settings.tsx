"use client";

import { useState } from "react";

import { StatusPill, WorkbenchButton } from "../workbench-ui";

export const KNOWLEDGE_ENTRY_TYPE_OPTIONS = [
  { value: "rule", label: "规则" },
  { value: "decision", label: "决策" },
  { value: "experience", label: "经验" },
  { value: "interface", label: "接口" },
  { value: "term", label: "术语" },
  { value: "risk", label: "风险" },
  { value: "procedure", label: "流程" },
] as const;

export const KNOWLEDGE_SOURCE_TYPE_OPTIONS = [
  { value: "project_initialization", label: "项目初始化" },
  { value: "task_completion", label: "任务完成" },
  { value: "scheduled_update", label: "定时更新" },
  { value: "manual_update", label: "手工更新" },
  { value: "knowledge_architecture", label: "架构文档" },
] as const;

export interface KnowledgePolicySettingsValue {
  autoPublishEnabled: boolean;
  minimumConfidence: number;
  allowedSourceTypes: string[];
  allowedEntryTypes: string[];
  allowAutomaticDelete: boolean;
  allowAutomaticExpire: boolean;
  allowAutomaticSupersede: boolean;
  subscribeSpaceKnowledge: boolean;
  version: number;
}

interface KnowledgePolicyApi {
  save(input: {
    expectedVersion: number;
    autoPublishEnabled: boolean;
    minimumConfidence: number;
    allowedSourceTypes: string[];
    allowedEntryTypes: string[];
    allowAutomaticDelete: boolean;
    allowAutomaticExpire: boolean;
    allowAutomaticSupersede: boolean;
    subscribeSpaceKnowledge: boolean;
  }): Promise<KnowledgePolicySettingsValue>;
  reload(): Promise<KnowledgePolicySettingsValue>;
}

export function KnowledgePolicySettings({
  projectId,
  initialPolicy,
  api = createBrowserApi(projectId),
}: {
  projectId: string;
  initialPolicy: KnowledgePolicySettingsValue;
  api?: KnowledgePolicyApi;
}) {
  const [policy, setPolicy] = useState(initialPolicy);
  const [autoPublishEnabled, setAutoPublishEnabled] = useState(initialPolicy.autoPublishEnabled);
  const [minimumConfidence, setMinimumConfidence] = useState(initialPolicy.minimumConfidence);
  const [allowedSourceTypes, setAllowedSourceTypes] = useState<string[]>(initialPolicy.allowedSourceTypes);
  const [allowedEntryTypes, setAllowedEntryTypes] = useState<string[]>(initialPolicy.allowedEntryTypes);
  const [allowAutomaticSupersede, setAllowAutomaticSupersede] = useState(initialPolicy.allowAutomaticSupersede);
  const [allowAutomaticExpire, setAllowAutomaticExpire] = useState(initialPolicy.allowAutomaticExpire);
  const [allowAutomaticDelete, setAllowAutomaticDelete] = useState(initialPolicy.allowAutomaticDelete);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setPending(true);
    setMessage(null);
    setNotice(null);
    setSaved(false);
    try {
      const next = await api.save({
        expectedVersion: policy.version,
        autoPublishEnabled,
        minimumConfidence,
        allowedSourceTypes,
        allowedEntryTypes,
        allowAutomaticDelete,
        allowAutomaticExpire,
        allowAutomaticSupersede,
        subscribeSpaceKnowledge: policy.subscribeSpaceKnowledge,
      });
      setPolicy(next);
      applyReloaded(next);
      setSaved(true);
    } catch (error) {
      const conflict = isVersionConflict(error);
      if (conflict) {
        try {
          const current = await api.reload();
          // Keep the user's pending edits; only adopt the fresh version so the
          // next save targets the current row instead of retrying a stale one.
          setPolicy(current);
          setNotice(`策略已被其他会话更新，已刷新到最新版本 v${current.version}，请确认后重试。`);
        } catch {
          setMessage("策略已被其他会话更新。请刷新页面后重试。");
        }
      } else {
        setMessage(error instanceof Error ? error.message : "自动审核配置保存失败，请重试");
      }
    } finally {
      setPending(false);
    }
  }

  function applyReloaded(next: KnowledgePolicySettingsValue) {
    setAutoPublishEnabled(next.autoPublishEnabled);
    setMinimumConfidence(next.minimumConfidence);
    setAllowedSourceTypes(next.allowedSourceTypes);
    setAllowedEntryTypes(next.allowedEntryTypes);
    setAllowAutomaticDelete(next.allowAutomaticDelete);
    setAllowAutomaticExpire(next.allowAutomaticExpire);
    setAllowAutomaticSupersede(next.allowAutomaticSupersede);
  }

  return (
    <section className="grid gap-4 rounded-lg border border-[#d0d7de] bg-white p-4">
      <header className="grid gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-sm font-semibold text-[#24292f]">自动审核</h2>
          <StatusPill tone={policy.autoPublishEnabled ? "success" : "warning"}>
            {policy.autoPublishEnabled ? "已启用" : "未启用"}
          </StatusPill>
        </div>
        <p className="text-xs leading-5 text-[#57606a]">
          启用后，命中所选来源与类型、置信度达标且通过证据、脱敏、冲突、来源活动门禁的候选才会自动发布；任一硬门禁不通过仍进入人工审核。
        </p>
      </header>

      <label className="flex items-center gap-2 text-sm text-[#24292f]">
        <input
          type="checkbox"
          checked={autoPublishEnabled}
          onChange={(event) => setAutoPublishEnabled(event.currentTarget.checked)}
        />
        启用自动审核
      </label>

      <div className="grid gap-2">
        <span className="text-xs font-semibold text-[#24292f]">允许自动发布的来源</span>
        <div className="flex flex-wrap gap-3">
          {KNOWLEDGE_SOURCE_TYPE_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-xs text-[#24292f]">
              <input
                type="checkbox"
                checked={allowedSourceTypes.includes(option.value)}
                onChange={(event) => setAllowedSourceTypes(toggle(allowedSourceTypes, option.value, event.currentTarget.checked))}
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <span className="text-xs font-semibold text-[#24292f]">允许自动发布的知识类型</span>
        <div className="flex flex-wrap gap-3">
          {KNOWLEDGE_ENTRY_TYPE_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-xs text-[#24292f]">
              <input
                type="checkbox"
                checked={allowedEntryTypes.includes(option.value)}
                onChange={(event) => setAllowedEntryTypes(toggle(allowedEntryTypes, option.value, event.currentTarget.checked))}
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>

      <label className="grid gap-1 text-xs font-semibold text-[#24292f]">
        最低置信度（{minimumConfidence.toFixed(2)}）
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={minimumConfidence}
          onChange={(event) => setMinimumConfidence(Number(event.currentTarget.value))}
        />
      </label>

      <details className="grid gap-2 rounded-md border border-[#eaeef2] p-3">
        <summary className="cursor-pointer text-xs font-semibold text-[#24292f]">高风险自动变更</summary>
        <div className="mt-2 grid gap-2">
          <label className="flex items-center gap-2 text-xs text-[#24292f]">
            <input type="checkbox" checked={allowAutomaticSupersede} onChange={(event) => setAllowAutomaticSupersede(event.currentTarget.checked)} />
            允许自动替代（supersede）
          </label>
          <label className="flex items-center gap-2 text-xs text-[#24292f]">
            <input type="checkbox" checked={allowAutomaticExpire} onChange={(event) => setAllowAutomaticExpire(event.currentTarget.checked)} />
            允许自动失效（expire）
          </label>
          <label className="flex items-center gap-2 text-xs text-[#24292f]">
            <input type="checkbox" checked={allowAutomaticDelete} onChange={(event) => setAllowAutomaticDelete(event.currentTarget.checked)} />
            允许自动删除（delete）
          </label>
          <p className="text-[11px] leading-5 text-[#9a6700]">删除与失效不可恢复，请仅在确认来源可信时启用。</p>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2 border-t border-[#d8dee4] pt-3">
        <span className="mr-auto text-xs text-[#57606a]">策略版本 v{policy.version}</span>
        {saved ? <span className="text-xs text-[#1a7f37]">已保存</span> : null}
        {notice ? <span role="status" className="text-xs text-[#9a6700]">{notice}</span> : null}
        {message ? <span role="alert" className="text-xs text-[#cf222e]">{message}</span> : null}
        <WorkbenchButton type="button" size="small" variant="primary" disabled={pending} onClick={() => void save()}>
          {pending ? "保存中" : "保存"}
        </WorkbenchButton>
      </div>
    </section>
  );
}

function toggle(values: string[], value: string, checked: boolean): string[] {
  return checked ? [...new Set([...values, value])] : values.filter((item) => item !== value);
}

function isVersionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "code" in error && (error as { code?: unknown }).code === "version_conflict";
}

function createBrowserApi(projectId: string): KnowledgePolicyApi {
  return {
    async save(input) {
      const body = await request(`/api/projects/${encodeURIComponent(projectId)}/knowledge/policy`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      return body.policy;
    },
    async reload() {
      const body = await request(`/api/projects/${encodeURIComponent(projectId)}/knowledge/policy`, { method: "GET" });
      return body.policy;
    },
  };
}

async function request(
  url: string,
  init: RequestInit,
): Promise<{ policy: KnowledgePolicySettingsValue }> {
  const response = await fetch(url, init);
  const body = await readJsonBody(response) as {
    ok?: boolean;
    policy?: KnowledgePolicySettingsValue;
    error?: string;
    code?: string;
  };
  if (!body || !response.ok || !body.ok || !body.policy) {
    throw Object.assign(new Error(body.error ?? "自动审核配置保存失败，请重试"), {
      code: body.code ?? (response.status === 409 ? "version_conflict" : "request_failed"),
      status: response.status,
    });
  }
  return { policy: body.policy };
}

// A deployment can briefly answer with an empty body while a container is being
// replaced. Reporting the raw JSON parse failure ("Unexpected end of JSON
// input") hides that, so surface a retryable message instead.
async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) {
    throw Object.assign(new Error("服务暂时不可用，请稍后重试"), {
      code: "empty_response",
      status: response.status,
    });
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error("服务返回了无法解析的响应，请稍后重试"), {
      code: "invalid_response",
      status: response.status,
    });
  }
}
