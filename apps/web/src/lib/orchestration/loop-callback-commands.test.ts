import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { completeLoopCallback } from "./loop-callback-commands";

describe("completeLoopCallback", () => {
  it("hashes the one-time secret before completing the waiting node", async () => {
    const completeWaitingNode = vi.fn().mockResolvedValue({ completed: true, duplicate: false });

    await expect(completeLoopCallback({
      loopRunId: "loop_run_1",
      callbackId: "attempt_1",
      commandId: "callback_command_1",
      secret: "callback-secret-value",
      payload: { approved: true },
    }, {
      now: () => new Date("2026-07-30T07:00:00.000Z"),
      completeWaitingNode,
    })).resolves.toEqual({ completed: true, duplicate: false });

    expect(completeWaitingNode).toHaveBeenCalledWith(expect.objectContaining({
      loopRunId: "loop_run_1",
      callbackId: "attempt_1",
      commandId: "callback_command_1",
      secretHash: createHash("sha256").update("callback-secret-value").digest("hex"),
      result: { outcome: "success", output: { approved: true }, artifactRefs: [], effectReceipts: [] },
    }));
    expect(JSON.stringify(completeWaitingNode.mock.calls)).not.toContain("callback-secret-value");
  });

  it("rejects an oversized serialized payload before completing the waiting node", async () => {
    const completeWaitingNode = vi.fn();

    await expect(completeLoopCallback({
      loopRunId: "loop_run_1",
      callbackId: "attempt_1",
      commandId: "callback_command_1",
      secret: "callback-secret-value",
      payload: { body: "x".repeat(64 * 1_024) },
    }, {
      now: () => new Date("2026-07-30T07:00:00.000Z"),
      completeWaitingNode,
    })).rejects.toMatchObject({ code: "validation_failed" });

    expect(completeWaitingNode).not.toHaveBeenCalled();
  });
});
