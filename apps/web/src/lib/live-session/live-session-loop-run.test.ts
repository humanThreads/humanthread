import { describe, expect, it, vi } from "vitest";

import { startLiveSessionLoopRun } from "./live-session-loop-run";

describe("LiveSession Loop run binding", () => {
  it("starts a project Worker Pool Loop for a Worker session", async () => {
    const triggerTaskLoop = vi.fn().mockResolvedValue({ id: "loop_run_1" });
    const result = await startLiveSessionLoopRun({
      userId: "user_1",
      projectId: "project_1",
      taskId: "task_1",
      commandId: "a".repeat(32),
      target: { type: "worker_pool", workerPoolId: "b".repeat(32), displayName: "ht-agnet" },
    }, {
      triggerTaskLoop,
      findLocalAgentProfile: vi.fn(),
    });

    expect(result).toEqual({ type: "loop_run", id: "loop_run_1" });
    expect(triggerTaskLoop).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_1",
      taskId: "task_1",
      commandId: "a".repeat(32),
      executionTarget: { type: "linux_worker_pool", workerPoolId: "b".repeat(32) },
    }));
  });

  it("resolves one active local Agent profile for an Agent device Loop", async () => {
    const triggerTaskLoop = vi.fn().mockResolvedValue({ id: "loop_run_2" });
    const findLocalAgentProfile = vi.fn().mockResolvedValue({ id: "profile_1" });

    await expect(startLiveSessionLoopRun({
      userId: "user_1",
      projectId: "project_1",
      taskId: "task_1",
      commandId: "c".repeat(32),
      target: { type: "agent_device", deviceId: "device_1", displayName: "Mac Studio" },
    }, { triggerTaskLoop, findLocalAgentProfile })).resolves.toEqual({ type: "loop_run", id: "loop_run_2" });

    expect(findLocalAgentProfile).toHaveBeenCalledWith({ projectId: "project_1" });
    expect(triggerTaskLoop).toHaveBeenCalledWith(expect.objectContaining({
      executionTarget: { type: "local_agent", agentProfileId: "profile_1" },
    }));
  });

  it("fails closed when the Agent device has no usable local profile", async () => {
    await expect(startLiveSessionLoopRun({
      userId: "user_1",
      projectId: "project_1",
      taskId: "task_1",
      commandId: "d".repeat(32),
      target: { type: "agent_device", deviceId: "device_1", displayName: "Mac Studio" },
    }, {
      triggerTaskLoop: vi.fn(),
      findLocalAgentProfile: vi.fn().mockResolvedValue(null),
    })).rejects.toMatchObject({ code: "agent_runtime_unavailable" });
  });
});
