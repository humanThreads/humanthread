"use client";

import { Play, Plus, ShieldOff, Unlink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { isWorkerBranchPattern } from "@humanthread/shared";
import type { ProjectLoopGroupConfig } from "@humanthread/shared";
import { DangerConfirmDialog } from "../settings-dialog";
import { StatusPill, WorkbenchButton } from "../workbench-ui";
import {
  AutomationGrantDialog,
  type AutomationGrantBindingOption,
  type AutomationGrantDraft,
  type AutomationGrantProject,
} from "./automation-grant-dialog";
import type { ProjectLoopGrantScope } from "./project-loop-flow";

export type WorkerReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export interface WorkerExecutionConfiguration {
  poolId: string;
  repositoryUrl: string;
  branchPolicy: { allowedBranches: string[] };
  stageConfigurations: Record<string, {
    siteId: string;
    model: string;
    reasoningEffort: WorkerReasoningEffort;
    requireGitDelivery?: boolean;
  }>;
}

export interface ProjectWorkerResource {
  poolId: string;
  repositoryUrl: string;
  branchPolicy: { allowedBranches: string[] };
  image?: { repository: string; tag: string; digest: string; resolvedAt?: string };
  imageVersionId?: string;
}

export interface WorkerExecutionOptions {
  pools: Array<{ id: string; displayName: string; status: "active" | "revoked" }>;
  sites: Array<{ id: string; name: string; endpoint: string; status: "active" | "revoked" }>;
}

export interface ProjectLoopSettingsModel {
  project: AutomationGrantProject & {
    version?: number;
    loopGroupConfig?: ProjectLoopGroupConfig | null;
    workerResource?: ProjectWorkerResource;
    developmentMode?: {
      key: string;
      name: string;
      origin?: "platform" | "space" | null;
      kind?: string | null;
      description?: string | null;
      version: number | null;
      productionBranch: string | null;
      stagingBranch: string | null;
      releaseAgentProfileId: string | null;
      config: Record<string, unknown>;
      executionPolicy: Record<string, unknown>;
      triggerPolicy: Record<string, unknown>;
      loopGroupConfig?: ProjectLoopGroupConfig | null;
      developmentLoopVersionId: string | null;
      releaseLoopVersionId: string | null;
    };
  };
  definitions: Array<{
    id: string;
    name: string;
    scope?: "task" | "project";
    description?: string | null;
    role?: "task_development" | "milestone_release";
    flow?: Array<{
      key: string;
      label: string;
      type: string;
      detail: string | null;
      outcomes: string[];
    }>;
    versions: Array<{
      id: string;
      versionNumber: number;
      subloopDefinitionIds?: string[];
      humanGateCount: number;
      maxStages: number;
      maxRepeatCount: number;
      agentNodeKeys: string[];
      agentNodeLabels?: Record<string, string>;
      flow?: Array<{
        key: string;
        label: string;
        type: string;
        detail: string | null;
        outcomes: string[];
      }>;
      grantScope?: ProjectLoopGrantScope;
    }>;
  }>;
  bindings: Array<{
    id: string;
    loopDefinitionId: string;
    activeVersionId: string;
    bindingRole?: "task_development" | "milestone_release";
    status: "enabled" | "disabled";
    version: number;
    triggerPolicy: { manual: boolean; taskEvents: string[] };
    automationGrantIds: string[];
    allowedAgentProfileIds?: string[];
    allowedProviders?: Array<"codex" | "claude">;
    workerExecution?: WorkerExecutionConfiguration;
  }>;
  agentProfiles: Array<{ id: string; name: string; provider: "codex" | "claude"; capabilities: string[] }>;
  providerReadiness: Array<{ provider: "codex" | "claude"; adapterRegistered: boolean; readyRuntimeCount: number; available: boolean; reason: string | null }>;
  grants: Array<{
    id: string;
    status: "active" | "revoked";
    permission: "none" | "read_only" | "workspace_full";
    workspaceBindingIds: string[];
    allowedRelativePathPrefixes: string[];
    bindingIds: string[];
    expiresAt: string | null;
    revokedAt: string | null;
  }>;
  triggerTypes: Array<"manual" | "task_event">;
}

export interface ProjectLoopSettingsApi {
  saveBinding(input: {
    expectedVersion?: number;
    loopDefinitionId: string;
    activeVersionId: string;
    bindingRole?: "task_development" | "milestone_release";
    status: "enabled" | "disabled";
    triggerPolicy: { manual: boolean; taskEvents: string[] };
    parameterOverrides: Record<string, unknown>;
    notificationPolicy: Record<string, unknown>;
    automationGrantIds: string[];
    allowedAgentProfileIds: string[];
    allowedProviders: Array<"codex" | "claude">;
    workerStageConfigurations?: WorkerExecutionConfiguration["stageConfigurations"];
  }): Promise<unknown>;
  saveLoopGroupConfig?(input: { expectedVersion: number; config: ProjectLoopGroupConfig }): Promise<unknown>;
  saveWorkerResource?(input: {
    expectedVersion: number;
    poolId: string;
    repositoryUrl: string;
    branchPolicy: { allowedBranches: string[] };
  }): Promise<unknown>;
  trigger(bindingId: string, payload: Record<string, unknown>): Promise<unknown>;
  createGrant(grant: AutomationGrantDraft): Promise<unknown>;
  revokeGrant(grantId: string): Promise<unknown>;
  readBindingVersion?(loopDefinitionId: string): Promise<number | null>;
  unbindTaskLoop?(bindingId: string, expectedVersion: number): Promise<unknown>;
  loadWorkerExecutionOptions?(): Promise<WorkerExecutionOptions>;
}

export function ProjectLoopBindings({
  model,
  api: suppliedApi,
  variant = "all",
}: {
  model: ProjectLoopSettingsModel;
  api?: ProjectLoopSettingsApi;
  variant?: "all" | "workflow";
}) {
  const api = useMemo(() => suppliedApi ?? createBrowserApi(model.project.id), [model.project.id, suppliedApi]);
  const developmentMode = model.project.developmentMode;
  const templateRootDefinitions = developmentMode
    ? model.definitions.filter((item) => item.role === "task_development" || item.role === "milestone_release")
    : model.definitions;
  const templateTaskDefinitionIds = new Set(templateRootDefinitions.flatMap((definition) =>
    definition.versions.flatMap((version) => version.subloopDefinitionIds ?? []),
  ));
  const versionBindingDefinitions = developmentMode
    ? model.definitions.filter((item) => templateRootDefinitions.includes(item) || templateTaskDefinitionIds.has(item.id))
    : model.definitions;
  const initialActiveGrantIds = new Set(model.grants.filter((grant) => grant.status === "active").map((grant) => grant.id));
  const initialDefinitionId = versionBindingDefinitions[0]?.id ?? "";
  const initialBinding = findBindingForDefinition(model.bindings, initialDefinitionId, versionBindingDefinitions[0]?.role);
  const [definitionId, setDefinitionId] = useState(initialDefinitionId);
  const definition = model.definitions.find((item) => item.id === definitionId);
  const [versionId, setVersionId] = useState(initialBinding?.activeVersionId ?? definition?.versions[0]?.id ?? "");
  const selectedVersion = definition?.versions.find((version) => version.id === versionId);
  const existing = findBindingForDefinition(model.bindings, definitionId, definition?.role);
  const [manual, setManual] = useState(initialBinding?.triggerPolicy.manual ?? true);
  const [taskEvents, setTaskEvents] = useState((initialBinding?.triggerPolicy.taskEvents.length ?? 0) > 0);
  const [enabled, setEnabled] = useState(initialBinding?.status !== "disabled");
  const [selectedGrantIds, setSelectedGrantIds] = useState(
    (initialBinding?.automationGrantIds ?? []).filter((id) => initialActiveGrantIds.has(id)),
  );
  const [selectedProfileId, setSelectedProfileId] = useState(initialBinding?.allowedAgentProfileIds?.[0] ?? model.agentProfiles[0]?.id ?? "");
  const [selectedProviders, setSelectedProviders] = useState<Array<"codex" | "claude">>(initialBinding?.allowedProviders ?? []);
  const initialWorkerExecution = initialBinding?.workerExecution;
  const [linuxWorkerEnabled, setLinuxWorkerEnabled] = useState(initialWorkerExecution !== undefined);
  const [workerPoolId, setWorkerPoolId] = useState(model.project.workerResource?.poolId ?? "");
  const [workerRepositoryUrl, setWorkerRepositoryUrl] = useState(model.project.workerResource?.repositoryUrl ?? "");
  const [workerAllowedBranches, setWorkerAllowedBranches] = useState(model.project.workerResource?.branchPolicy.allowedBranches.join("\n") ?? "");
  const [workerStageConfigurations, setWorkerStageConfigurations] = useState<WorkerExecutionConfiguration["stageConfigurations"]>(() => (
    stageConfigurationsForVersion(definition?.versions[0], initialWorkerExecution)
  ));
  const [projectVersion, setProjectVersion] = useState(model.project.version ?? 1);
  const [workerOptions, setWorkerOptions] = useState<WorkerExecutionOptions>({ pools: [], sites: [] });
  const [grantOpen, setGrantOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "status" | "error"; text: string } | null>(null);
  const [workerResourceNotice, setWorkerResourceNotice] = useState<{ tone: "status" | "error"; text: string } | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [bindingStatuses, setBindingStatuses] = useState<Record<string, "enabled" | "disabled">>(() =>
    Object.fromEntries(model.bindings.map((binding) => [binding.id, binding.status])),
  );
  const [grantStatuses, setGrantStatuses] = useState<Record<string, "active" | "revoked">>(() =>
    Object.fromEntries(model.grants.map((grant) => [grant.id, grant.status])),
  );
  const activeGrants = model.grants.filter((grant) => (grantStatuses[grant.id] ?? grant.status) === "active");
  const activeGrantIds = new Set(activeGrants.map((grant) => grant.id));
  const enabledBindings = model.bindings.filter(
    (binding) => (bindingStatuses[binding.id] ?? binding.status) === "enabled",
  );

  useEffect(() => {
    if (!api.loadWorkerExecutionOptions) return;
    void api.loadWorkerExecutionOptions()
      .then(setWorkerOptions)
      .catch(() => setNotice({ tone: "error", text: "无法加载 Linux Worker 配置资源" }));
  }, [api]);

  function selectDefinition(nextId: string) {
    const nextDefinition = model.definitions.find((item) => item.id === nextId);
    const nextBinding = findBindingForDefinition(model.bindings, nextId, nextDefinition?.role);
    setDefinitionId(nextId);
    setVersionId(nextBinding?.activeVersionId ?? nextDefinition?.versions[0]?.id ?? "");
    setManual(nextBinding?.triggerPolicy.manual ?? true);
    setTaskEvents((nextBinding?.triggerPolicy.taskEvents.length ?? 0) > 0);
    setEnabled(nextBinding?.status !== "disabled");
    setSelectedGrantIds((nextBinding?.automationGrantIds ?? []).filter((id) => activeGrantIds.has(id)));
    setSelectedProfileId(nextBinding?.allowedAgentProfileIds?.[0] ?? model.agentProfiles[0]?.id ?? "");
    setSelectedProviders(nextBinding?.allowedProviders ?? []);
    const workerExecution = nextBinding?.workerExecution;
    setLinuxWorkerEnabled(workerExecution !== undefined);
    const nextVersion = nextDefinition?.versions.find((version) => version.id === (nextBinding?.activeVersionId ?? nextDefinition.versions[0]?.id));
    setWorkerStageConfigurations(stageConfigurationsForVersion(nextVersion, workerExecution));
    setNotice(null);
    setLastRunId(null);
  }

  function selectVersion(nextVersionId: string) {
    const nextVersion = definition?.versions.find((version) => version.id === nextVersionId);
    setVersionId(nextVersionId);
    setWorkerStageConfigurations((current) => stageConfigurationsForVersion(nextVersion, undefined, current));
  }

  function updateWorkerStage(nodeKey: string, field: "siteId" | "model" | "reasoningEffort" | "requireGitDelivery", value: string | boolean) {
    setWorkerStageConfigurations((current) => ({
      ...current,
      [nodeKey]: field === "reasoningEffort"
        ? {
          ...(current[nodeKey] ?? emptyWorkerStageConfiguration()),
          reasoningEffort: typeof value === "string" && isWorkerReasoningEffort(value) ? value : "medium",
        }
        : { ...(current[nodeKey] ?? emptyWorkerStageConfiguration()), [field]: value },
    }));
  }

  async function triggerBinding(bindingId: string) {
    const result = await api.trigger(bindingId, {});
    const record = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : null;
    const runId = record && typeof record.id === "string" ? record.id : record && typeof record.loopRunId === "string" ? record.loopRunId : null;
    setLastRunId(runId);
    return result;
  }

  async function execute(action: () => Promise<unknown>, success: string) {
    setPending(true);
    setNotice(null);
    try {
      await action();
      setNotice({ tone: "status", text: success });
    } catch (cause) {
      setNotice({ tone: "error", text: loopFailureMessage(cause) });
    } finally {
      setPending(false);
    }
  }

  async function saveBinding() {
    if (!definitionId || !versionId) return;
    const workerStageConfiguration = linuxWorkerEnabled
      ? workerStageConfigurationInput({
          stageConfigurations: workerStageConfigurations,
          agentNodeKeys: selectedVersion?.agentNodeKeys ?? [],
          options: workerOptions,
        })
      : null;
    if (linuxWorkerEnabled && !workerStageConfiguration) {
      setNotice({ tone: "error", text: "请为每个 Agent 节点配置模型站点、模型与推理强度。" });
      return;
    }
    const bindingRole = existing?.bindingRole ?? definition?.role;
    const bindingInput: Parameters<ProjectLoopSettingsApi["saveBinding"]>[0] = {
      ...(existing ? { expectedVersion: existing.version } : {}),
      loopDefinitionId: definitionId,
      activeVersionId: versionId,
      ...(bindingRole === undefined ? {} : { bindingRole }),
      status: enabled ? "enabled" : "disabled",
      triggerPolicy: { manual, taskEvents: taskEvents ? ["task.completed"] : [] },
      parameterOverrides: {},
      notificationPolicy: {},
      automationGrantIds: selectedGrantIds.filter((id) => activeGrantIds.has(id)),
      allowedAgentProfileIds: selectedProfileId ? [selectedProfileId] : [],
      allowedProviders: selectedProviders,
      ...(workerStageConfiguration ? { workerStageConfigurations: workerStageConfiguration } : {}),
    };
    await execute(async () => {
      try {
        await api.saveBinding(bindingInput);
      } catch (cause) {
        if (!isVersionConflict(cause) || !api.readBindingVersion) throw cause;
        const currentVersion = await api.readBindingVersion(definitionId);
        if (currentVersion === null) throw cause;
        await api.saveBinding({ ...bindingInput, expectedVersion: currentVersion });
      }
    }, "绑定已保存；保存操作不会创建运行");
  }

  async function saveWorkerResource() {
    if (!api.saveWorkerResource) {
      setWorkerResourceNotice({ tone: "error", text: "当前客户端不支持保存项目 Linux Worker 资源。" });
      return;
    }
    const resource = projectWorkerResourceInput({
      poolId: workerPoolId,
      repositoryUrl: workerRepositoryUrl,
      allowedBranches: workerAllowedBranches,
      options: workerOptions,
    });
    if (!resource) {
      setWorkerResourceNotice({ tone: "error", text: "请完整配置项目的 Worker Pool、仓库和分支策略。Worker 镜像请在 Worker 部署中从目录选择。" });
      return;
    }
    setPending(true);
    setWorkerResourceNotice(null);
    try {
      const result = await api.saveWorkerResource({ expectedVersion: projectVersion, ...resource });
      const version = result && typeof result === "object" && !Array.isArray(result) ? Reflect.get(result, "version") : null;
      if (!Number.isInteger(version) || (version as number) < 1) throw new Error("项目 Linux Worker 资源保存结果无效");
      setProjectVersion(version as number);
      setWorkerResourceNotice({ tone: "status", text: "项目 Linux Worker 资源已保存；后续运行将使用新配置。" });
    } catch (cause) {
      setWorkerResourceNotice({ tone: "error", text: loopFailureMessage(cause) });
    } finally {
      setPending(false);
    }
  }

  async function unbindTaskLoop(bindingId: string, expectedVersion: number) {
    if (!api.unbindTaskLoop) return;
    setPending(true);
    setNotice(null);
    try {
      await api.unbindTaskLoop(bindingId, expectedVersion);
      setBindingStatuses((current) => ({ ...current, [bindingId]: "disabled" }));
      setNotice({ tone: "status", text: "任务 Loop 已解绑" });
    } catch (cause) {
      setNotice({ tone: "error", text: unbindFailureMessage(cause) });
    } finally {
      setPending(false);
    }
  }

  const bindingOptions: AutomationGrantBindingOption[] = enabledBindings.map((binding) => {
    const boundDefinition = model.definitions.find((item) => item.id === binding.loopDefinitionId);
    const version = boundDefinition?.versions.find((item) => item.id === binding.activeVersionId);
    return {
      id: binding.id,
      label: `${boundDefinition?.name ?? "Loop"} v${version?.versionNumber ?? "?"}`,
      grantScope: version?.grantScope ?? emptyGrantScope(),
    };
  });

  const flowDefinitions = [...model.definitions]
    .filter((item) => item.flow?.length && (!developmentMode || item.role))
    .sort((left, right) => {
      const rank = (role?: string) => role === "task_development" ? 0 : role === "milestone_release" ? 1 : 2;
      return rank(left.role) - rank(right.role);
    });
  const taskDefinitions = model.definitions.filter((item) => item.scope === "task" && (!developmentMode || templateTaskDefinitionIds.has(item.id)));

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]">
      {(variant === "workflow" || model.project.loopGroupConfig || developmentMode?.loopGroupConfig) && api.saveLoopGroupConfig ? <ProjectLoopGroupConfiguration model={model} api={api} projectVersion={projectVersion} onProjectVersionChange={setProjectVersion} /> : null}
      {variant === "all" ? <section className="min-w-0 border-y border-[#d0d7de] bg-white lg:col-span-2">
        <header className="border-b border-[#d0d7de] px-4 py-3">
          <h2 className="text-sm font-semibold text-[#24292f]">开发模式说明</h2>
          <p className="mt-1 text-xs text-[#57606a]">开发模式决定任务如何隔离、何时进入预发，以及谁可以将预发结果发布到生产。</p>
        </header>
        {developmentMode ? <div className="grid gap-4 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><strong className="text-[#24292f]">当前模式：{developmentMode.name}</strong><StatusPill tone="success">已配置</StatusPill><span className="text-xs text-[#57606a]">{developmentMode.key}{developmentMode.version ? ` · v${developmentMode.version}` : ""}</span></div>
          {developmentMode.key === "branch-development" ? <>
            <p className="max-w-4xl leading-6 text-[#57606a]">任务开发只提交到独立任务分支，不直接更新预发；触发里程碑发版时，发版 Loop 会读取该里程碑的全部任务分支及其文档、知识和测试报告，合入预发并重跑业务测试，通过人工确认后才合入生产。</p>
            <dl className="grid gap-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
              <ModeFact label="任务分支规则" value={stringConfig(developmentMode, "taskBranchPattern", "{year}-{shortId}")} />
              <ModeFact label="任务分支基线" value={stringConfig(developmentMode, "taskBranchBase", "staging")} />
              <ModeFact label="预发分支" value={developmentMode.stagingBranch ?? "未设置"} mono />
              <ModeFact label="生产分支" value={developmentMode.productionBranch ?? "未设置"} mono />
              <ModeFact label="发版触发" value="里程碑完成 / 手动" />
              <ModeFact label="生产确认" value={stringConfig(developmentMode, "productionApprovalRequired", "true") === "true" ? "需要人工确认" : "无需人工确认"} />
            </dl>
          </> : <p className="max-w-4xl leading-6 text-[#57606a]">该模板的项目约束已生效。具体执行步骤、平台动作和人工门禁以当前已发布 Loop 的流程预览为准。</p>}
        </div> : <div className="p-4 text-sm leading-6 text-[#57606a]">尚未配置开发模式。配置后，项目会获得一组项目级开发约束和对应的任务开发、里程碑 Loop；未配置时，项目 Loop 仍可按通用 Loop 单独绑定。</div>}
      </section> : null}
      {developmentMode && taskDefinitions.length > 0 ? <TaskSubloopConfigurations
        definitions={taskDefinitions}
        bindings={model.bindings}
        api={api}
        workerOptions={workerOptions}
        agentProfiles={model.agentProfiles}
        providerReadiness={model.providerReadiness}
      /> : null}
      {flowDefinitions.length > 0 ? <section className="min-w-0 border-y border-[#d0d7de] bg-white lg:col-span-2">
        <header className="border-b border-[#d0d7de] px-4 py-3"><h2 className="text-sm font-semibold text-[#24292f]">流程预览</h2><p className="mt-1 text-xs text-[#57606a]">以下步骤来自当前已发布的 Loop 版本；实际执行仍以运行时保存的 graph 和绑定版本为准。</p></header>
        <div className="grid gap-4 p-4 lg:grid-cols-2">{flowDefinitions.map((item) => <LoopFlowPreview key={item.id} definition={item} />)}</div>
      </section> : null}
      {variant === "all" ? <section className="min-w-0 border-y border-[#d0d7de] bg-white lg:col-span-2">
        <header className="border-b border-[#d0d7de] px-4 py-3"><h2 className="text-sm font-semibold text-[#24292f]">项目 Linux Worker 资源</h2><p className="mt-1 text-xs text-[#57606a]">Pool、仓库和分支策略由项目统一管理，所有启用 Linux Worker 的 Loop 复用此配置。</p></header>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <label className="text-xs font-medium text-[#57606a]">Worker Pool
            <select aria-label="项目 Worker Pool" value={workerPoolId} onChange={(event) => setWorkerPoolId(event.currentTarget.value)} className="mt-1 w-full rounded-md border border-[#d0d7de] bg-white px-2 py-2 text-sm text-[#24292f]">
              <option value="">选择 Worker Pool</option>
              {workerOptions.pools.filter((pool) => pool.status === "active").map((pool) => <option key={pool.id} value={pool.id}>{pool.displayName}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-[#57606a]">Git 仓库 URL
            <input aria-label="项目仓库 URL" value={workerRepositoryUrl} onChange={(event) => setWorkerRepositoryUrl(event.currentTarget.value)} placeholder="https://github.com/org/repository.git" className="mt-1 w-full rounded-md border border-[#d0d7de] px-2 py-2 text-sm text-[#24292f]" />
          </label>
          <label className="text-xs font-medium text-[#57606a] sm:col-span-2">允许分支
            <textarea aria-label="项目允许分支" value={workerAllowedBranches} onChange={(event) => setWorkerAllowedBranches(event.currentTarget.value)} placeholder="main&#10;2026-HUMANTHR*" rows={2} className="mt-1 w-full resize-y rounded-md border border-[#d0d7de] px-2 py-2 text-sm text-[#24292f]" />
            <span className="mt-1 block text-xs text-[#57606a]">每行填写完整分支名或使用 `*` 通配符；仅支持整段匹配。</span>
          </label>
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[#d0d7de] px-4 py-3">{workerResourceNotice ? <span role={workerResourceNotice.tone === "error" ? "alert" : "status"} className={workerResourceNotice.tone === "error" ? "mr-auto text-xs text-[#cf222e]" : "mr-auto text-xs text-[#116329]"}>{workerResourceNotice.text}</span> : null}<WorkbenchButton type="button" size="small" disabled={pending} onClick={saveWorkerResource}>保存项目资源</WorkbenchButton></footer>
      </section> : null}
      <section className="min-w-0 border-y border-[#d0d7de] bg-white">
        <header className="border-b border-[#d0d7de] px-4 py-3">
          <h2 className="text-sm font-semibold text-[#24292f]">版本绑定</h2>
          <p className="mt-1 text-xs text-[#57606a]">保存配置与立即运行是两个独立命令。</p>
        </header>
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <label className="text-xs font-medium text-[#57606a]">
            Loop
            <select aria-label="Loop" value={definitionId} onChange={(event) => selectDefinition(event.currentTarget.value)} className="mt-1 w-full rounded-md border border-[#d0d7de] bg-white px-2 py-2 text-sm text-[#24292f]">
              {versionBindingDefinitions.length > 0
                ? versionBindingDefinitions.map((item) => <option key={item.id} value={item.id}>{item.name}{item.scope ? ` · ${item.scope === "task" ? "任务级" : "项目级"}` : ""}</option>)
                : <option value="">当前开发模板未关联 Loop</option>}
            </select>
          </label>
          <label className="text-xs font-medium text-[#57606a]">
            版本
            <select aria-label="版本" value={versionId} onChange={(event) => selectVersion(event.currentTarget.value)} className="mt-1 w-full rounded-md border border-[#d0d7de] bg-white px-2 py-2 text-sm text-[#24292f]">
              {definition?.versions.map((version) => <option key={version.id} value={version.id}>v{version.versionNumber}</option>)}
            </select>
          </label>
          {selectedVersion ? (
            <div className="grid grid-cols-3 gap-2 text-center text-xs sm:col-span-2">
              <div className="border border-[#d0d7de] px-2 py-2"><strong className="block text-[#24292f]">{selectedVersion.maxStages}</strong><span className="text-[#57606a]">最大 Stage</span></div>
              <div className="border border-[#d0d7de] px-2 py-2"><strong className="block text-[#24292f]">{selectedVersion.maxRepeatCount}</strong><span className="text-[#57606a]">最大返工</span></div>
              <div className="border border-[#d0d7de] px-2 py-2"><strong className="block text-[#24292f]">{selectedVersion.humanGateCount}</strong><span className="text-[#57606a]">人工确认</span></div>
              <p className="sr-only">人工确认节点 {selectedVersion.humanGateCount}（可选）</p>
            </div>
          ) : null}
          <fieldset className="grid gap-3 border border-[#d0d7de] p-3 sm:col-span-2">
            <legend className="px-1 text-xs font-semibold text-[#24292f]">Linux Worker</legend>
            <label className="flex items-center gap-2 text-sm text-[#24292f]"><input aria-label="Linux Worker" type="checkbox" checked={linuxWorkerEnabled} onChange={(event) => setLinuxWorkerEnabled(event.currentTarget.checked)} />使用常驻 Linux Worker 执行</label>
            {linuxWorkerEnabled ? <div className="grid gap-3 sm:grid-cols-2">
              {selectedVersion?.agentNodeKeys.length ? selectedVersion.agentNodeKeys.map((nodeKey) => {
                const stage = workerStageConfigurations[nodeKey] ?? emptyWorkerStageConfiguration();
                return <div key={nodeKey} className="grid gap-2 border border-[#d8dee4] p-3 sm:col-span-2 sm:grid-cols-3">
                  <label className="text-xs font-medium text-[#57606a]">{selectedVersion.agentNodeLabels?.[nodeKey] ?? nodeKey} · 模型站点
                    <select aria-label={`${selectedVersion.agentNodeLabels?.[nodeKey] ?? nodeKey} · 模型站点`} value={stage.siteId} onChange={(event) => updateWorkerStage(nodeKey, "siteId", event.currentTarget.value)} className="mt-1 w-full rounded-md border border-[#d0d7de] bg-white px-2 py-2 text-sm text-[#24292f]">
                      <option value="">选择模型站点</option>
                      {workerOptions.sites.filter((site) => site.status === "active").map((site) => <option key={site.id} value={site.id}>{site.name} · {site.endpoint}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-[#57606a]">{selectedVersion.agentNodeLabels?.[nodeKey] ?? nodeKey} · 模型
                    <input aria-label={`${selectedVersion.agentNodeLabels?.[nodeKey] ?? nodeKey} · 模型`} value={stage.model} onChange={(event) => updateWorkerStage(nodeKey, "model", event.currentTarget.value)} className="mt-1 w-full rounded-md border border-[#d0d7de] px-2 py-2 text-sm text-[#24292f]" />
                  </label>
                  <label className="text-xs font-medium text-[#57606a]">{selectedVersion.agentNodeLabels?.[nodeKey] ?? nodeKey} · 推理强度
                    <select aria-label={`${selectedVersion.agentNodeLabels?.[nodeKey] ?? nodeKey} · 推理强度`} value={stage.reasoningEffort} onChange={(event) => updateWorkerStage(nodeKey, "reasoningEffort", event.currentTarget.value)} className="mt-1 w-full rounded-md border border-[#d0d7de] bg-white px-2 py-2 text-sm text-[#24292f]">
                      {WORKER_REASONING_EFFORTS.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-[#24292f] sm:col-span-3"><input aria-label={`${selectedVersion.agentNodeLabels?.[nodeKey] ?? nodeKey} · 必须提交代码`} type="checkbox" checked={stage.requireGitDelivery === true} onChange={(event) => updateWorkerStage(nodeKey, "requireGitDelivery", event.currentTarget.checked)} />必须提交并推送代码后才算完成</label>
                </div>;
              }) : <p className="text-xs text-[#cf222e] sm:col-span-2">当前版本没有可分派到 Linux Worker 的 Agent 节点。</p>}
            </div> : null}
          </fieldset>
          <label className="text-xs font-medium text-[#57606a] sm:col-span-2">
            Agent Profile
            <select aria-label="Agent Profile" value={selectedProfileId} onChange={(event) => {
              const profileId = event.currentTarget.value;
              setSelectedProfileId(profileId);
              const profile = model.agentProfiles.find((item) => item.id === profileId);
              setSelectedProviders((current) => current.filter((provider) => provider === profile?.provider));
            }} className="mt-1 w-full rounded-md border border-[#d0d7de] bg-white px-2 py-2 text-sm text-[#24292f]">
              <option value="">不使用本地 Agent</option>
              {model.agentProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.provider}</option>)}
            </select>
          </label>
          <fieldset className="grid gap-2 sm:col-span-2">
            <legend className="text-xs font-semibold text-[#24292f]">执行 Provider</legend>
            {model.providerReadiness.map((readiness) => {
              const label = readiness.provider === "codex" ? "Codex" : "Claude";
              const profileMatches = model.agentProfiles.find((profile) => profile.id === selectedProfileId)?.provider === readiness.provider;
              const disabled = !readiness.adapterRegistered || !profileMatches;
              return <div key={readiness.provider} className="grid gap-1"><label className="flex items-center gap-2 text-sm text-[#24292f]"><input aria-label={label} type="checkbox" disabled={disabled} checked={selectedProviders.includes(readiness.provider)} onChange={(event) => {
                const checked = event.currentTarget.checked;
                setSelectedProviders((current) => checked ? [...new Set([...current, readiness.provider])] : current.filter((provider) => provider !== readiness.provider));
              }} />{label}<span className="text-xs text-[#57606a]">{readiness.readyRuntimeCount} 个就绪运行时</span></label>{readiness.reason ? <p className="ml-6 text-xs text-[#8c5e00]">{readiness.reason}</p> : null}</div>;
            })}
          </fieldset>
          <fieldset className="grid gap-2 sm:col-span-2">
            <legend className="text-xs font-semibold text-[#24292f]">触发策略</legend>
            <label className="flex items-center gap-2 text-sm text-[#24292f]"><input type="checkbox" checked={manual} onChange={(event) => setManual(event.currentTarget.checked)} />允许手动触发</label>
            <label className="flex items-center gap-2 text-sm text-[#24292f]"><input type="checkbox" checked={taskEvents} onChange={(event) => setTaskEvents(event.currentTarget.checked)} />Task 完成时触发</label>
            <label className="flex items-center gap-2 text-sm text-[#24292f]"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} />启用绑定</label>
          </fieldset>
          <fieldset className="grid gap-2 sm:col-span-2">
            <legend className="text-xs font-semibold text-[#24292f]">自动化授权</legend>
            {activeGrants.map((grant) => (
              <label key={grant.id} className="flex items-center gap-2 text-sm text-[#24292f]">
                <input type="checkbox" checked={selectedGrantIds.includes(grant.id)} onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setSelectedGrantIds((current) => checked ? [...new Set([...current, grant.id])] : current.filter((id) => id !== grant.id));
                }} />
                {grant.permission === "workspace_full" ? "Workspace 完全权限" : grant.permission === "none" ? "无 Workspace 权限" : "Workspace 只读"} · {grant.id}
              </label>
            ))}
          </fieldset>
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[#d0d7de] px-4 py-3">
          {notice ? <span role={notice.tone === "error" ? "alert" : "status"} className={notice.tone === "error" ? "mr-auto text-xs text-[#cf222e]" : "mr-auto text-xs text-[#116329]"}>{notice.text}</span> : null}
          {lastRunId ? <WorkbenchButton href={`/loop-runs/${encodeURIComponent(lastRunId)}`} type="button" size="small"><Play aria-hidden="true" className="h-3.5 w-3.5" />进入运行工作区</WorkbenchButton> : null}
          <WorkbenchButton type="button" size="small" disabled={pending || !definitionId || !versionId} onClick={saveBinding}>保存绑定</WorkbenchButton>
        </footer>
      </section>

      <div className="grid content-start gap-5">
        <section className="border-y border-[#d0d7de] bg-white">
          <header className="border-b border-[#d0d7de] px-4 py-3"><h2 className="text-sm font-semibold text-[#24292f]">已绑定 Loop</h2></header>
          {enabledBindings.length === 0 ? <p className="px-4 py-5 text-sm text-[#57606a]">当前项目没有已启用的 Loop 绑定。</p> : <div className="divide-y divide-[#d0d7de]">{enabledBindings.map((binding) => {
            const boundDefinition = model.definitions.find((item) => item.id === binding.loopDefinitionId);
            const version = boundDefinition?.versions.find((item) => item.id === binding.activeVersionId);
            const taskScoped = boundDefinition?.scope === "task";
            const bindingStatus = bindingStatuses[binding.id] ?? binding.status;
            return <div key={binding.id} className="grid min-w-0 gap-2 px-4 py-3"><div className="flex min-w-0 flex-wrap items-center gap-2"><span className="min-w-0 break-words text-sm font-semibold text-[#24292f]">{boundDefinition?.name ?? "Loop"}</span>{boundDefinition?.scope ? <StatusPill>{taskScoped ? "任务级" : "项目级"}</StatusPill> : null}<StatusPill tone={bindingStatus === "enabled" ? "success" : "default"}>{bindingStatus === "enabled" ? "已启用" : "已停用"}</StatusPill></div><div className="text-xs text-[#57606a]">固定版本 v{version?.versionNumber ?? "?"} · 配置版本 {binding.version}</div>{taskScoped ? <div className="flex flex-wrap items-center justify-between gap-2"><p className="min-w-0 text-xs leading-5 text-[#57606a]">从任务详情的“启动任务 Loop”进入运行。</p>{bindingStatus === "enabled" && api.unbindTaskLoop ? <DangerConfirmDialog triggerLabel="解绑" triggerIcon={<Unlink aria-hidden="true" className="h-3.5 w-3.5" />} triggerSize="small" title="解绑任务 Loop" description="解绑后新任务不会再启动该 Loop；历史运行、文档与证据仍会保留。" actionLabel="确认解绑" onConfirm={() => unbindTaskLoop(binding.id, binding.version)} /> : null}</div> : null}</div>;
          })}</div>}
        </section>
        <section className="border-y border-[#d0d7de] bg-white">
          <header className="flex items-center justify-between border-b border-[#d0d7de] px-4 py-3"><div><h2 className="text-sm font-semibold text-[#24292f]">AutomationGrant</h2><p className="mt-1 text-xs text-[#57606a]">授权可撤销、可过期，且每次执行仍重新求值。</p></div><WorkbenchButton type="button" size="small" onClick={() => setGrantOpen(true)}><Plus aria-hidden="true" className="h-3.5 w-3.5" />新建</WorkbenchButton></header>
          {activeGrants.length === 0 ? <p className="px-4 py-5 text-sm text-[#57606a]">当前项目没有有效的自动化授权。</p> : <div className="divide-y divide-[#d0d7de]">{activeGrants.map((grant) => <div key={grant.id} className="grid min-w-0 gap-2 px-4 py-3"><div className="flex items-center gap-2"><StatusPill tone="success">有效</StatusPill><span className="text-xs font-semibold text-[#24292f]">{grant.permission}</span></div><div className="grid gap-1 text-xs text-[#57606a]">{grantWorkspaceLabels(model, grant).map((label) => <span key={label} className="[overflow-wrap:anywhere]">{label}</span>)}</div><div className="text-xs text-[#57606a]">{grant.expiresAt ? `到期 ${new Intl.DateTimeFormat("zh-CN").format(new Date(grant.expiresAt))}` : "长期有效，直至撤销"}</div><WorkbenchButton type="button" size="small" disabled={pending} onClick={() => execute(async () => {
            await api.revokeGrant(grant.id);
            setGrantStatuses((current) => ({ ...current, [grant.id]: "revoked" }));
            setSelectedGrantIds((current) => current.filter((id) => id !== grant.id));
          }, "授权已撤销")}><ShieldOff aria-hidden="true" className="h-3.5 w-3.5" />撤销授权</WorkbenchButton></div>)}</div>}
        </section>
      </div>
      {grantOpen ? <AutomationGrantDialog open project={model.project} bindings={bindingOptions} agentProfileIds={selectedProfileId ? [selectedProfileId] : []} providers={selectedProviders.length > 0 ? selectedProviders : (() => { const provider = model.agentProfiles.find(({ id }) => id === selectedProfileId)?.provider; return provider ? [provider] : []; })()} onClose={() => setGrantOpen(false)} onConfirm={async (grant) => {
          await api.createGrant(grant);
          setGrantOpen(false);
          setNotice({ tone: "status", text: "自动化授权已创建；重新载入后可绑定" });
        }} /> : null}
    </div>
  );
}

function emptyGrantScope(): ProjectLoopGrantScope {
  return {
    nodeKeys: [],
    executionPlanes: [],
    providers: [],
    tools: [],
    commandCategories: [],
    operationTypes: [],
    networkTargets: [],
    recipients: [],
    credentialRefs: [],
  };
}

function ProjectLoopGroupConfiguration({ model, api, projectVersion, onProjectVersionChange }: {
  model: ProjectLoopSettingsModel;
  api: ProjectLoopSettingsApi;
  projectVersion: number;
  onProjectVersionChange(version: number): void;
}) {
  const config = model.project.loopGroupConfig ?? model.project.developmentMode?.loopGroupConfig ?? createInitialLoopGroupConfig(model);
  const initialConfig = config ?? {
    taskLoopVersionIds: [], defaultTaskLoopVersionId: "", projectLoopVersionIds: [], defaultProjectLoopVersionId: "",
    selectedPresetKeys: [], defaultPresetKey: "",
  };
  const projectLoops = model.definitions.filter((definition) => definition.scope === "project").flatMap((definition) => definition.versions.map((version) => ({ ...version, definition })));
  const taskLoops = model.definitions.filter((definition) => definition.scope === "task").flatMap((definition) => definition.versions.map((version) => ({ ...version, definition })));
  const [selectedProjects, setSelectedProjects] = useState(initialConfig.projectLoopVersionIds);
  const [selectedTasks, setSelectedTasks] = useState(initialConfig.taskLoopVersionIds);
  const [defaultProject, setDefaultProject] = useState(initialConfig.defaultProjectLoopVersionId);
  const [defaultTask, setDefaultTask] = useState(initialConfig.defaultTaskLoopVersionId);
  const [mappings, setMappings] = useState(initialConfig.projectLoopNodeTaskLoopIds ?? {});
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (!api.saveLoopGroupConfig) return null;

  function setProjects(next: string[]) {
    setSelectedProjects(next);
    if (!next.includes(defaultProject)) setDefaultProject(next[0] ?? "");
    if (!next.includes(defaultTask)) setDefaultTask(next[0] ?? "");
    setMappings((current) => Object.fromEntries(Object.entries(current).filter(([id]) => next.includes(id))));
  }
  function setTasks(next: string[]) {
    setSelectedTasks(next);
    setMappings((current) => Object.fromEntries(Object.entries(current).map(([projectId, nodes]) => [projectId, Object.fromEntries(Object.entries(nodes).filter(([, taskId]) => next.includes(taskId)))])));
  }
  async function save() {
    setPending(true); setNotice(null);
    try {
      const currentConfig = config;
      const result = await api.saveLoopGroupConfig!({
        expectedVersion: projectVersion,
        config: {
          ...currentConfig,
          selectedPresetKeys: currentConfig.selectedPresetKeys ?? [currentConfig.defaultPresetKey],
          defaultPresetKey: currentConfig.defaultPresetKey ?? currentConfig.selectedPresetKeys?.[0] ?? "",
          projectLoopVersionIds: selectedProjects,
          taskLoopVersionIds: selectedTasks,
          defaultProjectLoopVersionId: defaultProject,
          defaultTaskLoopVersionId: defaultTask,
          projectLoopNodeTaskLoopIds: mappings,
        },
      });
      const version = result && typeof result === "object" && !Array.isArray(result) ? Reflect.get(result, "version") : undefined;
      if (Number.isInteger(version) && (version as number) > projectVersion) {
        onProjectVersionChange(version as number);
      }
      setNotice(`项目 Loop 配置已保存${Number.isInteger(version) ? `（项目版本 ${version}）` : ""}`);
    } catch (cause) { setNotice(loopFailureMessage(cause)); } finally { setPending(false); }
  }
  return <section className="min-w-0 border-y border-[#d0d7de] bg-white lg:col-span-2">
    <header className="border-b border-[#d0d7de] px-4 py-3"><h2 className="text-sm font-semibold text-[#24292f]">项目 Loop 配置</h2><p className="mt-1 text-xs leading-5 text-[#57606a]">项目 Loop 多选，并在同一列表中分别选择默认任务 Loop和默认里程碑 Loop；任务 Loop 可选，仅用于项目 Loop 的子流程复用。</p></header>
    <div className="grid gap-4 p-4">
      <LoopVersionChecklist title="项目 Loop 列表" loops={projectLoops} selected={selectedProjects} defaultId={defaultTask} defaultLabel="默认任务 Loop" secondaryDefaultId={defaultProject} secondaryDefaultLabel="默认里程碑 Loop" onSelectionChange={setProjects} onDefaultChange={setDefaultTask} onSecondaryDefaultChange={setDefaultProject} />
      <ProjectLoopNodeMappings loops={projectLoops.filter((loop) => selectedProjects.includes(loop.id))} taskLoops={taskLoops.filter((loop) => selectedTasks.includes(loop.id))} mappings={mappings} onChange={setMappings} />
      <LoopVersionChecklist title="任务 Loop 列表" loops={taskLoops} selected={selectedTasks} onSelectionChange={setTasks} />
    </div>
    <footer className="flex items-center justify-end gap-2 border-t border-[#d0d7de] px-4 py-3">{notice ? <span role={notice.includes("已保存") ? "status" : "alert"} className={`mr-auto text-xs ${notice.includes("已保存") ? "text-[#116329]" : "text-[#cf222e]"}`}>{notice}</span> : null}<WorkbenchButton type="button" size="small" disabled={pending || selectedProjects.length === 0} onClick={save}>保存项目 Loop 配置</WorkbenchButton></footer>
  </section>;
}

function createInitialLoopGroupConfig(model: ProjectLoopSettingsModel): ProjectLoopGroupConfig {
  const projectLoopIds = model.definitions.filter((definition) => definition.scope === "project").flatMap((definition) => definition.versions.map((version) => version.id));
  const taskLoopIds = model.definitions.filter((definition) => definition.scope === "task").flatMap((definition) => definition.versions.map((version) => version.id));
  return {
    projectLoopVersionIds: projectLoopIds,
    defaultTaskLoopVersionId: projectLoopIds[0] ?? "",
    defaultProjectLoopVersionId: projectLoopIds[0] ?? "",
    taskLoopVersionIds: taskLoopIds,
    selectedPresetKeys: ["项目自定义"],
    defaultPresetKey: "项目自定义",
  } as ProjectLoopGroupConfig;
}

type LoopVersionOption = ProjectLoopSettingsModel["definitions"][number]["versions"][number] & { definition: ProjectLoopSettingsModel["definitions"][number] };

function LoopVersionChecklist({ title, loops, selected, defaultId, defaultLabel, secondaryDefaultId, secondaryDefaultLabel, onSelectionChange, onDefaultChange, onSecondaryDefaultChange }: { title: string; loops: readonly LoopVersionOption[]; selected: readonly string[]; defaultId?: string; defaultLabel?: string; secondaryDefaultId?: string; secondaryDefaultLabel?: string; onSelectionChange(value: string[]): void; onDefaultChange?: (value: string) => void; onSecondaryDefaultChange?: (value: string) => void }) {
  return <fieldset aria-label={title} className="grid gap-2 rounded-md border border-[#d0d7de] p-3"><legend className="px-1 text-sm font-semibold text-[#24292f]">{title}</legend>{loops.map((loop) => { const checked = selected.includes(loop.id); return <div key={loop.id} className="flex items-center justify-between gap-3 border border-[#d0d7de] px-3 py-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={loop.definition.name} checked={checked} onChange={(event) => onSelectionChange(event.currentTarget.checked ? [...selected, loop.id] : selected.filter((id) => id !== loop.id))} /><span>{loop.definition.name} · v{loop.versionNumber}</span></label>{defaultLabel && onDefaultChange ? <label className="flex items-center gap-1 text-xs"><input type="radio" name={`${title}-default-task`} aria-label={`${defaultLabel}：${loop.definition.name}`} checked={defaultId === loop.id} disabled={!checked} onChange={() => onDefaultChange(loop.id)} /><span>◆ {defaultLabel}</span></label> : null}{secondaryDefaultLabel && onSecondaryDefaultChange ? <label className="flex items-center gap-1 text-xs"><input type="radio" name={`${title}-default-project`} aria-label={`${secondaryDefaultLabel}：${loop.definition.name}`} checked={secondaryDefaultId === loop.id} disabled={!checked} onChange={() => onSecondaryDefaultChange(loop.id)} /><span>✦ {secondaryDefaultLabel}</span></label> : null}</div>; })}</fieldset>;
}

function ProjectLoopNodeMappings({ loops, taskLoops, mappings, onChange }: { loops: readonly LoopVersionOption[]; taskLoops: readonly LoopVersionOption[]; mappings: Record<string, Record<string, string>>; onChange(value: Record<string, Record<string, string>>): void }) {
  return <fieldset aria-label="项目 Loop 节点任务 Loop 映射" className="grid gap-3 rounded-md border border-[#d0d7de] bg-[#f6f8fa] p-3"><legend className="px-1 text-sm font-semibold text-[#24292f]">项目 Loop 节点任务 Loop 映射</legend>{loops.length === 0 ? <p className="text-xs text-[#57606a]">请先选择项目 Loop。</p> : loops.map((loop) => <div key={loop.id} className="grid gap-2 border border-[#d0d7de] bg-white p-3"><strong className="text-sm">{loop.definition.name} · v{loop.versionNumber}</strong>{(loop.flow ?? []).filter((node) => node.type === "subloop_call").map((node) => <label key={node.key} className="grid gap-1 text-xs text-[#57606a]"><span>{node.label} <code>{node.key}</code></span><select aria-label={`${loop.definition.name}：${node.label}`} value={mappings[loop.id]?.[node.key] ?? ""} disabled={taskLoops.length === 0} onChange={(event) => onChange({ ...mappings, [loop.id]: { ...(mappings[loop.id] ?? {}), [node.key]: event.currentTarget.value } })} className="rounded border border-[#d0d7de] px-2 py-1.5 text-sm"><option value="">不指定</option>{taskLoops.map((task) => <option key={task.id} value={task.id}>{task.definition.name} · v{task.versionNumber}</option>)}</select></label>)}</div>)}</fieldset>;
}

function TaskSubloopConfigurations({
  definitions,
  bindings,
  api,
  workerOptions,
  agentProfiles,
  providerReadiness,
}: {
  definitions: ProjectLoopSettingsModel["definitions"];
  bindings: ProjectLoopSettingsModel["bindings"];
  api: ProjectLoopSettingsApi;
  workerOptions: WorkerExecutionOptions;
  workerResource?: ProjectWorkerResource;
  agentProfiles: ProjectLoopSettingsModel["agentProfiles"];
  providerReadiness: ProjectLoopSettingsModel["providerReadiness"];
}) {
  const task = definitions[0];
  const version = task?.versions[0];
  const existing = task ? findBindingForDefinition(bindings, task.id, "task_development") : undefined;
  const [stages, setStages] = useState<WorkerExecutionConfiguration["stageConfigurations"]>(() => stageConfigurationsForVersion(version, existing?.workerExecution));
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (!task || !version) return null;
  const taskDefinition = task;
  const taskVersion = version;
  const update = (nodeKey: string, field: "siteId" | "model" | "reasoningEffort", value: string) => setStages((current) => ({
    ...current,
    [nodeKey]: { ...(current[nodeKey] ?? emptyWorkerStageConfiguration()), [field]: field === "reasoningEffort" && isWorkerReasoningEffort(value) ? value : field === "reasoningEffort" ? "medium" : value },
  }));
  async function save() {
    const workerStageConfigurations = workerStageConfigurationInput({ stageConfigurations: stages, agentNodeKeys: taskVersion.agentNodeKeys, options: workerOptions });
    if (!workerStageConfigurations) { setNotice("请为任务级 Loop 的每个 Agent 节点配置模型站点、模型与推理强度。"); return; }
    setPending(true); setNotice(null);
    try {
      await api.saveBinding({
        ...(existing ? { expectedVersion: existing.version } : {}),
        loopDefinitionId: taskDefinition.id,
        activeVersionId: taskVersion.id,
        bindingRole: "task_development",
        status: "enabled",
        triggerPolicy: { manual: false, taskEvents: [] },
        parameterOverrides: {}, notificationPolicy: {}, automationGrantIds: [],
        allowedAgentProfileIds: agentProfiles[0] ? [agentProfiles[0].id] : [],
        allowedProviders: providerReadiness.filter((item) => item.available).map((item) => item.provider),
        workerStageConfigurations,
      });
      setNotice("任务级 SubLoop Worker 配置已保存。");
    } catch (cause) { setNotice(loopFailureMessage(cause)); } finally { setPending(false); }
  }
  return <section className="min-w-0 border-y border-[#d0d7de] bg-white lg:col-span-2">
    <header className="border-b border-[#d0d7de] px-4 py-3"><h2 className="text-sm font-semibold text-[#24292f]">任务级 SubLoop 执行配置</h2><p className="mt-1 text-xs leading-5 text-[#57606a]">根流程调用的任务 Loop：{task.name} · v{version.versionNumber}。这里配置任务 Loop 自己的 Linux Worker；项目级版本绑定不会显示它。</p></header>
    <div className="grid gap-3 p-4">{version.agentNodeKeys.map((nodeKey) => { const label = version.agentNodeLabels?.[nodeKey] ?? nodeKey; const stage = stages[nodeKey] ?? emptyWorkerStageConfiguration(); return <div key={nodeKey} className="grid gap-2 border border-[#d8dee4] p-3 sm:grid-cols-3">
      <label className="text-xs font-medium text-[#57606a]">{label} · 模型站点<select aria-label={`任务 SubLoop ${label} · 模型站点`} value={stage.siteId} onChange={(event) => update(nodeKey, "siteId", event.currentTarget.value)} className="mt-1 w-full rounded-md border border-[#d0d7de] bg-white px-2 py-2 text-sm text-[#24292f]"><option value="">选择模型站点</option>{workerOptions.sites.filter((site) => site.status === "active").map((site) => <option key={site.id} value={site.id}>{site.name} · {site.endpoint}</option>)}</select></label>
      <label className="text-xs font-medium text-[#57606a]">{label} · 模型<input aria-label={`任务 SubLoop ${label} · 模型`} value={stage.model} onChange={(event) => update(nodeKey, "model", event.currentTarget.value)} className="mt-1 w-full rounded-md border border-[#d0d7de] px-2 py-2 text-sm text-[#24292f]" /></label>
      <label className="text-xs font-medium text-[#57606a]">{label} · 推理强度<select aria-label={`任务 SubLoop ${label} · 推理强度`} value={stage.reasoningEffort} onChange={(event) => update(nodeKey, "reasoningEffort", event.currentTarget.value)} className="mt-1 w-full rounded-md border border-[#d0d7de] bg-white px-2 py-2 text-sm text-[#24292f]">{WORKER_REASONING_EFFORTS.map((effort) => <option key={effort} value={effort}>{effort}</option>)}</select></label>
    </div>; })}</div>
    <footer className="flex justify-end gap-2 border-t border-[#d0d7de] px-4 py-3">{notice ? <span role={notice.startsWith("任务级 SubLoop Worker") ? "status" : "alert"} className={`mr-auto text-xs ${notice.startsWith("任务级 SubLoop Worker") ? "text-[#116329]" : "text-[#cf222e]"}`}>{notice}</span> : null}<WorkbenchButton type="button" size="small" disabled={pending} onClick={save}>保存任务 SubLoop 配置</WorkbenchButton></footer>
  </section>;
}

const WORKER_REASONING_EFFORTS: WorkerReasoningEffort[] = ["low", "medium", "high", "xhigh", "max", "ultra"];

function emptyWorkerStageConfiguration(): WorkerExecutionConfiguration["stageConfigurations"][string] {
  return { siteId: "", model: "", reasoningEffort: "medium", requireGitDelivery: false };
}

function stageConfigurationsForVersion(
  version: ProjectLoopSettingsModel["definitions"][number]["versions"][number] | undefined,
  workerExecution?: WorkerExecutionConfiguration,
  current: WorkerExecutionConfiguration["stageConfigurations"] = {},
): WorkerExecutionConfiguration["stageConfigurations"] {
  return Object.fromEntries((version?.agentNodeKeys ?? []).map((nodeKey) => [
    nodeKey,
    workerExecution?.stageConfigurations[nodeKey] ?? current[nodeKey] ?? emptyWorkerStageConfiguration(),
  ]));
}

function findBindingForDefinition(
  bindings: ProjectLoopSettingsModel["bindings"],
  definitionId: string,
  role?: "task_development" | "milestone_release",
) {
  return bindings.find((binding) => binding.loopDefinitionId === definitionId && role !== undefined && binding.bindingRole === role)
    ?? bindings.find((binding) => binding.loopDefinitionId === definitionId);
}

function projectWorkerResourceInput(input: {
  poolId: string;
  repositoryUrl: string;
  allowedBranches: string;
  options: WorkerExecutionOptions;
}): ProjectWorkerResource | null {
  const poolId = input.poolId.trim();
  if (!input.options.pools.some((pool) => pool.id === poolId && pool.status === "active")) return null;
  const repositoryUrl = validWorkerRepositoryUrl(input.repositoryUrl);
  if (!repositoryUrl) return null;
  const allowedBranches = [...new Set(input.allowedBranches.split(/[\s,]+/u).map((branch) => branch.trim()).filter(Boolean))];
  if (allowedBranches.length === 0 || allowedBranches.length > 64 || allowedBranches.some((branch) => !isWorkerBranchPattern(branch))) return null;
  return { poolId, repositoryUrl, branchPolicy: { allowedBranches } };
}

function workerStageConfigurationInput(input: {
  stageConfigurations: WorkerExecutionConfiguration["stageConfigurations"];
  agentNodeKeys: string[];
  options: WorkerExecutionOptions;
}): WorkerExecutionConfiguration["stageConfigurations"] | null {
  if (input.agentNodeKeys.length === 0) return null;
  const activeSiteIds = new Set(input.options.sites.filter((site) => site.status === "active").map((site) => site.id));
  type StageConfiguration = WorkerExecutionConfiguration["stageConfigurations"][string];
  const stageConfigurations = Object.fromEntries(input.agentNodeKeys.map((nodeKey): [string, StageConfiguration] | null => {
    const stage = input.stageConfigurations[nodeKey];
    if (!stage || !activeSiteIds.has(stage.siteId) || !stage.model.trim() || !isWorkerReasoningEffort(stage.reasoningEffort)) return null;
    return [nodeKey, { siteId: stage.siteId, model: stage.model.trim(), reasoningEffort: stage.reasoningEffort, requireGitDelivery: stage.requireGitDelivery === true }];
  }).filter((entry): entry is [string, StageConfiguration] => entry !== null));
  if (Object.keys(stageConfigurations).length !== input.agentNodeKeys.length) return null;
  return stageConfigurations;
}

function validWorkerRepositoryUrl(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || normalized.length > 1_024) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isWorkerReasoningEffort(value: string): value is WorkerReasoningEffort {
  return WORKER_REASONING_EFFORTS.includes(value as WorkerReasoningEffort);
}

function ModeFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><dt className="text-[#57606a]">{label}</dt><dd className={`${mono ? "font-mono" : ""} mt-1 break-words font-semibold text-[#24292f]`}>{value}</dd></div>;
}

function stringConfig(mode: NonNullable<ProjectLoopSettingsModel["project"]["developmentMode"]>, key: string, fallback: string): string {
  const value = mode.executionPolicy[key] ?? mode.config[key];
  return typeof value === "string" ? value : typeof value === "boolean" ? String(value) : fallback;
}

function LoopFlowPreview({ definition }: { definition: ProjectLoopSettingsModel["definitions"][number] }) {
  const flow = definition.flow ?? definition.versions[0]?.flow ?? [];
  const title = definition.role === "task_development" ? "任务开发 Loop" : definition.role === "milestone_release" ? "里程碑 Loop" : definition.name;
  return <article className="min-w-0 border border-[#d0d7de] p-4">
    <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-[#24292f]">{title}</h3>{definition.role ? <StatusPill tone="default">{definition.role === "task_development" ? "任务阶段" : "发版阶段"}</StatusPill> : null}</div>
    {definition.description ? <p className="mt-1 text-xs leading-5 text-[#57606a]">{definition.description}</p> : null}
    <ol className="mt-4 grid gap-2">{flow.map((step, index) => <li key={step.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 text-sm"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f6f8fa] text-xs font-semibold text-[#57606a]">{index + 1}</span><div className="min-w-0"><div className="font-medium text-[#24292f]">{step.label}</div>{step.detail ? <p className="mt-0.5 break-words text-xs leading-5 text-[#57606a]">{step.detail}</p> : null}{step.type === "human_gate" ? <p className="mt-1 text-xs font-semibold text-[#8c5e00]">通过：继续发布 · 拒绝：结束本次发版</p> : step.outcomes.length > 0 ? <p className="mt-1 text-xs text-[#57606a]">分支：{step.outcomes.join(" / ")}</p> : null}</div></li>)}</ol>
  </article>;
}

function createBrowserApi(projectId: string): ProjectLoopSettingsApi {
  return {
    saveBinding: (input) => requestJson(`/api/projects/${encodeURIComponent(projectId)}/loop-bindings`, "PUT", { commandId: commandId(), ...input }),
    saveWorkerResource: (input) => requestJson(`/api/projects/${encodeURIComponent(projectId)}/loop-worker-resource`, "PUT", {
      commandId: commandId(),
      expectedVersion: input.expectedVersion,
      workerPoolId: input.poolId,
      workerRepositoryUrl: input.repositoryUrl,
      workerBranchPolicy: input.branchPolicy,
    }),
    saveLoopGroupConfig: (input) => requestJson(`/api/projects/${encodeURIComponent(projectId)}`, "PATCH", {
      commandId: commandId(), expectedVersion: input.expectedVersion, loopGroupConfig: input.config,
    }),
    async readBindingVersion(loopDefinitionId) {
      const response = await requestJson(`/api/projects/${encodeURIComponent(projectId)}/loop-bindings`, "GET");
      const bindings = Array.isArray(response) ? response : [];
      const binding = bindings.find((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate)
        && (candidate as Record<string, unknown>).loopDefinitionId === loopDefinitionId);
      return binding && typeof binding === "object" && Number.isInteger((binding as Record<string, unknown>).version)
        ? (binding as Record<string, unknown>).version as number
        : null;
    },
    loadWorkerExecutionOptions: async () => {
      const [poolResponse, modelSites] = await Promise.all([
        requestWorkerPools(projectId),
        requestJson(`/api/worker-model-sites?projectId=${encodeURIComponent(projectId)}`, "GET"),
      ]);
      return {
        pools: poolResponse,
        sites: Array.isArray(modelSites) ? modelSites.flatMap(parseWorkerModelSiteOption) : [],
      };
    },
    trigger: (bindingId, payload) => requestJson(`/api/projects/${encodeURIComponent(projectId)}/loop-runs`, "POST", { commandId: commandId(), bindingId, payload }),
    async createGrant(grant) {
      return requestJson("/api/automation-grants", "POST", {
        commandId: commandId(),
        projectId,
        grant,
        confirmationFingerprint: await fingerprintAutomationGrantForBrowser(grant),
      });
    },
    revokeGrant: (grantId) => requestJson(`/api/automation-grants/${encodeURIComponent(grantId)}/revoke`, "POST", { commandId: commandId(), projectId }),
    unbindTaskLoop: (bindingId, expectedVersion) => requestJson(
      `/api/projects/${encodeURIComponent(projectId)}/loop-bindings`,
      "DELETE",
      { commandId: commandId(), bindingId, expectedVersion },
    ),
  };
}

async function requestWorkerPools(projectId: string): Promise<WorkerExecutionOptions["pools"]> {
  const response = await fetch(`/api/worker-pools?projectId=${encodeURIComponent(projectId)}`);
  const payload = await response.json().catch(() => null) as { pools?: unknown; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message ?? "Worker Pool 请求失败");
  return Array.isArray(payload?.pools) ? payload.pools.flatMap(parseWorkerPoolOption) : [];
}

function parseWorkerPoolOption(value: unknown): WorkerExecutionOptions["pools"][number][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string"
    || typeof record.displayName !== "string"
    || (record.status !== "active" && record.status !== "revoked")
  ) return [];
  return [{ id: record.id, displayName: record.displayName, status: record.status }];
}

function parseWorkerModelSiteOption(value: unknown): WorkerExecutionOptions["sites"][number][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string"
    || typeof record.name !== "string"
    || typeof record.endpoint !== "string"
    || (record.status !== "active" && record.status !== "revoked")
  ) return [];
  return [{ id: record.id, name: record.name, endpoint: record.endpoint, status: record.status }];
}

export async function requestJson(url: string, method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT", body?: unknown) {
  const response = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => null) as { ok?: boolean; result?: unknown; error?: string } | null;
  if (!response.ok || !result?.ok) {
    throw Object.assign(new Error(result?.error ?? "Loop 请求失败"), { status: response.status });
  }
  return result.result;
}

function unbindFailureMessage(cause: unknown): string {
  const status = cause && typeof cause === "object" && "status" in cause ? Reflect.get(cause, "status") : null;
  if (status === 409) return "请先停止正在运行的任务 Loop";
  return cause instanceof Error ? cause.message : "任务 Loop 解绑失败";
}

function isVersionConflict(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const status = "status" in cause ? Reflect.get(cause, "status") : null;
  const code = "code" in cause ? Reflect.get(cause, "code") : null;
  return status === 409 || code === "version_conflict";
}

function loopFailureMessage(cause: unknown): string {
  if (isVersionConflict(cause)) return "绑定已被更新，请刷新页面后重试";
  const status = cause && typeof cause === "object" && "status" in cause ? Reflect.get(cause, "status") : null;
  if (status === 404) return "项目 Loop 或自动化授权已不存在，请刷新页面后重试";
  return cause instanceof Error ? cause.message : "Loop 设置操作失败";
}

export async function fingerprintAutomationGrantForBrowser(grant: AutomationGrantDraft): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(normalizeGrant(grant)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function normalizeGrant(grant: AutomationGrantDraft): AutomationGrantDraft {
  const sort = (values: string[]) => [...new Set(values)].sort();
  return {
    ...grant,
    bindingIds: sort(grant.bindingIds),
    nodeKeys: sort(grant.nodeKeys),
    executionPlanes: sort(grant.executionPlanes) as Array<"local" | "platform">,
    deviceIds: sort(grant.deviceIds),
    workerIds: sort(grant.workerIds),
    agentProfileIds: sort(grant.agentProfileIds),
    providers: sort(grant.providers),
    workspaceBindingIds: sort(grant.workspaceBindingIds),
    allowedRelativePathPrefixes: sort(grant.allowedRelativePathPrefixes),
    tools: sort(grant.tools),
    commandCategories: sort(grant.commandCategories),
    operationTypes: sort(grant.operationTypes),
    networkTargets: sort(grant.networkTargets),
    recipients: sort(grant.recipients),
    credentialRefs: sort(grant.credentialRefs),
  };
}

function grantWorkspaceLabels(
  model: ProjectLoopSettingsModel,
  grant: ProjectLoopSettingsModel["grants"][number],
): string[] {
  if (grant.workspaceBindingIds.length === 0) return ["无 Workspace"];
  const scope = grant.allowedRelativePathPrefixes.map((path) => (
    path === "." ? "项目根目录" : path
  )).join("、");
  return grant.workspaceBindingIds.map((bindingId) => {
    const workspace = model.project.workspaceBindings.find(({ id }) => id === bindingId);
    return `${workspace?.deviceName ?? "未知设备"} · ${scope || "未声明范围"}`;
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function commandId(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `loop-${Date.now().toString(36)}`;
}
