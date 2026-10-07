import { beforeEach, describe, expect, it, vi } from "vitest";
import { decideApproval } from "@/lib/orchestration/approval-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@/lib/orchestration/approval-commands", () => ({ decideApproval: vi.fn() }));
vi.mock("@/lib/orchestration/loop-approval-commands", () => ({ applyLoopApprovalDecision: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "manager_1" }) }));

describe("POST /api/approvals/:approvalId/decision", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a rejection without a reason before calling the command", async () => {
    const request = new Request("http://localhost/api/approvals/approval_1/decision", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "rejected", reason: "  " }) });
    const response = await POST(request, { params: Promise.resolve({ approvalId: "approval_1" }) });
    expect(response.status).toBe(400);
    expect(decideApproval).not.toHaveBeenCalled();
    expect(resolveWorkbenchApiActor).not.toHaveBeenCalled();
  });

  it("accepts a Human Gate changes-requested decision with an explicit edge", async () => {
    vi.mocked(decideApproval).mockResolvedValue({ outcome: "rework", selectedEdgeId: "review_to_draft" } as never);
    const request = new Request("http://localhost/api/approvals/approval_1/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decision: "changes_requested",
        reason: "Revise evidence",
        selectedEdgeId: "review_to_draft",
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ approvalId: "approval_1" }) });

    expect(response.status).toBe(200);
    expect(decideApproval).toHaveBeenCalledWith(expect.objectContaining({
      decision: "changes_requested",
      selectedEdgeId: "review_to_draft",
      actorUserId: "manager_1",
    }), expect.anything());
  });

  it("preserves a Loop approval version conflict as HTTP 409", async () => {
    vi.mocked(decideApproval).mockRejectedValue(Object.assign(
      new Error("Approval decision conflict"),
      { code: "version_conflict" },
    ));
    const request = new Request("http://localhost/api/approvals/approval_1/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved", reason: "Confirmed", selectedEdgeId: "confirm_write_prd" }),
    });

    const response = await POST(request, { params: Promise.resolve({ approvalId: "approval_1" }) });

    expect(response.status).toBe(409);
  });
});
