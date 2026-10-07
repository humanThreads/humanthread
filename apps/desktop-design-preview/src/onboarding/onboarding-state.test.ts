import { describe, expect, it } from "vitest";

import {
  ONBOARDING_STORAGE_KEY,
  canCompleteOnboarding,
  createDefaultOnboardingState,
  loadOnboardingState,
  saveOnboardingState,
} from "./onboarding-state";

describe("onboarding state", () => {
  it("keeps real execution disabled and the final claim check unverified by default", () => {
    const state = createDefaultOnboardingState();

    expect(state.executionEnabled).toBe(false);
    expect(state.steps.worker.status).toBe("pending");
    expect(state.steps.claim.status).toBe("pending");
    expect(canCompleteOnboarding(state)).toBe(false);
  });

  it("does not persist credentials when state is stored", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    saveOnboardingState(storage, createDefaultOnboardingState());

    expect(values.get(ONBOARDING_STORAGE_KEY)).not.toMatch(
      /password|accessToken|refreshToken|deviceToken|apiKey|dsn/iu,
    );
    expect(loadOnboardingState(storage).executionEnabled).toBe(false);
  });
});
