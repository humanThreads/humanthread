import { describe, expect, it, vi } from "vitest";
import { executePlatformLoopAttempt } from "./loop-platform-execution";

const now = new Date("2026-07-30T06:00:00.000Z");
const claim = {
  loopRunId: "loop_run_1",
  projectId: "project_1",
  actorUserId: "user_1",
  nodeRunId: "node_run_1",
  nodeRunVersion: 2,
  attemptId: "attempt_1",
  attemptNo: 1,
  attemptVersion: 2,
  claimToken: "claim_1",
  node: {
    key: "write",
    label: "Write",
    type: "platform_action" as const,
    executionTarget: "platform" as const,
    action: "project_document.write",
    config: { documentId: "doc_1", expectedVersion: 3, title: "Report", contentMarkdown: "# Done" },
  },
  inputSnapshot: { objective: "Ship" },
};

function dependencies() {
  return {
    now: vi.fn(() => now),
    claimAttempt: vi.fn().mockResolvedValue(claim),
    reserveEffect: vi.fn().mockResolvedValue({ effectKey: "effect_1", status: "prepared" }),
    resolveEffect: vi.fn().mockResolvedValue(undefined),
    executeNode: vi.fn().mockResolvedValue({
      status: "completed",
      result: {
        outcome: "success",
        output: { documentId: "doc_1", version: 4 },
        artifactRefs: [],
        effectReceipts: [{ effectKey: "effect_1", documentId: "doc_1", version: 4 }],
      },
    }),
    completeNode: vi.fn().mockResolvedValue(undefined),
    waitNode: vi.fn().mockResolvedValue(undefined),
  };
}

