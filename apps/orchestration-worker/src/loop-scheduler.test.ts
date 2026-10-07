import { describe, expect, it, vi } from "vitest";
import { scheduleReadyLoopNodes } from "./loop-scheduler";

const now = new Date("2026-07-30T05:00:00.000Z");

const platformCandidate = {
  loopRunId: "loop_run_1",
  projectId: "project_1",
  nodeRunId: "node_run_start_1",
  nodeRunVersion: 1,
  nodeKey: "start",
  activationNo: 1,
  attemptCount: 0,
  inputSnapshot: { objective: "Ship" },
  bindingSnapshot: { parameterOverrides: {} },
  node: { key: "start", label: "Start", type: "start" as const },
};

describe("scheduleReadyLoopNodes", () => {
  it("activates platform and local nodes with concrete execution targets", async () => {
    const localCandidate = {
      ...platformCandidate,
      nodeRunId: "node_run_local_1",
      nodeKey: "implement",
      agentProfileId: "agent_profile_1",
      bindingSnapshot: { parameterOverrides: { agentProfileId: "agent_profile_1" } },
      node: {
        key: "implement",
        label: "Implement",
        type: "agent_action" as const,
        executionTarget: "either" as const,
        promptTemplate: "Implement",
      },
    };
    const activate = vi.fn().mockResolvedValue({ nodeRunId: "node", attemptId: "attempt" });

    await expect(scheduleReadyLoopNodes({
      limit: 10,
      now,
      loadReady: vi.fn().mockResolvedValue([platformCandidate, localCandidate]),
      activate,
    })).resolves.toEqual({ scanned: 2, activated: 2, contended: 0 });

    expect(activate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      executionTarget: "platform",
      nodeRunId: "node_run_start_1",
    }));
    expect(activate.mock.calls[0]?.[0]).not.toHaveProperty("agentRun");
    expect(activate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      executionTarget: "local",
      nodeRunId: "node_run_local_1",
      agentRun: expect.objectContaining({
        agentProfileId: "agent_profile_1",
        projectId: "project_1",
      }),
    }));
  });

  it("uses stable attempt identities and treats a repeated CAS loss as contention", async () => {
    const activate = vi.fn()
      .mockResolvedValueOnce({ nodeRunId: "node_run_start_1", attemptId: "attempt_1" })
      .mockRejectedValueOnce(Object.assign(new Error("stale"), { code: "stale_lease" }));
    const input = {
      limit: 10,
      now,
      loadReady: vi.fn().mockResolvedValue([platformCandidate]),
      activate,
    };

    await expect(scheduleReadyLoopNodes(input)).resolves.toEqual({ scanned: 1, activated: 1, contended: 0 });
    await expect(scheduleReadyLoopNodes(input)).resolves.toEqual({ scanned: 1, activated: 0, contended: 1 });

    expect(activate.mock.calls[0]?.[0]).toMatchObject({
      attemptId: activate.mock.calls[1]?.[0].attemptId,
    });
  });

  it("activates ready nodes regardless of the legacy rollout allowlist", async () => {
    const activate = vi.fn();

    await expect(scheduleReadyLoopNodes({
      limit: 10,
      now,
      loadReady: vi.fn().mockResolvedValue([platformCandidate]),
      activate,
    })).resolves.toEqual({ scanned: 1, activated: 1, contended: 0 });

    expect(activate).toHaveBeenCalledOnce();
  });

  it("uses the sole allowed AgentProfile when an older Run omitted the override", async () => {
    const activate = vi.fn().mockResolvedValue({ nodeRunId: "node", attemptId: "attempt" });
    const localCandidate = {
      ...platformCandidate,
      nodeKey: "implement",
      bindingSnapshot: { parameterOverrides: {}, allowedAgentProfileIds: ["agent_profile_gelsang_codex"] },
      node: {
        key: "implement",
        label: "Implement",
        type: "agent_action" as const,
        executionTarget: "local" as const,
        promptTemplate: "Implement",
      },
    };

    await expect(scheduleReadyLoopNodes({
      limit: 10,
      now,
      loadReady: vi.fn().mockResolvedValue([localCandidate]),
      activate,
    })).resolves.toMatchObject({ scanned: 1, activated: 1, contended: 0 });
    expect(activate).toHaveBeenCalledWith(expect.objectContaining({
      agentRun: expect.objectContaining({ agentProfileId: "agent_profile_gelsang_codex" }),
    }));
  });

  it("does not dispatch a v2 stage to a Worker without an explicit v2 capability", async () => {
    const activate = vi.fn();
    await expect(scheduleReadyLoopNodes({
      limit: 10,
      now,
      loadReady: vi.fn().mockResolvedValue([{
        ...platformCandidate,
        requiredLoopContractVersion: 2,
        workerSupportedLoopContractVersions: [1],
      }]),
      activate,
    })).resolves.toEqual({ scanned: 0, activated: 0, contended: 0 });
    expect(activate).not.toHaveBeenCalled();
  });

  it("does not trust an unverified AgentProfile ID from the binding snapshot", async () => {
    const activate = vi.fn();
    const localCandidate = {
      ...platformCandidate,
      nodeKey: "implement",
      node: {
        key: "implement",
        label: "Implement",
        type: "agent_action" as const,
        executionTarget: "local" as const,
        promptTemplate: "Implement",
      },
      bindingSnapshot: { parameterOverrides: { agentProfileId: "unverified_profile" } },
    };

    await expect(scheduleReadyLoopNodes({
      limit: 10,
      now,
      loadReady: vi.fn().mockResolvedValue([localCandidate]),
      activate,
    })).rejects.toMatchObject({ code: "validation_failed" });

    expect(activate).not.toHaveBeenCalled();
  });

  it("routes a declared Human Gate through the gate-aware dispatcher", async () => {
    const activate = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({ status: "waiting_approval" });
    const humanGate = {
      ...platformCandidate,
      nodeRunId: "node_run_review_1",
      nodeKey: "review",
      node: {
        key: "review",
        label: "Review",
        type: "human_gate" as const,
        executionTarget: "platform" as const,
        prompt: "Review the result",
      },
    };

    await scheduleReadyLoopNodes({
      limit: 10,
      now,
      loadReady: vi.fn().mockResolvedValue([humanGate]),
      activate,
      dispatch,
    });

    expect(dispatch).toHaveBeenCalledWith(
      humanGate,
      expect.objectContaining({ nodeRunId: "node_run_review_1", executionTarget: "platform" }),
    );
    expect(activate).not.toHaveBeenCalled();
  });

  it("routes a configuration-blocked local node without constructing an AgentRun", async () => {
    const activate = vi.fn();
    const dispatch = vi.fn().mockResolvedValue({ status: "waiting_configuration" });
    const blocked = {
      ...platformCandidate,
      nodeRunId: "node_run_local_1",
      nodeKey: "implement",
      localExecutionReadiness: {
        ready: false,
        reason: "profile_not_allowed",
        configurationVersion: "binding:3|profile:none|worker:0|runtime:0|workspace:0|grant:0",
        evidence: {},
      },
      node: {
        key: "implement",
        label: "Implement",
        type: "agent_action" as const,
        executionTarget: "local" as const,
        promptTemplate: "Implement",
      },
    };

    await expect(scheduleReadyLoopNodes({
      limit: 10,
      now,
      loadReady: vi.fn().mockResolvedValue([blocked]),
      activate,
      dispatch,
    })).resolves.toEqual({ scanned: 1, activated: 1, contended: 0 });

    expect(dispatch).toHaveBeenCalledWith(blocked, expect.not.objectContaining({ agentRun: expect.anything() }));
    expect(activate).not.toHaveBeenCalled();
  });
});
