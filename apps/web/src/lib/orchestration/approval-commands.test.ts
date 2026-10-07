import { describe, expect, it, vi } from "vitest";
import { decideApproval } from "./approval-commands";

describe("decideApproval", () => {
  it("creates a request-bound grant and rejects a second decision", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await expect(decideApproval({ approvalId: "a1", actorUserId: "u1", decision: "approved", reason: "Reviewed", now: new Date("2026-07-21T00:00:00.000Z") }, { load: vi.fn().mockResolvedValue({ id: "a1", projectId: "p1", status: "pending", requestPayload: { actionFingerprint: "sha256:x" }, expiresAt: null }), authorize: vi.fn(), updateMany })).resolves.toMatchObject({ status: "approved", grant: { approvalId: "a1", actionFingerprint: "sha256:x" } });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "a1", status: "pending" } }));
    await expect(decideApproval({ approvalId: "a1", actorUserId: "u1", decision: "approved", reason: "Again", now: new Date("2026-07-21T00:00:00.000Z") }, { load: vi.fn().mockResolvedValue({ id: "a1", projectId: "p1", status: "approved", requestPayload: {}, expiresAt: null }), authorize: vi.fn(), updateMany })).rejects.toMatchObject({ code: "version_conflict" });
  });

  it("delegates Loop approvals to the distinct Loop decision semantics", async () => {
    const decideLoopApproval = vi.fn().mockResolvedValue({ outcome: "rework", selectedEdgeId: "review_to_draft" });

    await expect(decideApproval({
      approvalId: "a_loop",
      actorUserId: "u1",
      decision: "changes_requested",
      reason: "Revise",
      selectedEdgeId: "review_to_draft",
      now: new Date("2026-07-31T01:00:00.000Z"),
    }, {
      load: vi.fn().mockResolvedValue({
        id: "a_loop",
        projectId: "p1",
        type: "loop_human_gate",
        status: "pending",
        requestPayload: {},
        expiresAt: null,
      }),
      authorize: vi.fn(),
      updateMany: vi.fn(),
      decideLoopApproval,
    })).resolves.toMatchObject({ outcome: "rework" });

    expect(decideLoopApproval).toHaveBeenCalledWith(expect.objectContaining({
      decision: "changes_requested",
      selectedEdgeId: "review_to_draft",
    }));
  });

  it("persists an expired status before rejecting a late decision", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await expect(decideApproval({
      approvalId: "expired_approval",
      actorUserId: "u1",
      decision: "approved",
      reason: "Too late",
      now: new Date("2026-08-06T17:00:00.000Z"),
    }, {
      load: vi.fn().mockResolvedValue({
        id: "expired_approval", projectId: "p1", status: "pending", requestPayload: {},
        expiresAt: new Date("2026-08-06T16:00:00.000Z"),
      }),
      authorize: vi.fn(),
      updateMany,
    })).rejects.toMatchObject({ code: "version_conflict" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "expired_approval", status: "pending" },
      data: { status: "expired", decidedAt: new Date("2026-08-06T17:00:00.000Z"), decisionReason: "审批已过期" },
    });
  });
});
