import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirmLatestWorkflowPosition } from "@/lib/orchestration/workflow-interaction-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@/lib/orchestration/workflow-interaction-commands", () => ({ confirmLatestWorkflowPosition: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ loopRunId: "loop:run_1", interactionId: "interaction_1" }) };

describe("POST workflow speaker confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_a", authKind: "web_session", webSessionId: "a".repeat(32) });
    vi.mocked(confirmLatestWorkflowPosition).mockResolvedValue({ interactionId: "interaction_1", messageId: "message_2", sequence: 2, version: 1 });
  });

  it("confirms the current session user's latest position without expectedVersion", async () => {
    const response = await POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ commandId: "confirm:user_a:1" }),
    }), context);

    expect(response.status).toBe(200);
    expect(confirmLatestWorkflowPosition).toHaveBeenCalledWith(expect.objectContaining({
      interactionId: "interaction_1",
      expectedLoopRunId: "loop:run_1",
      actorUserId: "user_a",
      commandId: "confirm:user_a:1",
    }));
    expect(vi.mocked(confirmLatestWorkflowPosition).mock.calls[0]?.[0]).not.toHaveProperty("expectedVersion");
  });
});
