import { describe, expect, it, vi } from "vitest";
import { resumeDueLoopWaits } from "./loop-waits";

const now = new Date("2026-07-30T07:00:00.000Z");

describe("resumeDueLoopWaits", () => {
  it("resumes a due timer exactly once across repeated scans", async () => {
    let waiting = true;
    const candidate = {
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 5,
      attemptId: "attempt_1",
      attemptNo: 1,
      attemptVersion: 3,
      inputSnapshot: { objective: "Ship" },
      checkpoint: {
        waitingReason: "timer",
        wakeAt: "2026-07-30T06:59:00.000Z",
      },
    };
    const completeWaitingNode = vi.fn().mockImplementation(async () => {
      waiting = false;
    });
    const dependencies = {
      loadWaiting: vi.fn(async () => waiting ? [candidate] : []),
      completeWaitingNode,
    };

    await expect(resumeDueLoopWaits({ now, limit: 100 }, dependencies)).resolves.toEqual({
      scanned: 1,
      due: 1,
      resumed: 1,
      contended: 0,
      invalid: 0,
    });
    await expect(resumeDueLoopWaits({ now, limit: 100 }, dependencies)).resolves.toEqual({
      scanned: 0,
      due: 0,
      resumed: 0,
      contended: 0,
      invalid: 0,
    });

    expect(completeWaitingNode).toHaveBeenCalledOnce();
    expect(dependencies.loadWaiting).toHaveBeenCalledWith({ limit: 400, now });
    expect(completeWaitingNode).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "loop_timer:078078907332d7a97d1d8efa74c054ecc1be435645aa981e66e7c4433676a675",
    }));
  });

  it("skips future callbacks and isolates malformed checkpoints", async () => {
    const completeWaitingNode = vi.fn();
    const base = {
      loopRunId: "loop_run_1",
      nodeRunId: "node_run_1",
      nodeRunVersion: 5,
      attemptId: "attempt_1",
      attemptNo: 1,
      attemptVersion: 3,
      inputSnapshot: {},
    };

    await expect(resumeDueLoopWaits({ now, limit: 10 }, {
      loadWaiting: vi.fn().mockResolvedValue([
        { ...base, checkpoint: { waitingReason: "callback", callbackId: "attempt_1", secretHash: "a".repeat(64) } },
        { ...base, attemptId: "attempt_bad", checkpoint: { waitingReason: "timer", wakeAt: "invalid" } },
        { ...base, attemptId: "attempt_future", checkpoint: { waitingReason: "timer", wakeAt: "2026-07-30T07:01:00.000Z" } },
      ]),
      completeWaitingNode,
    })).resolves.toEqual({
      scanned: 3,
      due: 0,
      resumed: 0,
      contended: 0,
      invalid: 1,
    });

    expect(completeWaitingNode).not.toHaveBeenCalled();
  });
});
