import { describe, expect, it, vi } from "vitest";
import { recoverExpiredRuns } from "./recovery";

describe("recoverExpiredRuns", () => {
  it("delegates orphan state and recovery signaling to one atomic operation", async () => {
    const recoverAtomically = vi.fn().mockResolvedValue(true);
    await expect(recoverExpiredRuns({
      now: new Date("2026-07-21T00:10:00.000Z"),
      loadExpired: vi.fn().mockResolvedValue([{
        id: "run_1",
        loopRunId: "loop_1",
        leaseGeneration: 3,
        workerId: "worker_1",
      }]),
      recoverAtomically,
    })).resolves.toEqual({ recovered: 1 });
    expect(recoverAtomically).toHaveBeenCalledWith({
      id: "run_1",
      loopRunId: "loop_1",
      leaseGeneration: 3,
      workerId: "worker_1",
      now: new Date("2026-07-21T00:10:00.000Z"),
    });
  });
});
