import { beforeEach, describe, expect, it, vi } from "vitest";

import { decideDesktopLoopInteraction } from "@/lib/desktop/desktop-loop-interactions";
import { POST } from "./route";

vi.mock("@/lib/desktop/desktop-loop-interactions", () => ({
  decideDesktopLoopInteraction: vi.fn(),
}));

const params = { params: Promise.resolve({ loopRunId: "loop_1", interactionId: "interaction_1" }) };

describe("Desktop Loop interaction decision route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an empty rejection reason before mutation", async () => {
    const response = await POST(new Request(
      "http://localhost/api/desktop/agents/loops/loop_1/interactions/interaction_1/decision?space=personal",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: "desktop:decision:1", expectedVersion: 3,
          decision: "rejected", reason: "", selectedEdgeId: "edge_rejected",
        }),
      },
    ), params);

    expect(response.status).toBe(400);
    expect(decideDesktopLoopInteraction).not.toHaveBeenCalled();
  });

  it("maps stale interaction decisions to conflict", async () => {
    vi.mocked(decideDesktopLoopInteraction).mockRejectedValue(
      Object.assign(new Error("Workflow interaction changed"), { code: "version_conflict" }),
    );
    const response = await POST(new Request(
      "http://localhost/api/desktop/agents/loops/loop_1/interactions/interaction_1/decision?space=personal",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: "desktop:decision:2", expectedVersion: 3,
          decision: "approved", reason: "Ready", selectedEdgeId: "edge_approved",
        }),
      },
    ), params);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "version_conflict" });
  });
});
