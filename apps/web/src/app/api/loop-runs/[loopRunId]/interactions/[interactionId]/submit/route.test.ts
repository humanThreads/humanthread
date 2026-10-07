import { beforeEach, describe, expect, it, vi } from "vitest";

import { submitWorkflowIntervention } from "@/lib/orchestration/workflow-interaction-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@/lib/orchestration/workflow-interaction-commands", () => ({ submitWorkflowIntervention: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ loopRunId: "loop:run_1", interactionId: "interaction_1" }) };

describe("POST workflow intervention submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_assignee", authKind: "web_session", webSessionId: "a".repeat(32) });
    vi.mocked(submitWorkflowIntervention).mockResolvedValue({ interactionId: "interaction_1", status: "confirmed", version: 2, recovered: true });
  });

  it("submits one structured resolution action as the current session user", async () => {
    const response = await POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({
        commandId: "submit:1",
        expectedVersion: 1,
        reason: "依赖已补齐",
        action: { type: "resume_checkpoint" },
      }),
    }), context);

    expect(response.status).toBe(200);
    expect(submitWorkflowIntervention).toHaveBeenCalledWith(expect.objectContaining({
      interactionId: "interaction_1",
      expectedLoopRunId: "loop:run_1",
      actorUserId: "user_assignee",
      expectedVersion: 1,
      action: { type: "resume_checkpoint" },
    }));
  });

  it("rejects an invalid recovery action", async () => {
    const response = await POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ commandId: "submit:invalid", expectedVersion: 1, reason: "继续", action: { type: "retry_anyway" } }),
    }), context);
    expect(response.status).toBe(400);
    expect(submitWorkflowIntervention).not.toHaveBeenCalled();
  });
});
