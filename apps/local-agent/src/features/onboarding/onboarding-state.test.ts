import { describe, expect, it } from "vitest";

import {
  PRODUCTION_ONBOARDING_STORAGE_KEY,
  canFinishProductionOnboarding,
  createDefaultProductionOnboardingState,
  loadProductionOnboardingState,
  markClaimCheck,
  saveProductionOnboardingState,
} from "./onboarding-state";

describe("production onboarding state", () => {
  it("keeps execution disabled and the final claim check incomplete by default", () => {
    const state = createDefaultProductionOnboardingState();
    expect(state.executionEnabled).toBe(false);
    expect(state.steps.worker.status).toBe("pending");
    expect(state.steps.claim.status).toBe("pending");
    expect(canFinishProductionOnboarding(state)).toBe(false);
  });

  it("keeps the claim check blocked without successful execution evidence", () => {
    const state = markClaimCheck(createDefaultProductionOnboardingState(), {
      successfulExecutions: 0,
      blockers: ["尚未完成成功的领取与执行链路"],
    });
    expect(state.steps.claim.status).toBe("blocked");
    expect(canFinishProductionOnboarding(state)).toBe(false);
  });

  it("persists only non-sensitive onboarding state", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    saveProductionOnboardingState(storage, createDefaultProductionOnboardingState());
    expect(values.get(PRODUCTION_ONBOARDING_STORAGE_KEY)).not.toMatch(
      /password|accessToken|refreshToken|deviceToken|apiKey|dsn/iu,
    );
    expect(loadProductionOnboardingState(storage).executionEnabled).toBe(false);
  });
});
