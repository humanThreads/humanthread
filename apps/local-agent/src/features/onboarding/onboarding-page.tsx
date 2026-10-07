import {
  desktopAgentRuntimeCollectionResponseSchema,
  desktopAgentsResponseSchema,
  desktopProjectCollectionResponseSchema,
} from "@humanthread/workbench-client";
import { Check, CircleAlert, CircleDashed, LoaderCircle, Play, SkipForward } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { createNativeExecutionConfigStore } from "../../desktop/execution-config-store";
import type { LocalAgentAccountSession } from "../../lib/binding";
import { evaluateLocalAgentOnboarding } from "../../lib/onboarding-readiness";
import type { LocalRuntime } from "../../lib/runtime";
import { runDesktopSelfCheck } from "../../lib/desktop-self-check";
import type { DesktopSessionValue } from "../../session/session-provider";
import { PageHeader, SurfacePanel } from "../../ui/primitives";
import {
  PRODUCTION_ONBOARDING_STEPS,
  canFinishProductionOnboarding,
  createDefaultProductionOnboardingState,
  loadProductionOnboardingState,
  markClaimCheck,
  saveProductionOnboardingState,
  updateProductionOnboardingStep,
  type ProductionOnboardingState,
  type ProductionOnboardingStepKey,
  type ProductionOnboardingStepStatus,
  type ProductionOnboardingStorage,
} from "./onboarding-state";

const STATUS_LABELS: Record<ProductionOnboardingStepStatus, string> = {
  pending: "未开始",
  running: "进行中",
  needs_verification: "待验证",
  blocked: "阻塞",
  completed: "已完成",
};

function StepIcon(props: { status: ProductionOnboardingStepStatus }) {
  if (props.status === "completed") return <Check aria-hidden="true" size={14} />;
  if (props.status === "blocked") return <CircleAlert aria-hidden="true" size={14} />;
  if (props.status === "running") return <LoaderCircle aria-hidden="true" size={14} />;
  return <CircleDashed aria-hidden="true" size={14} />;
}

function statusTone(status: ProductionOnboardingStepStatus) {
  if (status === "completed") return "success" as const;
  if (status === "blocked") return "danger" as const;
  if (status === "needs_verification") return "warning" as const;
  if (status === "running") return "info" as const;
  return "neutral" as const;
}

