import { beforeEach, describe, expect, it, vi } from "vitest";

import { decideWorkflowInteraction } from "@/lib/orchestration/workflow-interaction-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@/lib/orchestration/workflow-interaction-commands", () => ({ decideWorkflowInteraction: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ loopRunId: "loop:run_1", interactionId: "interaction_1" }) };

describe("POST /api/loop-runs/:loopRunId/interactions/:interactionId/decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    vi.mocked(decideWorkflowInteraction).mockResolvedValue({ interactionId: "interaction_1", status: "approved", version: 2, selectedEdgeId: "release-production", routed: { status: "routed" } });
  });

  it("requires a selected route for an approval decision", async () => {
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ commandId: "cmd_decide", expectedVersion: 1, decision: "approved", reason: "通过", selectedEdgeId: "release-production" }) }), context);
    expect(response.status).toBe(200);
    expect(decideWorkflowInteraction).toHaveBeenCalledWith(expect.objectContaining({ selectedEdgeId: "release-production", expectedLoopRunId: "loop:run_1" }));
  });

  it("rejects a rejected decision without a reason", async () => {
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ commandId: "cmd_decide", expectedVersion: 1, decision: "rejected", selectedEdgeId: "release-production" }) }), context);
    expect(response.status).toBe(400);
    expect(decideWorkflowInteraction).not.toHaveBeenCalled();
  });
});
