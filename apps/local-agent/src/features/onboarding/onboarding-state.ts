export const PRODUCTION_ONBOARDING_STEPS = [
  { key: "identity", title: "登录与设备身份" },
  { key: "workspace", title: "本地 Workspace" },
  { key: "runtime", title: "Agent runtime" },
  { key: "model", title: "模型与凭据来源" },
  { key: "git", title: "Git 与发布能力" },
  { key: "worker", title: "Worker 执行偏好" },
  { key: "safety", title: "连接与安全检查" },
  { key: "claim", title: "首次执行验证" },
] as const;

export type ProductionOnboardingStepKey = (typeof PRODUCTION_ONBOARDING_STEPS)[number]["key"];
export type ProductionOnboardingStepStatus =
  | "pending"
  | "running"
  | "needs_verification"
  | "blocked"
  | "completed";

export interface ProductionOnboardingStepState {
  status: ProductionOnboardingStepStatus;
  summary: string;
  evidence: string;
}

export interface ProductionOnboardingState {
  version: 1;
  selectedProjectId: string | null;
  workspacePath: string;
  executionEnabled: boolean;
  maxConcurrency: number;
  provider: "codex" | "claude";
  steps: Record<ProductionOnboardingStepKey, ProductionOnboardingStepState>;
}

export interface ProductionOnboardingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PRODUCTION_ONBOARDING_STORAGE_KEY = "humanthread.desktop.onboarding.v1";

function pendingStep(summary = "尚未检查"): ProductionOnboardingStepState {
  return {
    status: "pending",
    summary,
    evidence: "尚未产生检查证据。",
  };
}

export function createDefaultProductionOnboardingState(): ProductionOnboardingState {
  return {
    version: 1,
    selectedProjectId: null,
    workspacePath: "",
    executionEnabled: false,
    maxConcurrency: 1,
    provider: "codex",
    steps: Object.fromEntries(
      PRODUCTION_ONBOARDING_STEPS.map((step) => [step.key, pendingStep()]),
    ) as Record<ProductionOnboardingStepKey, ProductionOnboardingStepState>,
  };
}

export function updateProductionOnboardingStep(
  state: ProductionOnboardingState,
  key: ProductionOnboardingStepKey,
  update: Partial<ProductionOnboardingStepState>,
): ProductionOnboardingState {
  return {
    ...state,
    steps: {
      ...state.steps,
      [key]: { ...state.steps[key], ...update },
    },
  };
}

export function markClaimCheck(
  state: ProductionOnboardingState,
  result: { successfulExecutions: number; blockers: string[] },
): ProductionOnboardingState {
  if (result.blockers.length > 0 || result.successfulExecutions < 1) {
    return updateProductionOnboardingStep(state, "claim", {
      status: "blocked",
      summary: result.blockers[0] ?? "尚未完成成功的领取与执行链路",
      evidence: `成功执行 ${result.successfulExecutions} 次；未满足完成门禁。`,
    });
  }
  return updateProductionOnboardingStep(state, "claim", {
    status: "completed",
    summary: "已完成真实领取与执行验证",
    evidence: `成功执行 ${result.successfulExecutions} 次。`,
  });
}

export function canFinishProductionOnboarding(state: ProductionOnboardingState): boolean {
  return PRODUCTION_ONBOARDING_STEPS.every(
    (step) => state.steps[step.key].status === "completed",
  );
}

export function loadProductionOnboardingState(
  storage: ProductionOnboardingStorage,
): ProductionOnboardingState {
  const fallback = createDefaultProductionOnboardingState();
  const raw = storage.getItem(PRODUCTION_ONBOARDING_STORAGE_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<ProductionOnboardingState>;
    const steps = { ...fallback.steps };
    for (const step of PRODUCTION_ONBOARDING_STEPS) {
      const value = parsed.steps?.[step.key];
      if (
        value
        && ["pending", "running", "needs_verification", "blocked", "completed"].includes(value.status)
        && typeof value.summary === "string"
        && typeof value.evidence === "string"
      ) {
        steps[step.key] = value;
      }
    }
    return {
      version: 1,
      selectedProjectId: typeof parsed.selectedProjectId === "string" ? parsed.selectedProjectId : null,
      workspacePath: typeof parsed.workspacePath === "string" ? parsed.workspacePath : "",
      executionEnabled: parsed.executionEnabled === true,
      maxConcurrency: Number.isInteger(parsed.maxConcurrency) && (parsed.maxConcurrency ?? 0) > 0
        ? Math.min(parsed.maxConcurrency ?? 1, 128)
        : 1,
      provider: parsed.provider === "claude" ? "claude" : "codex",
      steps,
    };
  } catch {
    return fallback;
  }
}

export function saveProductionOnboardingState(
  storage: ProductionOnboardingStorage,
  state: ProductionOnboardingState,
): void {
  storage.setItem(PRODUCTION_ONBOARDING_STORAGE_KEY, JSON.stringify(state));
}
