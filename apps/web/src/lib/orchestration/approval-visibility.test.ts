import { describe, expect, it, vi } from "vitest";
import { buildActiveApprovalWhere, expirePendingApprovals } from "./approval-visibility";

describe("buildActiveApprovalWhere", () => {
  it("excludes time-expired and terminal-Loop approvals while keeping a non-expiring active Human Gate", () => {
    const now = new Date("2026-08-06T17:00:00.000Z");

    expect(buildActiveApprovalWhere(now)).toEqual({
      status: "pending",
      AND: [
        {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
        {
          OR: [
            { loopRunId: null },
            { loopRun: { status: { notIn: ["completed", "failed", "cancelled", "exhausted"] } } },
          ],
        },
      ],
    });
  });

  it("marks time-expired and terminal-Loop pending approvals as expired with an atomic update", async () => {
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 3 });
    const now = new Date("2026-08-06T17:00:00.000Z");

    await expect(expirePendingApprovals({
      now,
      scope: { project: { spaceId: { in: ["space_1"] } } },
      updateMany,
    })).resolves.toEqual({ count: 5 });
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        AND: [
          { project: { spaceId: { in: ["space_1"] } } },
          { status: "pending", expiresAt: { not: null, lte: now } },
        ],
      },
      data: {
        status: "expired",
        decidedAt: now,
        decisionReason: "审批已过期",
      },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        AND: [
          { project: { spaceId: { in: ["space_1"] } } },
          { status: "pending", loopRun: { status: { in: ["completed", "failed", "cancelled", "exhausted"] } } },
        ],
      },
      data: {
        status: "expired",
        decidedAt: now,
        decisionReason: "Loop 已结束，审批自动失效",
      },
    });
  });
});