describe("executePlatformLoopAttempt", () => {
  it("reserves and resolves an allowlisted effect before transactional node completion", async () => {
    const deps = dependencies();

    await expect(executePlatformLoopAttempt({
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_1",
      attemptId: "attempt_1",
      attemptNo: 1,
      nodeKey: "write",
      correlationId: "loop:loop_run_1",
    }, deps)).resolves.toEqual({ status: "completed" });

    expect(deps.reserveEffect).toHaveBeenCalledWith(expect.objectContaining({
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      attemptId: "attempt_1",
      claimToken: "claim_1",
      operationType: "project_document.write",
    }));
    const effectKey = deps.executeNode.mock.calls[0]?.[0].effectKey;
    expect(effectKey).toMatch(/^effect:/u);
    expect(deps.resolveEffect).toHaveBeenCalledWith(expect.objectContaining({
      effectKey,
      claimToken: "claim_1",
      status: "succeeded",
    }));
    expect(deps.completeNode).toHaveBeenCalledWith(expect.objectContaining({
      attemptVersion: 2,
      claimToken: "claim_1",
      result: expect.objectContaining({ outcome: "success" }),
    }));
  });

  it("persists a wait and does not complete the node inline", async () => {
    const deps = dependencies();
    deps.claimAttempt.mockResolvedValue({
      ...claim,
      node: {
        key: "wait",
        label: "Wait",
        type: "wait_callback",
        executionTarget: "platform",
        callback: { delayMs: 60_000 },
      },
    });
    deps.executeNode.mockResolvedValue({
      status: "waiting",
      waitingReason: "timer",
      wakeAt: new Date("2026-07-30T06:01:00.000Z"),
    });

    await expect(executePlatformLoopAttempt({
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_1",
      attemptId: "attempt_1",
      attemptNo: 1,
      nodeKey: "wait",
      correlationId: "loop:loop_run_1",
    }, deps)).resolves.toEqual({ status: "waiting" });

    expect(deps.waitNode).toHaveBeenCalledWith(expect.objectContaining({
      claimToken: "claim_1",
      wakeAt: new Date("2026-07-30T06:01:00.000Z"),
    }));
    expect(deps.completeNode).not.toHaveBeenCalled();
  });

  it("binds an authenticated callback wait to the claimed attempt id", async () => {
    const deps = dependencies();
    deps.claimAttempt.mockResolvedValue({
      ...claim,
      node: {
        key: "callback",
        label: "Callback",
        type: "wait_callback",
        executionTarget: "platform",
        callback: { secretHash: "a".repeat(64) },
      },
    });
    deps.executeNode.mockResolvedValue({
      status: "waiting",
      waitingReason: "callback",
      callbackSecretHash: "a".repeat(64),
    });

    await expect(executePlatformLoopAttempt({
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_1",
      attemptId: "attempt_1",
      attemptNo: 1,
      nodeKey: "callback",
      correlationId: "loop:loop_run_1",
    }, deps)).resolves.toEqual({ status: "waiting" });

    expect(deps.waitNode).toHaveBeenCalledWith(expect.objectContaining({
      waitingReason: "callback",
      callbackId: "attempt_1",
      secretHash: "a".repeat(64),
    }));
  });

  it("passes a child-loop wait to the durable runtime and skips effect reservation", async () => {
    const deps = dependencies();
    deps.claimAttempt.mockResolvedValue({
      ...claim,
      node: {
        key: "develop",
        label: "Develop",
        type: "platform_action",
        executionTarget: "platform",
        action: "task_loop.invoke",
      },
      taskId: "task_1",
    });
    deps.executeNode.mockResolvedValue({
      status: "waiting",
      waitingReason: "child_loop",
      childLoopRunId: "child_run_1",
    });

    await expect(executePlatformLoopAttempt({
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_1",
      attemptId: "attempt_1",
      attemptNo: 1,
      nodeKey: "develop",
      correlationId: "loop:loop_run_1",
    }, deps)).resolves.toEqual({ status: "waiting" });

    expect(deps.reserveEffect).not.toHaveBeenCalled();
    expect(deps.waitNode).toHaveBeenCalledWith(expect.objectContaining({
      waitingReason: "child_loop",
      childLoopRunId: "child_run_1",
    }));
  });

  it("fails the claimed attempt and resolves its effect when node execution throws", async () => {
    const deps = dependencies();
    deps.executeNode.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(executePlatformLoopAttempt({
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_1",
      attemptId: "attempt_1",
      attemptNo: 1,
      nodeKey: "write",
      correlationId: "loop:loop_run_1",
    }, deps)).rejects.toThrow("provider unavailable");

    expect(deps.resolveEffect).toHaveBeenCalledWith(expect.objectContaining({
      effectKey: expect.stringMatching(/^effect:/u),
      status: "failed",
      claimToken: "claim_1",
    }));
    expect(deps.completeNode).toHaveBeenCalledWith(expect.objectContaining({
      claimToken: "claim_1",
      result: expect.objectContaining({
        outcome: "failure",
        failure: expect.objectContaining({ status: "FAILED" }),
      }),
    }));
  });

  it("closes the claimed attempt when effect reservation fails", async () => {
    const deps = dependencies();
    deps.reserveEffect.mockRejectedValueOnce(new Error("reservation unavailable"));

    await expect(executePlatformLoopAttempt({
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_1",
      attemptId: "attempt_1",
      attemptNo: 1,
      nodeKey: "write",
      correlationId: "loop:loop_run_1",
    }, deps)).rejects.toThrow("reservation unavailable");

    expect(deps.completeNode).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ outcome: "failure" }),
    }));
    expect(deps.executeNode).not.toHaveBeenCalled();
  });

  it("fails the attempt when effect resolution fails after execution", async () => {
    const deps = dependencies();
    deps.resolveEffect.mockRejectedValueOnce(new Error("effect resolution unavailable"));

    await expect(executePlatformLoopAttempt({
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_1",
      attemptId: "attempt_1",
      attemptNo: 1,
      nodeKey: "write",
      correlationId: "loop:loop_run_1",
    }, deps)).rejects.toThrow("effect resolution unavailable");

    expect(deps.resolveEffect).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: "failed" }));
    expect(deps.completeNode).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ outcome: "failure" }),
    }));
  });

  it("preserves the original execution error when failure cleanup also fails", async () => {
    const deps = dependencies();
    deps.executeNode.mockRejectedValueOnce(new Error("provider unavailable"));
    deps.completeNode.mockRejectedValueOnce(new Error("cleanup unavailable"));

    await expect(executePlatformLoopAttempt({
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_1",
      attemptId: "attempt_1",
      attemptNo: 1,
      nodeKey: "write",
      correlationId: "loop:loop_run_1",
    }, deps)).rejects.toMatchObject({
      message: "provider unavailable",
      cause: expect.objectContaining({ message: "cleanup unavailable" }),
    });
  });

  it("fails a claimed platform_action that has no executable action instead of leaving the attempt running", async () => {
    const deps = dependencies();
    deps.claimAttempt.mockResolvedValueOnce({
      ...claim,
      node: {
        key: "platform-action-5",
        label: "CONFIRM_CHAPTER",
        type: "platform_action",
        executionTarget: "platform",
      },
    });

    await expect(executePlatformLoopAttempt({
      loopRunId: "loop_run_1",
      projectId: "project_1",
      nodeRunId: "node_run_1",
      attemptId: "attempt_1",
      attemptNo: 1,
      nodeKey: "platform-action-5",
      correlationId: "loop:loop_run_1",
    }, deps)).rejects.toThrow("Platform action key");

    expect(deps.reserveEffect).not.toHaveBeenCalled();
    expect(deps.executeNode).not.toHaveBeenCalled();
    expect(deps.completeNode).toHaveBeenCalledWith(expect.objectContaining({
      claimToken: "claim_1",
      result: expect.objectContaining({
        outcome: "failure",
        failure: expect.objectContaining({ status: "FAILED" }),
      }),
    }));
  });
});