export function OnboardingPage(props: {
  accountSession: LocalAgentAccountSession | null;
  platform: "macos" | "windows" | "linux";
  runtime: LocalRuntime;
  session: DesktopSessionValue;
  storage: ProductionOnboardingStorage;
  onComplete(): void;
  onSkip(): void;
  initialState?: ProductionOnboardingState;
}) {
  const [state, setState] = useState(() => props.initialState ?? loadProductionOnboardingState(props.storage));
  const [selectedKey, setSelectedKey] = useState<ProductionOnboardingStepKey>("identity");
  const [workspacePath, setWorkspacePath] = useState(state.workspacePath);
  const [command, setCommand] = useState("codex");
  const [manualUpdateStartedAt] = useState(() => new Date().toISOString());
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const selectedStep = PRODUCTION_ONBOARDING_STEPS.find((step) => step.key === selectedKey)
    ?? PRODUCTION_ONBOARDING_STEPS[0];
  const current = state.steps[selectedKey];

  const updateState = useCallback((next: ProductionOnboardingState) => {
    setState(next);
    saveProductionOnboardingState(props.storage, next);
  }, [props.storage]);

  const updateStep = useCallback((
    key: ProductionOnboardingStepKey,
    update: Parameters<typeof updateProductionOnboardingStep>[2],
  ) => {
    updateState(updateProductionOnboardingStep(state, key, update));
  }, [state, updateState]);

  useEffect(() => {
    if (selectedKey !== "workspace" || !props.session.client || projects.length > 0) return;
    const search = new URLSearchParams({ space: props.session.context?.spaceKey ?? "personal" });
    void props.session.client.request(
      `/api/desktop/projects?${search.toString()}`,
      desktopProjectCollectionResponseSchema,
    ).then((response) => {
      setProjects(response.data.projects.map((project) => ({ id: project.id, name: project.name })));
    }).catch(() => {
      setProjects([]);
    });
  }, [projects.length, props.session.client, props.session.context?.spaceKey, selectedKey]);

  async function completeIdentity() {
    if (props.session.status === "ready" && props.session.user) {
      updateStep("identity", {
        status: "completed",
        summary: `已确认 ${props.session.user.name} 与设备身份`,
        evidence: `设备 ${props.accountSession?.deviceName ?? props.session.localDeviceId ?? "当前设备"} 已完成官网会话验证。`,
      });
      return;
    }
    updateStep("identity", {
      status: "blocked",
      summary: "官网会话尚未就绪",
      evidence: "没有可验证的登录会话。",
    });
  }

  async function verifyWorkspace() {
    updateStep("workspace", { status: "running", summary: "正在验证 Workspace", evidence: "检查目录、权限和原生桥接。" });
    if (!props.runtime.isNative) {
      updateStep("workspace", {
        status: "blocked",
        summary: "未连接正式 Desktop 原生桥接",
        evidence: "Workspace 路径未发送到任何外部进程。",
      });
      return;
    }
    try {
      const selectedPath = workspacePath.trim();
      if (!selectedPath) throw new Error("请先选择 Workspace 路径");
      const validated = await props.runtime.validateWorkspaceDirectory(selectedPath);
      const projectId = state.selectedProjectId;
      if (projectId && props.session.localDeviceId) {
        const store = await createNativeExecutionConfigStore({ deviceId: props.session.localDeviceId });
        await store.setWorkspace(projectId, {
          bindingId: null,
          absolutePath: validated.absolutePath,
          realpath: validated.realpath,
          configurationVersion: 1,
        });
      }
      updateState({
        ...updateProductionOnboardingStep(state, "workspace", {
          status: "completed",
          summary: "Workspace 与 Git 目录验证通过",
          evidence: `已验证目录 ${validated.realpath}，未记录本地绝对路径以外的凭据。`,
        }),
        workspacePath: validated.realpath,
        selectedProjectId: projectId,
      });
    } catch (error) {
      updateStep("workspace", {
        status: "blocked",
        summary: error instanceof Error ? error.message : "Workspace 验证失败",
        evidence: "未通过原生 Workspace 验证。",
      });
    }
  }

  async function probeRuntime() {
    updateStep("runtime", { status: "running", summary: "正在探测 Agent runtime", evidence: "执行本机 Command Probe。" });
    if (!props.runtime.isNative) {
      updateStep("runtime", {
        status: "blocked",
        summary: "未连接正式 Desktop 原生桥接",
        evidence: "未执行本机 runtime 命令。",
      });
      return;
    }
    try {
      const result = await props.runtime.probeAgentRuntime({
        provider: state.provider,
        command,
        environmentRefs: [],
      });
      if (result.status !== "ready" || result.authentication !== "authenticated") {
        throw new Error(`Runtime 状态为 ${result.status}`);
      }
      updateStep("runtime", {
        status: "completed",
        summary: `${state.provider} runtime 已就绪`,
        evidence: `版本 ${result.semanticVersion ?? "未知"}，能力 ${result.capabilities.length} 项。`,
      });
    } catch (error) {
      updateStep("runtime", {
        status: "blocked",
        summary: error instanceof Error ? error.message : "Runtime 探测失败",
        evidence: "Runtime 未达到 ready 和 authenticated。",
      });
    }
  }

  async function verifyModel() {
    if (!props.session.client) {
      updateStep("model", { status: "blocked", summary: "桌面会话不可用", evidence: "未读取模型配置。" });
      return;
    }
    updateStep("model", { status: "running", summary: "正在读取模型配置", evidence: "仅检查配置状态，不读取明文凭据。" });
    try {
      const search = new URLSearchParams({ space: props.session.context?.spaceKey ?? "personal" });
      const response = await props.session.client.request(
        `/api/desktop/agent-runtimes?${search.toString()}`,
        desktopAgentRuntimeCollectionResponseSchema,
      );
      const ready = response.data.runtimeProfiles.some((profile) => profile.status === "ready");
      if (!ready) throw new Error("没有已就绪的 Agent runtime profile");
      updateStep("model", {
        status: "completed",
        summary: "模型与凭据来源可用",
        evidence: "官网托管或本机安全存储中的 runtime profile 已就绪。",
      });
    } catch (error) {
      updateStep("model", {
        status: "blocked",
        summary: error instanceof Error ? error.message : "模型配置不可用",
        evidence: "未读取或记录任何明文凭据。",
      });
    }
  }

  function markGitNotRequired() {
    updateStep("git", {
      status: "completed",
      summary: "项目不需要发布能力",
      evidence: "用户已确认跳过 Git 推送与发布验证，记录为非阻塞。",
    });
  }

  async function checkGitCapability() {
    if (!props.runtime.isNative || !workspacePath.trim()) {
      updateStep("git", {
        status: "blocked",
        summary: "缺少原生 Workspace",
        evidence: "无法验证 Git 目录和发布能力。",
      });
      return;
    }
    try {
      const validated = await props.runtime.validateWorkspaceDirectory(workspacePath);
      updateStep("git", {
        status: "completed",
        summary: "Git 工作目录可用",
        evidence: `已验证 ${validated.realpath}；推送权限在发布动作前再次校验。`,
      });
    } catch (error) {
      updateStep("git", {
        status: "blocked",
        summary: error instanceof Error ? error.message : "Git 检查失败",
        evidence: "未通过 Workspace 校验。",
      });
    }
  }

  async function saveWorkerPreferences(enabled = state.executionEnabled) {
    if (!props.session.localDeviceId) {
      updateStep("worker", { status: "blocked", summary: "本机设备不可用", evidence: "未保存 Worker 偏好。" });
      return;
    }
    try {
      const store = await createNativeExecutionConfigStore({ deviceId: props.session.localDeviceId });
      await store.setWorkerPreferences({ enabled, maxConcurrency: state.maxConcurrency });
      updateState({
        ...updateProductionOnboardingStep(state, "worker", {
          status: "completed",
          summary: enabled ? "已允许本机领取任务" : "保持只读，不允许领取任务",
          evidence: `最大并发 ${state.maxConcurrency}，Worker enabled=${String(enabled)}。`,
        }),
        executionEnabled: enabled,
      });
    } catch (error) {
      updateStep("worker", {
        status: "blocked",
        summary: error instanceof Error ? error.message : "Worker 偏好保存失败",
        evidence: "未写入本机执行配置。",
      });
    }
  }

  async function runSafetyCheck() {
    if (!props.accountSession) {
      updateStep("safety", { status: "blocked", summary: "缺少设备绑定信息", evidence: "无法运行 Desktop self-check。" });
      return;
    }
    updateStep("safety", { status: "running", summary: "正在检查连接与设备", evidence: "执行官网健康检查与任务快照。" });
    try {
      const result = await runDesktopSelfCheck({
        binding: {
          apiBaseUrl: props.accountSession.apiBaseUrl,
          teamId: props.accountSession.teamId,
          userId: props.accountSession.userId,
          userEmail: props.accountSession.email,
          bindingCode: "",
          deviceId: props.accountSession.deviceId,
          deviceName: props.accountSession.deviceName,
          deviceToken: props.accountSession.deviceToken,
          pollIntervalMs: 10_000,
          apiToken: props.accountSession.apiToken,
          commandTemplate: "{command}",
        },
        platform: props.platform,
      });
      if (result.deviceStatus !== "authorized") throw new Error("设备未授权");
      updateStep("safety", {
        status: "completed",
        summary: "连接、心跳与设备状态正常",
        evidence: "Desktop self-check 返回 authorized。",
      });
    } catch (error) {
      updateStep("safety", {
        status: "blocked",
        summary: error instanceof Error ? error.message : "安全检查失败",
        evidence: "设备未通过连接与授权检查。",
      });
    }
  }

  async function checkExecutionEvidence() {
    if (!props.session.client) {
      updateStep("claim", { status: "blocked", summary: "桌面会话不可用", evidence: "未读取执行记录。" });
      return;
    }
    updateStep("claim", { status: "running", summary: "正在检查执行证据", evidence: "读取当前 Space 的 Agent Run 记录。" });
    try {
      const search = new URLSearchParams({ space: props.session.context?.spaceKey ?? "personal" });
      const response = await props.session.client.request(
        `/api/desktop/agents?${search.toString()}`,
        desktopAgentsResponseSchema,
      );
      const successfulExecutions = response.data.runs.filter((run) =>
        (run.status === "completed" || run.status === "succeeded")
        && run.createdAt >= manualUpdateStartedAt
      ).length;
      const next = markClaimCheck(state, {
        successfulExecutions,
        blockers: successfulExecutions > 0 ? [] : ["尚未检测到开箱后完成的执行记录"],
      });
      updateState(next);
    } catch (error) {
      updateStep("claim", {
        status: "blocked",
        summary: error instanceof Error ? error.message : "执行证据检查失败",
        evidence: "未获得可验证的成功执行记录。",
      });
    }
  }

  const canFinish = canFinishProductionOnboarding(state);

  return (
    <div className="page-stack production-onboarding">
      <PageHeader
        actions={(
          <div className="toolbar-actions">
            {state.executionEnabled ? <span className="desktop-execution-state" data-enabled="true">执行已开启</span> : <span className="desktop-execution-state">执行默认关闭</span>}
            <button className="secondary-button" onClick={props.onSkip} type="button"><SkipForward aria-hidden="true" size={15} />跳过向导进入工作台</button>
          </div>
        )}
        description="完成本机执行环境检查后，再进入任务领取和真实执行。未取得证据的步骤保持阻塞。"
        title="本机模式执行任务"
      />
      <div className="production-onboarding-layout">
        <aside className="production-onboarding-steps" aria-label="开箱向导步骤">
          <ol>
            {PRODUCTION_ONBOARDING_STEPS.map((step, index) => {
              const stepState = state.steps[step.key];
              return (
                <li key={step.key}>
                  <button
                    aria-current={selectedKey === step.key ? "step" : undefined}
                    aria-label={`进入第 ${index + 1} 步`}
                    data-status={stepState.status}
                    onClick={() => setSelectedKey(step.key)}
                    type="button"
                  >
                    <span className="production-step-icon"><StepIcon status={stepState.status} /></span>
                    <span><strong>{index + 1}. {step.title}</strong><small>{STATUS_LABELS[stepState.status]}</small></span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>
        <main className="production-onboarding-main">
          <header>
            <div><span>步骤 {PRODUCTION_ONBOARDING_STEPS.findIndex((step) => step.key === selectedKey) + 1} / 8</span><h1>{selectedStep.title}</h1></div>
            <span className="status-pill" data-tone={statusTone(current.status)}>{STATUS_LABELS[current.status]}</span>
          </header>

          {selectedKey === "identity" ? (
            <SurfacePanel className="production-onboarding-section">
              <h2>当前登录身份</h2>
              <dl className="production-facts"><div><dt>用户</dt><dd>{props.session.user?.name ?? "未登录"}</dd></div><div><dt>设备</dt><dd>{props.accountSession?.deviceName ?? props.session.localDeviceId ?? "未知设备"}</dd></div><div><dt>本地执行能力</dt><dd>{props.session.bootstrap?.capabilities.nativeExecution ? "已授权" : "未授权"}</dd></div></dl>
              <button className="primary-button" onClick={() => void completeIdentity()} type="button">确认身份与设备</button>
            </SurfacePanel>
          ) : null}

          {selectedKey === "workspace" ? (
            <SurfacePanel className="production-onboarding-section">
              <h2>选择项目 Workspace</h2>
              <label className="desktop-field"><span>项目</span><select aria-label="项目" onChange={(event) => updateState({ ...state, selectedProjectId: event.target.value || null })} value={state.selectedProjectId ?? ""}><option value="">暂不绑定项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              <label className="desktop-field"><span>Workspace 路径</span><input aria-label="Workspace 路径" onChange={(event) => setWorkspacePath(event.target.value)} placeholder="/Users/name/work/project" value={workspacePath} /></label>
              <div className="toolbar-actions"><button className="secondary-button" disabled={!props.runtime.isNative} onClick={() => void props.runtime.selectProjectDirectory().then((path) => { if (path) setWorkspacePath(path); })} type="button">选择目录</button><button className="primary-button" onClick={() => void verifyWorkspace()} type="button">验证 Workspace</button></div>
            </SurfacePanel>
          ) : null}

          {selectedKey === "runtime" ? (
            <SurfacePanel className="production-onboarding-section">
              <h2>探测 Agent runtime</h2>
              <div className="runtime-provider-switch" role="radiogroup" aria-label="Agent Provider">
                {(["codex", "claude"] as const).map((provider) => <button aria-checked={state.provider === provider} key={provider} onClick={() => updateState({ ...state, provider })} role="radio" type="button">{provider}</button>)}
              </div>
              <label className="desktop-field"><span>Runtime 命令</span><input aria-label="Runtime 命令" onChange={(event) => setCommand(event.target.value)} value={command} /></label>
              <button className="primary-button" onClick={() => void probeRuntime()} type="button">重新探测 runtime</button>
            </SurfacePanel>
          ) : null}

          {selectedKey === "model" ? (
            <SurfacePanel className="production-onboarding-section">
              <h2>模型与凭据来源</h2>
              <p>只检查已保存的 runtime profile 和凭据来源，不在向导中显示或记录明文。</p>
              <button className="primary-button" onClick={() => void verifyModel()} type="button">验证模型配置</button>
            </SurfacePanel>
          ) : null}

          {selectedKey === "git" ? (
            <SurfacePanel className="production-onboarding-section">
              <h2>Git 与发布能力</h2>
              <p>验证 Workspace 目录。若项目当前不需要发布能力，可以明确跳过并记录为非阻塞。</p>
              <div className="toolbar-actions"><button className="primary-button" onClick={() => void checkGitCapability()} type="button">检查 Git 能力</button><button className="secondary-button" onClick={markGitNotRequired} type="button">项目不需要发布能力</button></div>
            </SurfacePanel>
          ) : null}

          {selectedKey === "worker" ? (
            <SurfacePanel className="production-onboarding-section">
              <h2>Worker 执行偏好</h2>
              <label className="production-check-row"><input aria-label="允许领取真实任务" checked={state.executionEnabled} onChange={(event) => updateState({ ...state, executionEnabled: event.target.checked })} type="checkbox" /><span><strong>允许领取真实任务</strong><small>默认关闭。开启后必须保存 Worker 偏好并完成执行验证。</small></span></label>
              <label className="desktop-field"><span>最大并发</span><input aria-label="最大并发" max={128} min={1} onChange={(event) => updateState({ ...state, maxConcurrency: Number(event.target.value) })} type="number" value={state.maxConcurrency} /></label>
              <button className="primary-button" onClick={() => void saveWorkerPreferences()} type="button">保存 Worker 偏好</button>
            </SurfacePanel>
          ) : null}

          {selectedKey === "safety" ? (
            <SurfacePanel className="production-onboarding-section">
              <h2>连接与安全检查</h2>
              <p>验证 Desktop session、设备授权和任务领取连接。任何关键项失败都不能进入首次执行验证。</p>
              <button className="primary-button" onClick={() => void runSafetyCheck()} type="button">运行安全检查</button>
            </SurfacePanel>
          ) : null}

          {selectedKey === "claim" ? (
            <SurfacePanel className="production-onboarding-section">
              <h2>首次执行验证</h2>
              <p>检查开箱开始后是否存在真实完成的 Agent Run。只有成功执行记录才能解除阻塞。</p>
              <div className="toolbar-actions"><button className="secondary-button" onClick={() => void checkExecutionEvidence()} type="button">检查执行证据</button><button className="primary-button" disabled={!canFinish} onClick={props.onComplete} type="button"><Play aria-hidden="true" size={15} />完成开箱向导</button></div>
            </SurfacePanel>
          ) : null}
        </main>
        <aside className="production-onboarding-evidence" aria-label="步骤证据">
          <strong>检查证据</strong>
          <span className="status-pill" data-tone={statusTone(current.status)}>{STATUS_LABELS[current.status]}</span>
          <p>{current.summary}</p>
          <div>{current.evidence}</div>
          <small>向导状态只保存在本机，不包含密码、令牌或执行输出。</small>
        </aside>
      </div>
    </div>
  );
}
