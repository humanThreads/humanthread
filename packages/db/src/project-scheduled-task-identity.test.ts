import { describe, expect, it } from "vitest";
import {
  scheduledTaskActorDigest,
  scheduledTaskExecutionTargetDigest,
  scheduledTaskLoopBindingDigest,
  projectScheduledTaskEventId,
  projectScheduledTaskId,
  projectScheduledTaskRunId,
  scheduledTaskProjectDigest,
} from "./project-scheduled-task-identity";

const localAgentTarget = {
  type: "local_agent",
  agentProfileId: "agent_1",
} as const;

const linuxWorkerPoolTarget = {
  type: "linux_worker_pool",
  workerPoolId: "pool_1",
} as const;

describe("project scheduled task identities", () => {
  it("uses stable lowercase MD5 identifiers", () => {
    expect(scheduledTaskProjectDigest("project_1")).toMatch(/^[a-f0-9]{32}$/u);
    expect(projectScheduledTaskId("project_1", "cmd_1")).toMatch(/^[a-f0-9]{32}$/u);
    expect(projectScheduledTaskRunId("a".repeat(32), "b".repeat(32))).toMatch(/^[a-f0-9]{32}$/u);
    expect(projectScheduledTaskEventId("a".repeat(32), "cmd_1")).toMatch(/^[a-f0-9]{32}$/u);
  });

  it("is stable and namespace-separated", () => {
    expect(projectScheduledTaskId("project_1", "cmd_1")).toBe(projectScheduledTaskId("project_1", "cmd_1"));
    expect(projectScheduledTaskId("project_1", "cmd_1")).not.toBe(projectScheduledTaskId("project_1", "cmd_2"));
  });

  it("uses stable lowercase MD5 digests for auxiliary fields", () => {
    expect(scheduledTaskLoopBindingDigest("binding_1")).toMatch(/^[a-f0-9]{32}$/u);
    expect(scheduledTaskExecutionTargetDigest(localAgentTarget)).toMatch(/^[a-f0-9]{32}$/u);
    expect(scheduledTaskActorDigest("user_1")).toMatch(/^[a-f0-9]{32}$/u);
  });

  it("stably derives each auxiliary digest", () => {
    expect(scheduledTaskLoopBindingDigest("binding_1")).toBe(scheduledTaskLoopBindingDigest("binding_1"));
    expect(scheduledTaskExecutionTargetDigest(localAgentTarget)).toBe(scheduledTaskExecutionTargetDigest(localAgentTarget));
    expect(scheduledTaskActorDigest("user_1")).toBe(scheduledTaskActorDigest("user_1"));
  });

  it("separates auxiliary digest namespaces", () => {
    const loopBindingDigest = scheduledTaskLoopBindingDigest("shared_1");
    const executionTargetDigest = scheduledTaskExecutionTargetDigest({
      type: "local_agent",
      agentProfileId: "shared_1",
    });
    const actorDigest = scheduledTaskActorDigest("shared_1");

    expect(new Set([loopBindingDigest, executionTargetDigest, actorDigest])).toHaveLength(3);
  });

  it("separates execution target digests by target type", () => {
    expect(scheduledTaskExecutionTargetDigest({
      type: "local_agent",
      agentProfileId: "shared_1",
    })).not.toBe(scheduledTaskExecutionTargetDigest({
      type: "linux_worker_pool",
      workerPoolId: "shared_1",
    }));
  });

  it("rejects blank auxiliary identity values", () => {
    expect(() => scheduledTaskLoopBindingDigest("   ")).toThrow("bindingId is required");
    expect(() => scheduledTaskExecutionTargetDigest({
      type: "local_agent",
      agentProfileId: "   ",
    })).toThrow("agentProfileId is required");
    expect(() => scheduledTaskExecutionTargetDigest({
      type: "linux_worker_pool",
      workerPoolId: "   ",
    })).toThrow("workerPoolId is required");
    expect(() => scheduledTaskActorDigest("   ")).toThrow("userId is required");
  });
});
