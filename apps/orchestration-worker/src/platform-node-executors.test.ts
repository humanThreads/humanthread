import { describe, expect, it, vi } from "vitest";
import { PLATFORM_ACTION_KEYS } from "@humanthread/orchestration-core";
import {
  executePlatformNode,
  PLATFORM_NODE_EXECUTORS,
} from "./platform-node-executors";

const dependencies = () => ({
  assertCanWriteProject: vi.fn().mockResolvedValue({ projectId: "project_1", role: "maintainer" }),
  loadDocumentTarget: vi.fn().mockResolvedValue({ id: "doc_1", projectId: "project_1" }),
  updateDocumentIdempotently: vi.fn().mockResolvedValue({ id: "doc_1", version: 4 }),
  invokeTaskScopedChildLoop: vi.fn().mockResolvedValue({ childLoopRunId: "child_run_1" }),
});

describe("platform node executors", () => {
  it("registers an executor for every published platform action", () => {
    const missing = PLATFORM_ACTION_KEYS.filter((key) => (
      key !== "task_loop.invoke" && !(key in PLATFORM_NODE_EXECUTORS)
    ));

    expect(missing).toEqual([]);
  });

  it("rejects an unregistered platform action", async () => {
    await expect(executePlatformNode({
      node: {
        key: "unsafe",
        label: "Unsafe",
        type: "platform_action",
        executionTarget: "platform",
        action: "shell.exec",
      },
      input: {},
      projectId: "project_1",
      actorUserId: "user_1",
      effectKey: "effect_1",
      now: new Date("2026-07-30T06:00:00.000Z"),
    }, dependencies())).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("executes the milestone release snapshot action and preserves the release input", async () => {
    await expect(executePlatformNode({
      node: {
        key: "snapshot_release",
        label: "Snapshot release candidate",
        type: "platform_action",
        executionTarget: "platform",
        action: "milestone.release.snapshot",
      },
      input: {
        releasePlanId: "plan_1",
        selectedTasks: [{ taskId: "task_1", title: "Ship" }],
      },
      projectId: "project_1",
      actorUserId: "user_1",
      effectKey: "effect_snapshot_1",
      now: new Date("2026-07-30T06:00:00.000Z"),
    }, dependencies())).resolves.toEqual({
      status: "completed",
      result: {
        outcome: "success",
        output: {
          releasePlanId: "plan_1",
          selectedTasks: [{ taskId: "task_1", title: "Ship" }],
        },
        artifactRefs: [],
        effectReceipts: [],
      },
    });
  });

  it("uses the effect key as the idempotent document command after Project authorization", async () => {
    const deps = dependencies();

    await expect(PLATFORM_NODE_EXECUTORS["project_document.write"]?.({
      effectKey: "effect_1",
      projectId: "project_1",
      actorUserId: "user_1",
      config: {
        documentId: "doc_1",
        expectedVersion: 3,
        title: "Loop report",
        contentMarkdown: "# Result",
      },
      input: { objective: "Ship" },
    }, deps)).resolves.toEqual({
      outcome: "success",
      output: { documentId: "doc_1", version: 4 },
      artifactRefs: [],
      effectReceipts: [{ effectKey: "effect_1", documentId: "doc_1", version: 4 }],
    });

    expect(deps.assertCanWriteProject).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
    });
    expect(deps.updateDocumentIdempotently).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "effect_1",
      expectedVersion: 3,
      actorUserId: "user_1",
      source: "system",
    }));
  });

  it("allows an idempotent document action to clear the Markdown body", async () => {
    const deps = dependencies();

    await expect(PLATFORM_NODE_EXECUTORS["project_document.write"]?.({
      effectKey: "effect_clear",
      projectId: "project_1",
      actorUserId: "user_1",
      config: {
        documentId: "doc_1",
        expectedVersion: 3,
        title: "Loop report",
        contentMarkdown: "",
      },
      input: {},
    }, deps)).resolves.toMatchObject({ outcome: "success" });

    expect(deps.updateDocumentIdempotently).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "effect_clear",
      contentMarkdown: "",
    }));
  });

  it("evaluates conditions and persists waits without sleeping", async () => {
    const deps = dependencies();

    await expect(executePlatformNode({
      node: {
        key: "check",
        label: "Check",
        type: "condition",
        executionTarget: "platform",
        expression: { "==": [{ var: "approved" }, true] },
      },
      input: { approved: true },
      projectId: "project_1",
      actorUserId: "user_1",
      now: new Date("2026-07-30T06:00:00.000Z"),
    }, deps)).resolves.toMatchObject({ status: "completed", result: { outcome: "success" } });

    await expect(executePlatformNode({
      node: {
        key: "wait",
        label: "Wait",
        type: "wait_callback",
        executionTarget: "platform",
        callback: { delayMs: 60_000 },
      },
      input: { approved: true },
      projectId: "project_1",
      actorUserId: "user_1",
      now: new Date("2026-07-30T06:00:00.000Z"),
    }, deps)).resolves.toEqual({
      status: "waiting",
      waitingReason: "timer",
      wakeAt: new Date("2026-07-30T06:01:00.000Z"),
    });
  });

  it("prepares an authenticated callback wait without exposing a raw secret", async () => {
    await expect(executePlatformNode({
      node: {
        key: "callback",
        label: "Callback",
        type: "wait_callback",
        executionTarget: "platform",
        callback: { secretHash: "a".repeat(64) },
      },
      input: {},
      projectId: "project_1",
      actorUserId: "user_1",
      now: new Date("2026-07-30T06:00:00.000Z"),
    }, dependencies())).resolves.toEqual({
      status: "waiting",
      waitingReason: "callback",
      callbackSecretHash: "a".repeat(64),
    });
  });

  it("invokes a task-scoped child Loop and waits without an EffectExecution", async () => {
    const deps = dependencies();

    await expect(executePlatformNode({
      node: {
        key: "develop",
        label: "Develop",
        type: "platform_action",
        executionTarget: "platform",
        action: "task_loop.invoke",
      },
      input: { branch: "2026-HT100012" },
      projectId: "project_1",
      taskId: "task_1",
      loopRunId: "parent_run_1",
      nodeRunId: "parent_node_1",
      attemptId: "parent_attempt_1",
      correlationId: "loop:parent_run_1",
      actorUserId: "user_1",
      now: new Date("2026-07-30T06:00:00.000Z"),
    }, deps)).resolves.toEqual({
      status: "waiting",
      waitingReason: "child_loop",
      childLoopRunId: "child_run_1",
    });

    expect(deps.invokeTaskScopedChildLoop).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project_1",
      taskId: "task_1",
      correlationId: "loop:parent_run_1",
      parent: { loopRunId: "parent_run_1", nodeRunId: "parent_node_1", attemptId: "parent_attempt_1" },
    }));
  });

  it("rejects task child invocation without a correlation id", async () => {
    const deps = dependencies();

    await expect(executePlatformNode({
      node: {
        key: "develop",
        label: "Develop",
        type: "platform_action",
        executionTarget: "platform",
        action: "task_loop.invoke",
      },
      input: {},
      projectId: "project_1",
      taskId: "task_1",
      loopRunId: "parent_run_1",
      nodeRunId: "parent_node_1",
      attemptId: "parent_attempt_1",
      actorUserId: "user_1",
      now: new Date("2026-07-30T06:00:00.000Z"),
    }, deps)).rejects.toThrow("Correlation id is invalid");

    expect(deps.invokeTaskScopedChildLoop).not.toHaveBeenCalled();
  });
});
