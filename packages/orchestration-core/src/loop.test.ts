import { describe, expect, it } from "vitest";
import { decideLoop } from "./loop";

describe("decideLoop", () => {
  it.each([
    [{ evaluation: "pass" }, "complete"],
    [{ evaluation: "fail", retryable: true, budgetRemaining: true }, "revise"],
    [{ evaluation: "fail", checkpointAvailable: true, runStatus: "orphaned", budgetRemaining: true }, "resume"],
    [{ approvalPending: true }, "wait_approval"],
    [{ paused: true }, "pause"],
    [{ budgetRemaining: false }, "exhaust"],
  ])("maps persisted facts to %s", (facts, expected) => {
    expect(decideLoop(facts as Parameters<typeof decideLoop>[0]).type).toBe(expected);
  });
});
