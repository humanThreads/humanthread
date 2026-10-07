"use client";

import { LOOP_AUTOMATION_POLICY_VERSION } from "@humanthread/shared";
import { ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import type { ProjectLoopGrantScope } from "./project-loop-flow";
import { WorkbenchButton } from "../workbench-ui";

export interface AutomationGrantProject {
  id: string;
  name: string;
  spaceId: string;
  workspaceBindings: Array<{
    id: string;
    deviceId: string;
    deviceName: string;
    status: "ready" | "revoked";
    configurationVersion: number;
  }>;
}

export interface AutomationGrantDraft {
  id: string;
  spaceId: string;
  projectId: string;
  bindingIds: string[];
  nodeKeys: string[];
  executionPlanes: Array<"local" | "platform">;
  deviceIds: string[];
  workerIds: string[];
  agentProfileIds: string[];
  providers: string[];
  permission: "none" | "read_only" | "workspace_full";
  workspaceBindingIds: string[];
  allowedRelativePathPrefixes: string[];
  tools: string[];
  commandCategories: string[];
  operationTypes: string[];
  networkTargets: string[];
  recipients: string[];
  credentialRefs: string[];
  allowProduction: false;
  limits: {
    maxConcurrency: number;
    maxDurationMs: number;
    maxTokens: number;
    maxCostUsd: number;
    maxToolCalls: number;
  };
  policyVersion: string;
  status: "active";
  confirmedAt: string;
  expiresAt: string | null;
  revokedAt: null;
}

export interface AutomationGrantBindingOption {
  id: string;
  label: string;
  grantScope: ProjectLoopGrantScope;
}

export function AutomationGrantDialog({
  open,
  project,
  bindings,
  agentProfileIds,
  providers,
  onClose,
  onConfirm,
}: {
  open: boolean;
  project: AutomationGrantProject;
  bindings: AutomationGrantBindingOption[];
  agentProfileIds: string[];
  providers: Array<"codex" | "claude">;
  onClose(): void;
  onConfirm(grant: AutomationGrantDraft): void | Promise<void>;
}) {
  const [workspaceBindingIds, setWorkspaceBindingIds] = useState(() =>
    project.workspaceBindings.filter(({ status }) => status === "ready").map(({ id }) => id));
  const [relativePaths, setRelativePaths] = useState(".");
  const [workspaceFull, setWorkspaceFull] = useState(false);
  const [bindingIds, setBindingIds] = useState(() => bindings.map((binding) => binding.id));
  const [expiryDays, setExpiryDays] = useState("7");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasWorkspaceScope = workspaceBindingIds.length > 0;

  if (!open) return null;

  async function confirm() {
    const allowedRelativePathPrefixes = hasWorkspaceScope
      ? parseRelativePaths(relativePaths)
      : [];
    if (bindingIds.length === 0) {
      setError("请先保存项目 Loop 绑定，再创建自动化授权");
      return;
    }
    if (agentProfileIds.length === 0 || providers.length === 0) {
      setError("请选择可执行的 Agent Profile 和 Provider");
      return;
    }
    const grantScope = mergeBindingGrantScopes(bindings, bindingIds);
    if (grantScope.nodeKeys.length === 0 || grantScope.executionPlanes.length === 0) {
      setError("所选 Loop 绑定没有可授权的执行节点，请重新发布 Loop 后重试");
      return;
    }
    if (allowedRelativePathPrefixes === null) {
      setError("相对路径必须为 . 或不包含空段、.、.. 的项目内路径");
      return;
    }
    setPending(true);
    setError(null);
    const confirmedAt = new Date();
    const days = Number(expiryDays);
    const expiresAt = days === 0
      ? null
      : new Date(confirmedAt.getTime() + days * 24 * 60 * 60 * 1_000).toISOString();
    try {
      await onConfirm({
        id: `grant_${commandId()}`,
        spaceId: project.spaceId,
        projectId: project.id,
        bindingIds: [...bindingIds].sort(),
        nodeKeys: grantScope.nodeKeys,
        executionPlanes: grantScope.executionPlanes,
        deviceIds: selectedWorkspaceDevices(project, workspaceBindingIds),
        workerIds: selectedWorkspaceDevices(project, workspaceBindingIds).map((id) => `local-worker:${id}`),
        agentProfileIds: [...new Set(agentProfileIds)].sort(),
        providers: sorted([...providers, ...grantScope.providers]),
        permission: !hasWorkspaceScope
          ? "none"
          : workspaceFull ? "workspace_full" : "read_only",
        workspaceBindingIds: [...new Set(workspaceBindingIds)].sort(),
        allowedRelativePathPrefixes,
        tools: sorted([
          ...(hasWorkspaceScope ? ["filesystem", "git", "shell"] : []),
          ...grantScope.tools,
        ]),
        commandCategories: sorted([
          ...(hasWorkspaceScope ? ["build", "dependency_install", "git", "test"] : []),
          ...grantScope.commandCategories,
        ]),
        operationTypes: sorted([
          ...(!hasWorkspaceScope
            ? []
            : workspaceFull
              ? ["workspace.delete", "workspace.read", "workspace.write"]
              : ["workspace.read"]),
          ...grantScope.operationTypes,
        ]),
        networkTargets: grantScope.networkTargets,
        recipients: grantScope.recipients,
        credentialRefs: grantScope.credentialRefs,
        allowProduction: false,
        limits: {
          maxConcurrency: 1,
          maxDurationMs: 3_600_000,
          maxTokens: 100_000,
          maxCostUsd: 10,
          maxToolCalls: 1_000,
        },
        policyVersion: LOOP_AUTOMATION_POLICY_VERSION,
        status: "active",
        confirmedAt: confirmedAt.toISOString(),
        expiresAt,
        revokedAt: null,
      });
    } catch (cause) {
      setError(automationGrantFailureMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#24292f66] p-4" role="presentation">
      <section className="w-full max-w-xl rounded-md border border-[#d0d7de] bg-white shadow-xl" role="dialog" aria-modal="true" aria-label="新建自动化授权">
        <header className="flex items-center justify-between border-b border-[#d0d7de] px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 text-[#1f883d]" />
            <h2 className="text-sm font-semibold text-[#24292f]">新建自动化授权</h2>
          </div>
          <button type="button" className="grid h-7 w-7 place-items-center" disabled={pending} onClick={onClose} aria-label="关闭自动化授权">
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </header>
        <div className="grid max-h-[70vh] gap-4 overflow-y-auto px-4 py-4">
          <fieldset className="grid gap-2">
            <legend className="text-xs font-semibold text-[#24292f]">设备 Workspace</legend>
            {project.workspaceBindings.length === 0 ? <p className="text-xs text-[#8c5e00]">当前项目还没有设备 Workspace 配置。</p> : project.workspaceBindings.map((workspace) => (
              <label key={workspace.id} className="flex min-w-0 items-start gap-2 text-sm text-[#24292f]">
                <input
                  aria-label={workspace.deviceName}
                  type="checkbox"
                  className="mt-0.5"
                  disabled={workspace.status !== "ready"}
                  checked={workspaceBindingIds.includes(workspace.id)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    if (!checked && workspaceBindingIds.length === 1) setWorkspaceFull(false);
                    setWorkspaceBindingIds((current) => checked
                      ? [...new Set([...current, workspace.id])]
                      : current.filter((id) => id !== workspace.id));
                  }}
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">{workspace.deviceName} · 配置 v{workspace.configurationVersion}{workspace.status === "ready" ? "" : " · 已撤销"}</span>
              </label>
            ))}
          </fieldset>
          <label className="text-xs font-medium text-[#57606a]">
            允许的项目相对路径
            <textarea
              aria-describedby="grant-relative-path-help"
              disabled={!hasWorkspaceScope}
              value={relativePaths}
              onChange={(event) => setRelativePaths(event.currentTarget.value)}
              rows={3}
              className="mt-1 w-full resize-y rounded-md border border-[#d0d7de] px-3 py-2 font-mono text-xs text-[#24292f] outline-none focus:border-[#1f883d] focus:ring-2 focus:ring-[#1f883d22]"
            />
          </label>
          <p id="grant-relative-path-help" className="text-xs leading-5 text-[#57606a]">{hasWorkspaceScope ? <>每行一个范围；<code>.</code> 表示完整项目 Workspace。</> : "未选择 Workspace，此授权不包含本地文件、Git 或 Shell 权限。"}</p>
          <fieldset className="grid gap-2">
            <legend className="text-xs font-semibold text-[#24292f]">适用绑定</legend>
            {bindings.length === 0 ? <p className="text-xs text-[#6e7781]">授权可先创建，保存绑定时再选择。</p> : bindings.map((binding) => (
              <label key={binding.id} className="flex items-center gap-2 text-sm text-[#24292f]">
                <input
                  type="checkbox"
                  checked={bindingIds.includes(binding.id)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setBindingIds((current) => checked
                      ? [...new Set([...current, binding.id])]
                      : current.filter((id) => id !== binding.id));
                  }}
                />
                {binding.label}
              </label>
            ))}
          </fieldset>
          <label className="flex items-start gap-2 text-sm text-[#24292f]">
            <input aria-label="允许项目 Workspace 内自动修改" type="checkbox" disabled={!hasWorkspaceScope} checked={workspaceFull && hasWorkspaceScope} onChange={(event) => setWorkspaceFull(event.currentTarget.checked)} className="mt-1" />
            <span><span className="font-semibold">允许项目 Workspace 内自动修改</span><span className="mt-1 block text-xs leading-5 text-[#57606a]">读写、删除、构建、测试、依赖安装和本地 Git 操作无需逐次确认。</span></span>
          </label>
          {workspaceFull && hasWorkspaceScope ? (
            <div className="rounded-md border border-[#d4a72c66] bg-[#fff8c5] p-3 text-xs leading-5 text-[#633c01]">
              <div className="font-semibold">授权边界：<code>{relativePathSummary(relativePaths)}</code></div>
              <div className="mt-1">不包含 Git 推送、外部收件人、生产系统和 Workspace 外路径</div>
            </div>
          ) : null}
          <label className="text-xs font-medium text-[#57606a]">
            有效期
            <select value={expiryDays} onChange={(event) => setExpiryDays(event.currentTarget.value)} className="mt-1 w-full rounded-md border border-[#d0d7de] bg-white px-2 py-2 text-sm text-[#24292f]">
              <option value="1">1 天</option>
              <option value="7">7 天</option>
              <option value="30">30 天</option>
              <option value="0">长期，直至撤销</option>
            </select>
          </label>
          {error ? <p role="alert" className="text-xs text-[#cf222e]">{error}</p> : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-[#d0d7de] px-4 py-3">
          <WorkbenchButton type="button" size="small" disabled={pending} onClick={onClose}>取消</WorkbenchButton>
          <WorkbenchButton type="button" size="small" variant="primary" disabled={pending || (hasWorkspaceScope && !relativePaths.trim())} onClick={confirm}>
            {pending ? "授权中" : "确认授权"}
          </WorkbenchButton>
        </footer>
      </section>
    </div>
  );
}

function mergeBindingGrantScopes(
  bindings: AutomationGrantBindingOption[],
  bindingIds: string[],
): ProjectLoopGrantScope {
  const selected = new Set(bindingIds);
  const scopes = bindings.filter(({ id }) => selected.has(id)).map(({ grantScope }) => grantScope);
  return {
    nodeKeys: sorted(scopes.flatMap(({ nodeKeys }) => nodeKeys)),
    executionPlanes: sorted(scopes.flatMap(({ executionPlanes }) => executionPlanes)) as Array<"local" | "platform">,
    providers: sorted(scopes.flatMap(({ providers }) => providers)),
    tools: sorted(scopes.flatMap(({ tools }) => tools)),
    commandCategories: sorted(scopes.flatMap(({ commandCategories }) => commandCategories)),
    operationTypes: sorted(scopes.flatMap(({ operationTypes }) => operationTypes)),
    networkTargets: sorted(scopes.flatMap(({ networkTargets }) => networkTargets)),
    recipients: sorted(scopes.flatMap(({ recipients }) => recipients)),
    credentialRefs: sorted(scopes.flatMap(({ credentialRefs }) => credentialRefs)),
  };
}

function sorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function automationGrantFailureMessage(cause: unknown): string {
  const status = cause && typeof cause === "object" && "status" in cause ? Reflect.get(cause, "status") : null;
  if (status === 404) return "项目 Loop 或自动化授权已不存在，请刷新页面后重试";
  return cause instanceof Error ? cause.message : "自动化授权创建失败";
}

function selectedWorkspaceDevices(
  project: AutomationGrantProject,
  workspaceBindingIds: string[],
): string[] {
  const selected = new Set(workspaceBindingIds);
  return [...new Set(project.workspaceBindings
    .filter(({ id, status }) => selected.has(id) && status === "ready")
    .map(({ deviceId }) => deviceId))].sort();
}

function parseRelativePaths(value: string): string[] | null {
  const paths = [...new Set(value.split(/\r?\n/u).map((path) => path.trim()).filter(Boolean))].sort();
  if (paths.length === 0 || paths.length > 128) return null;
  return paths.every((path) => path === "." || (
    path.length <= 512
    && !path.startsWith("/")
    && !path.includes("\\")
    && !/^[a-z]:/iu.test(path)
    && !/[\0-\x1f\x7f]/u.test(path)
    && path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  )) ? paths : null;
}

function relativePathSummary(value: string): string {
  const paths = parseRelativePaths(value);
  if (!paths) return "无效相对路径";
  return paths.map((path) => path === "." ? "项目根目录（.）" : path).join("、");
}

function commandId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `loop-${Date.now().toString(36)}`;
}
