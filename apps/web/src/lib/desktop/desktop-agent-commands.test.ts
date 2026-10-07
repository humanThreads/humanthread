import { describe, expect, it, vi } from "vitest";

import {
  commandDesktopLoop,
  decideDesktopApproval,
  runDesktopApprovalCommand,
  runDesktopLoopCommand,
  toTaskLoopScope,
} from "./desktop-agent-commands";

const context = {
  actor: { userId: "user_1", authKind: "desktop_token", sessionId: "session_1" },
  space: { id: "space_1", key: "personal", kind: "personal", name: "Personal", role: "owner", companyId: null },
  spaces: [],
  workbench: { userId: "user_1", teamId: "team_1", projectId: "project_1", matterTypeId: "matter_1" },
  nativeExecutionAuthorized: true,
  localDeviceId: "device_1",
} as const;

describe("desktop Agent commands", () => {
  it("does not expose a graph-only Loop through the legacy Task command scope", () => {
    expect(toTaskLoopScope({ taskId: null, task: null })).toBeNull();
    expect(toTaskLoopScope({ taskId: "task_1", task: { spaceId: "space_1" } })).toEqual({
      taskId: "task_1",
      spaceId: "space_1",
    });
  });

  it("returns a stored approval decision without a second write", async () => {
    const approvalFindUnique = vi.fn();
    const approvalUpdateMany = vi.fn();
    const tx = {
      commandReceipt: {
        findUnique: vi.fn().mockResolvedValue({
          id: "approval:receipt",
          status: "completed",
          result: { resourceType: "approval", id: "approval_1", status: "approved" },
        }),
        create: vi.fn(),
        update: vi.fn(),
      },
      orchestrationEvent: { createMany: vi.fn() },
      outboxMessage: { createMany: vi.fn() },
      approvalRequest: {
        findUnique: approvalFindUnique,
        updateMany: approvalUpdateMany,
        count: vi.fn(),
      },
      loopRun: { findUnique: vi.fn(), updateMany: vi.fn() },
    };

    await expect(runDesktopApprovalCommand({
      approvalId: "approval_1",
      actorUserId: "user_1",
      commandId: "desktop:agent:approval:1",
      decision: "approved",
      reason: "",
      db: { $transaction: vi.fn(async (callback) => callback(tx)) },
      now: new Date("2026-07-27T10:00:00.000Z"),
    })).resolves.toMatchObject({ status: "approved" });

    expect(approvalFindUnique).not.toHaveBeenCalled();
    expect(approvalUpdateMany).not.toHaveBeenCalled();
  });

  it("writes a versioned Loop transition and command receipt in one transaction", async () => {
    const loopUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const agentRunFindMany = vi.fn().mockResolvedValue([]);
    const receiptUpdate = vi.fn().mockResolvedValue(undefined);
    const tx = {
      commandReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
        update: receiptUpdate,
      },
      orchestrationEvent: { createMany: vi.fn() },
      outboxMessage: { createMany: vi.fn() },
      approvalRequest: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      loopRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: "loop_1", status: "running", version: 3,
          budgetSnapshot: { maxIterations: 5 }, usageAggregate: { iterations: 2 },
        }),
        updateMany: loopUpdateMany,
      },
      agentRun: { findMany: agentRunFindMany, updateMany: vi.fn() },
      agentWorker: { updateMany: vi.fn() },
    };

    await expect(runDesktopLoopCommand({
      loopRunId: "loop_1",
      actorUserId: "user_1",
      commandId: "desktop:agent:loop:1",
      command: "pause",
      expectedVersion: 3,
      db: { $transaction: vi.fn(async (callback) => callback(tx)) },
      now: new Date("2026-07-27T10:00:00.000Z"),
    })).resolves.toEqual({ resourceType: "loop", id: "loop_1", status: "paused", version: 4 });

    expect(loopUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "loop_1", version: 3 },
      data: expect.objectContaining({ status: "paused", version: 4 }),
    }));
    expect(receiptUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "completed" }),
    }));
    expect(agentRunFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ loopRunId: "loop_1" }),
    }));
  });

  it("rejects an approval outside the selected Space before authorization", async () => {
    const assertCanWriteProject = vi.fn();
    const runApprovalCommand = vi.fn();

    await expect(decideDesktopApproval(
      new Request("http://localhost/api/desktop/agents/approvals/a1?space=personal"),
      "approval_1",
      { commandId: "desktop:agent:approval:1", decision: "approved", reason: "" },
      {
        resolveDesktopReadContext: vi.fn().mockResolvedValue(context),
        findApprovalScope: vi.fn().mockResolvedValue({ projectId: "project_1", spaceId: "space_2" }),
        assertCanWriteProject,
        runApprovalCommand,
      },
    )).rejects.toThrow("Approval not found");

    expect(assertCanWriteProject).not.toHaveBeenCalled();
    expect(runApprovalCommand).not.toHaveBeenCalled();
  });

  it("forwards the authenticated actor and command ID to an authorized decision", async () => {
    const runApprovalCommand = vi.fn().mockResolvedValue({
      resourceType: "approval", id: "approval_1", status: "approved",
    });

    await expect(decideDesktopApproval(
      new Request("http://localhost/api/desktop/agents/approvals/a1?space=personal"),
      "approval_1",
      { commandId: "desktop:agent:approval:1", decision: "approved", reason: "Reviewed" },
      {
        resolveDesktopReadContext: vi.fn().mockResolvedValue(context),
        findApprovalScope: vi.fn().mockResolvedValue({ projectId: "project_1", spaceId: "space_1" }),
        assertCanWriteProject: vi.fn().mockResolvedValue(undefined),
        runApprovalCommand,
      },
    )).resolves.toMatchObject({ id: "approval_1", status: "approved" });

    expect(runApprovalCommand).toHaveBeenCalledWith(expect.objectContaining({
      approvalId: "approval_1",
      actorUserId: "user_1",
      commandId: "desktop:agent:approval:1",
    }));
  });

  it("enforces selected Space before forwarding a versioned Loop command", async () => {
    const runLoopCommand = vi.fn().mockResolvedValue({
      resourceType: "loop", id: "loop_1", status: "paused", version: 4,
    });

    await expect(commandDesktopLoop(
      new Request("http://localhost/api/desktop/agents/loops/loop_1?space=personal"),
      "loop_1",
      { commandId: "desktop:agent:loop:1", command: "pause", expectedVersion: 3 },
      {
        resolveDesktopReadContext: vi.fn().mockResolvedValue(context),
        findLoopScope: vi.fn().mockResolvedValue({ taskId: "task_1", spaceId: "space_1" }),
        assertCanDispatchTaskAgent: vi.fn().mockResolvedValue(undefined),
        runLoopCommand,
      },
    )).resolves.toMatchObject({ status: "paused", version: 4 });

    expect(runLoopCommand).toHaveBeenCalledWith(expect.objectContaining({
      loopRunId: "loop_1",
      actorUserId: "user_1",
      commandId: "desktop:agent:loop:1",
      expectedVersion: 3,
    }));
  });
});
