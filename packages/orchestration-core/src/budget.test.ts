import { describe, expect, it } from "vitest";
import { consumeLoopBudget, isBudgetExhausted } from "./budget";

describe("loop budget", () => {
  it("stops at attempts, time, tokens, cost or repeated failure limits", () => {
    const remaining = consumeLoopBudget({ budget: { maxAttempts: 4, maxTokens: 1000, maxCost: 5, deadline: new Date("2026-07-21T01:00:00.000Z"), repeatedFailureLimit: 3 }, usage: { attempts: 4, tokens: 100, cost: 1, repeatedFailures: 0 }, now: new Date("2026-07-21T00:00:00.000Z") });
    expect(isBudgetExhausted(remaining)).toBe(true);
  });
});
