import {
  ArrowRight,
  Check,
  CircleAlert,
  CircleDashed,
  LoaderCircle,
  ShieldCheck,
  SkipForward,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { usePreviewSession } from "../session/preview-session";
import { StatusPill, SurfacePanel } from "../ui/primitives";
import {
  ONBOARDING_STEPS,
  canCompleteOnboarding,
  createDefaultOnboardingState,
  loadOnboardingState,
  saveOnboardingState,
  updateOnboardingStep,
  type OnboardingState,
  type OnboardingStepKey,
  type OnboardingStepStatus,
  type OnboardingStorage,
} from "./onboarding-state";

const STATUS_LABELS: Record<OnboardingStepStatus, string> = {
  pending: "未开始",
  running: "进行中",
  needs_verification: "待验证",
  blocked: "阻塞",
  completed: "已完成",
};

function statusTone(status: OnboardingStepStatus) {
  if (status === "completed") return "success" as const;
  if (status === "blocked") return "danger" as const;
  if (status === "needs_verification") return "warning" as const;
  if (status === "running") return "info" as const;
  return "neutral" as const;
}

function StepIcon(props: { status: OnboardingStepStatus }) {
  if (props.status === "completed") return <Check aria-hidden="true" size={14} />;
  if (props.status === "blocked") return <CircleAlert aria-hidden="true" size={14} />;
  if (props.status === "running") return <LoaderCircle aria-hidden="true" size={14} />;
  return <CircleDashed aria-hidden="true" size={14} />;
}

export function OnboardingPage(props: {
  storage?: OnboardingStorage;
  initialState?: OnboardingState;
  onSkip?: () => void;
}) {
  const navigate = useNavigate();
  const session = usePreviewSession();
  const storage = props.storage ?? window.localStorage;
  const [state, setState] = useState(() => props.initialState ?? loadOnboardingState(storage));
  const [selectedKey, setSelectedKey] = useState<OnboardingStepKey>("identity");
  const [workspacePath, setWorkspacePath] = useState("");
  const selectedStep = useMemo(
    () => ONBOARDING_STEPS.find((step) => step.key === selectedKey) ?? ONBOARDING_STEPS[0],
    [selectedKey],
  );
  const current = state.steps[selectedKey];

  const updateState = useCallback((next: OnboardingState) => {
    setState(next);
    saveOnboardingState(storage, next);
  }, [storage]);

  const updateStep = useCallback((
    key: OnboardingStepKey,
    input: Parameters<typeof updateOnboardingStep>[2],
  ) => {
    updateState(updateOnboardingStep(state, key, input));
  }, [state, updateState]);

  function skip() {
    if (props.onSkip) {
      props.onSkip();
      return;
    }
    updateState({ ...state, skipped: true });
    navigate("/dashboard", { replace: true });
  }

  function checkIdentity() {
    if (session.status === "ready") {
      updateStep("identity", {
        status: "completed",
        summary: `已确认 ${session.user?.name ?? "当前用户"} 与独立预览设备`,
        evidence: `预览设备 ${session.identity.deviceId} 已通过官网会话读取。`,
      });
      return;
    }
    updateStep("identity", {
      status: "blocked",
      summary: "官网会话尚未就绪",
      evidence: "没有可验证的登录会话，未创建预览设备授权。",
    });
  }

  function blockNativeStep(key: OnboardingStepKey, label: string) {
    updateStep(key, {
      status: "blocked",
      summary: `${label}需要正式 Desktop 原生桥接`,
      evidence: "设计预览未执行本机命令，检查保持待验证。",
    });
  }

  function enableExecution(enabled: boolean) {
    if (enabled) {
      const confirmed = window.confirm(
        "开启后预览将允许领取真实任务。当前设计预览没有原生执行器，请确认仅在评审环境使用。",
      );
      if (!confirmed) return;
      updateState({
        ...updateOnboardingStep(state, "worker", {
          status: "needs_verification",
          summary: "真实执行已开启，但本机桥接未连接",
          evidence: "已记录执行范围；尚未领取任务，也未启动 Worker。",
        }),
        executionEnabled: true,
      });
      return;
    }
    updateState({
      ...updateOnboardingStep(state, "worker", {
        status: "pending",
        summary: "真实执行已关闭",
        evidence: "预览保持只读，不会领取业务任务。",
      }),
      executionEnabled: false,
    });
  }

  function runClaimCheck() {
    updateStep("claim", {
      status: "blocked",
      summary: "未领取任务，未产生执行证据",
      evidence: state.executionEnabled
        ? "执行开关已开启，但设计预览未连接原生执行器，因此停止在领取之前。"
        : "真实执行开关关闭，无副作用领取检查未运行。",
    });
  }

  return (
    <div className="onboarding-page">
      <aside className="onboarding-steps" aria-label="开箱向导步骤">
        <header>
          <div>
            <strong>本机模式执行任务</strong>
            <span>8 步开箱设置</span>
          </div>
          <StatusPill tone={state.executionEnabled ? "danger" : "warning"}>
            {state.executionEnabled ? "执行已开启" : "默认只读"}
          </StatusPill>
        </header>
        <ol>
          {ONBOARDING_STEPS.map((step, index) => {
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
                  <span className="onboarding-step-index"><StepIcon status={stepState.status} /></span>
                  <span>
                    <strong>{index + 1}. {step.title}</strong>
                    <small>{STATUS_LABELS[stepState.status]}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <button className="ghost-button" onClick={skip} type="button">
          <SkipForward aria-hidden="true" size={15} />
          跳过向导进入工作台
        </button>
      </aside>

      <section className="onboarding-main" aria-labelledby="onboarding-step-title">
        <header className="onboarding-title">
          <div>
            <span>步骤 {ONBOARDING_STEPS.findIndex((step) => step.key === selectedKey) + 1} / 8</span>
            <h1 id="onboarding-step-title">{selectedStep.title}</h1>
          </div>
          <StatusPill tone={statusTone(current.status)}>{STATUS_LABELS[current.status]}</StatusPill>
        </header>

        {state.executionEnabled ? (
          <div className="execution-risk-banner" role="alert">
            <CircleAlert aria-hidden="true" size={17} />
            <span><strong>真实执行已开启</strong> 仅允许已批准的 Worker Pool 和并发上限。设计预览没有可调用执行器。</span>
            <button className="secondary-button" onClick={() => enableExecution(false)} type="button">立即关闭</button>
          </div>
        ) : null}

        <div className="onboarding-content-grid">
          <div className="onboarding-form">
            {selectedKey === "identity" ? (
              <SurfacePanel>
                <div className="onboarding-section">
                  <h2>会话与预览身份</h2>
                  <dl className="definition-list">
                    <div><dt>用户</dt><dd>{session.user?.name ?? "未登录"}</dd></div>
                    <div><dt>空间</dt><dd>{session.bootstrap?.spaces.find((space) => space.key === session.activeSpaceKey)?.name ?? "未建立"}</dd></div>
                    <div><dt>安装标识</dt><dd>{session.identity.installationId}</dd></div>
                    <div><dt>设备标识</dt><dd>{session.identity.deviceId}</dd></div>
                  </dl>
                  <button className="primary-button" onClick={checkIdentity} type="button">
                    检查身份与会话 <ArrowRight aria-hidden="true" size={15} />
                  </button>
                </div>
              </SurfacePanel>
            ) : null}

            {selectedKey === "workspace" ? (
              <SurfacePanel>
                <div className="onboarding-section">
                  <h2>选择项目工作目录</h2>
                  <label className="field">
                    <span>Workspace 路径</span>
                    <input onChange={(event) => setWorkspacePath(event.target.value)} placeholder="/Users/name/work/project" value={workspacePath} />
                  </label>
                  <button className="primary-button" onClick={() => blockNativeStep("workspace", "Workspace 验证")} type="button">验证目录与 Git 状态</button>
                </div>
              </SurfacePanel>
            ) : null}

            {selectedKey === "runtime" ? (
              <SurfacePanel>
                <div className="onboarding-section">
                  <h2>探测 Agent runtime</h2>
                  <div className="choice-grid">
                    <label><input defaultChecked name="runtime" type="radio" /> Codex <span>未连接</span></label>
                    <label><input name="runtime" type="radio" /> Claude <span>未连接</span></label>
                  </div>
                  <button className="primary-button" onClick={() => blockNativeStep("runtime", "Agent runtime 探测")} type="button">重新探测 runtime</button>
                </div>
              </SurfacePanel>
            ) : null}

            {selectedKey === "model" ? (
              <SurfacePanel>
                <div className="onboarding-section">
                  <h2>模型与凭据来源</h2>
                  <div className="choice-grid">
                    {[
                      ["hosted", "官网托管", "凭据不写入本机预览存储"],
                      ["external_key", "独立 Key", "只保存安全存储引用"],
                      ["local_environment", "本机环境变量", "仅读取变量名和脱敏状态"],
                    ].map(([value, label, description]) => (
                      <label key={value}>
                        <input
                          checked={state.modelSource === value}
                          name="model-source"
                          onChange={() => updateState({ ...state, modelSource: value as OnboardingState["modelSource"] })}
                          type="radio"
                        />
                        {label}<span>{description}</span>
                      </label>
                    ))}
                  </div>
                  <button className="primary-button" onClick={() => blockNativeStep("model", "模型连接测试")} type="button">测试模型连接</button>
                </div>
              </SurfacePanel>
            ) : null}

            {selectedKey === "git" ? (
              <SurfacePanel>
                <div className="onboarding-section">
                  <h2>Git 与发布能力</h2>
                  <p className="muted">验证认证、推送权限、目标分支和当前工作树状态。项目不需要发布能力时可以在受限范围内跳过。</p>
                  <button className="primary-button" onClick={() => blockNativeStep("git", "Git 与发布验证")} type="button">验证 Git 与发布能力</button>
                </div>
              </SurfacePanel>
            ) : null}

            {selectedKey === "worker" ? (
              <SurfacePanel>
                <div className="onboarding-section">
                  <h2>Worker 执行偏好</h2>
                  <label className="check-row">
                    <input
                      aria-label="允许领取真实任务"
                      checked={state.executionEnabled}
                      onChange={(event) => enableExecution(event.target.checked)}
                      type="checkbox"
                    />
                    <span><strong>允许领取真实任务</strong><small>默认关闭；开启前展示影响范围和停止入口。</small></span>
                  </label>
                  <div className="two-column-fields">
                    <label className="field">
                      <span>最大并发</span>
                      <input
                        max={8}
                        min={1}
                        onChange={(event) => updateState({ ...state, maxConcurrency: Number(event.target.value) })}
                        type="number"
                        value={state.maxConcurrency}
                      />
                    </label>
                    <label className="field">
                      <span>Worker Pool / 执行目标</span>
                      <select onChange={(event) => updateState({ ...state, workerPool: event.target.value })} value={state.workerPool}>
                        <option value="local">本机 Agent</option>
                        <option value="linux-k8s">Linux Kubernetes Worker</option>
                      </select>
                    </label>
                  </div>
                </div>
              </SurfacePanel>
            ) : null}

            {selectedKey === "safety" ? (
              <SurfacePanel>
                <div className="onboarding-section">
                  <h2>连接与安全检查</h2>
                  <ul className="check-list">
                    <li><Check aria-hidden="true" size={14} /> Desktop session 与配置版本</li>
                    <li><CircleAlert aria-hidden="true" size={14} /> 心跳、设备授权与本机执行能力</li>
                  </ul>
                  <button className="primary-button" onClick={() => blockNativeStep("safety", "连接与安全检查")} type="button">运行安全检查</button>
                </div>
              </SurfacePanel>
            ) : null}

            {selectedKey === "claim" ? (
              <SurfacePanel>
                <div className="onboarding-section">
                  <h2>首次执行验证</h2>
                  <p className="muted">先验证无副作用领取链路，再经二次确认运行最小验证任务。未获得成功证据前不能完成向导。</p>
                  <button className="primary-button" onClick={runClaimCheck} type="button">执行无副作用检查</button>
                  <button
                    className="secondary-button"
                    disabled={!state.executionEnabled}
                    onClick={() => blockNativeStep("claim", "真实任务验证")}
                    type="button"
                  >
                    领取最小验证任务
                  </button>
                </div>
              </SurfacePanel>
            ) : null}
          </div>

          <aside className="onboarding-evidence" aria-label="步骤证据">
            <ShieldCheck aria-hidden="true" size={18} />
            <h2>检查证据</h2>
            <StatusPill tone={statusTone(current.status)}>{STATUS_LABELS[current.status]}</StatusPill>
            <p>{current.summary}</p>
            <div className="evidence-note">{current.evidence}</div>
            <small>向导状态保存在当前浏览器，不包含密码、令牌或设备凭据。</small>
          </aside>
        </div>
      </section>
    </div>
  );
}
