export const ONBOARDING_STEPS = [
  { key: "identity", title: "登录与设备身份" },
  { key: "workspace", title: "本地 Workspace" },
  { key: "runtime", title: "Agent runtime" },
  { key: "model", title: "模型与凭据来源" },
  { key: "git", title: "Git 与发布能力" },
  { key: "worker", title: "Worker 执行偏好" },
  { key: "safety", title: "连接与安全检查" },
  { key: "claim", title: "首次执行验证" },
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]["key"];
export type OnboardingStepStatus =
  | "pending"
  | "running"
  | "needs_verification"
  | "blocked"
  | "completed";

export interface OnboardingStepState {
  status: OnboardingStepStatus;
  summary: string;
  evidence: string;
}

export interface OnboardingState {
  version: 1;
  executionEnabled: boolean;
  maxConcurrency: number;
  workerPool: string;
  modelSource: "hosted" | "external_key" | "local_environment";
  skipped: boolean;
  steps: Record<OnboardingStepKey, OnboardingStepState>;
}

export interface OnboardingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const ONBOARDING_STORAGE_KEY = "humanthread.desktop-preview.onboarding.v1";

const STEP_STATUSES = new Set<OnboardingStepStatus>([
  "pending",
  "running",
  "needs_verification",
  "blocked",
  "completed",
]);

export function createDefaultOnboardingState(): OnboardingState {
  return {
    version: 1,
    executionEnabled: false,
    maxConcurrency: 1,
    workerPool: "local",
    modelSource: "hosted",
    skipped: false,
    steps: Object.fromEntries(
      ONBOARDING_STEPS.map((step) => [
        step.key,
        {
          status: "pending",
          summary: "尚未检查",
          evidence: "尚未产生检查证据。",
        },
      ]),
    ) as Record<OnboardingStepKey, OnboardingStepState>,
  };
}

export function loadOnboardingState(storage: OnboardingStorage): OnboardingState {
  const fallback = createDefaultOnboardingState();
  const value = storage.getItem(ONBOARDING_STORAGE_KEY);
  if (!value) return fallback;

  try {
    const parsed = JSON.parse(value) as Partial<OnboardingState>;
    const steps = { ...fallback.steps };
    for (const step of ONBOARDING_STEPS) {
      const candidate = parsed.steps?.[step.key];
      if (
        candidate
        && STEP_STATUSES.has(candidate.status)
        && typeof candidate.summary === "string"
        && typeof candidate.evidence === "string"
      ) {
        steps[step.key] = {
          status: candidate.status,
          summary: candidate.summary,
          evidence: candidate.evidence,
        };
      }
    }
    return {
      version: 1,
      executionEnabled: parsed.executionEnabled === true,
      maxConcurrency: Number.isInteger(parsed.maxConcurrency) && (parsed.maxConcurrency ?? 0) > 0
        ? Math.min(parsed.maxConcurrency ?? 1, 8)
        : 1,
      workerPool: typeof parsed.workerPool === "string" && parsed.workerPool.trim()
        ? parsed.workerPool
        : "local",
      modelSource: parsed.modelSource === "external_key" || parsed.modelSource === "local_environment"
        ? parsed.modelSource
        : "hosted",
      skipped: parsed.skipped === true,
      steps,
    };
  } catch {
    return fallback;
  }
}

export function saveOnboardingState(
  storage: OnboardingStorage,
  state: OnboardingState,
): void {
  storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
}

export function updateOnboardingStep(
  state: OnboardingState,
  key: OnboardingStepKey,
  input: Partial<OnboardingStepState>,
): OnboardingState {
  return {
    ...state,
    steps: {
      ...state.steps,
      [key]: {
        ...state.steps[key],
        ...input,
      },
    },
  };
}

export function canCompleteOnboarding(state: OnboardingState): boolean {
  return state.executionEnabled && ONBOARDING_STEPS.every(
    (step) => state.steps[step.key].status === "completed",
  );
}

export function shouldOpenOnboarding(state: OnboardingState): boolean {
  return !state.skipped && !canCompleteOnboarding(state);
}
