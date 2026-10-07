import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirmRequirement } from "@/lib/orchestration/workflow-interaction-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@/lib/orchestration/workflow-interaction-commands", () => ({ confirmRequirement: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ loopRunId: "loop:run_1", interactionId: "interaction_1" }) };

describe("POST /api/loop-runs/:loopRunId/interactions/:interactionId/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    vi.mocked(confirmRequirement).mockResolvedValue({ interactionId: "interaction_1", status: "confirmed", version: 4, nodeVersion: 7, loopRunVersion: 9, loopRunProjectionVersion: 13 });
  });

  it("confirms using the current session actor and exact expected version", async () => {
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ commandId: "cmd_confirm", expectedVersion: 3, reason: "确定" }) }), context);

    expect(response.status).toBe(200);
    expect(confirmRequirement).toHaveBeenCalledWith(expect.objectContaining({ interactionId: "interaction_1", expectedLoopRunId: "loop:run_1", actorUserId: "user_1", expectedVersion: 3 }));
  });
});
