import { describe, expect, it } from "vitest";
import { parseLoopExecutionTarget } from "./execution-target";

describe("parseLoopExecutionTarget", () => {
  it("accepts a Local Agent target and trims the profile id", () => {
    expect(parseLoopExecutionTarget({ type: "local_agent", agentProfileId: " profile_1 " })).toEqual({
      type: "local_agent",
      agentProfileId: "profile_1",
    });
  });

  it("accepts a 32-character Worker Pool target", () => {
    expect(parseLoopExecutionTarget({ type: "linux_worker_pool", workerPoolId: "a".repeat(32) })).toEqual({
      type: "linux_worker_pool",
      workerPoolId: "a".repeat(32),
    });
  });

  it("rejects unknown shapes and invalid pool ids", () => {
    expect(parseLoopExecutionTarget(null)).toBeNull();
    expect(parseLoopExecutionTarget("local_agent")).toBeNull();
    expect(parseLoopExecutionTarget([])).toBeNull();
    expect(parseLoopExecutionTarget({ type: "local_agent", agentProfileId: "  " })).toBeNull();
    expect(parseLoopExecutionTarget({ type: "linux_worker_pool", workerPoolId: "not-a-pool" })).toBeNull();
    expect(parseLoopExecutionTarget({ type: "other", agentProfileId: "profile_1" })).toBeNull();
  });
});
