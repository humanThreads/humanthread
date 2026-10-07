import { beforeEach, describe, expect, it, vi } from "vitest";

import { delegateWorkflowConflictSpeaker } from "@/lib/orchestration/workflow-interaction-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@/lib/orchestration/workflow-interaction-commands", () => ({ delegateWorkflowConflictSpeaker: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ loopRunId: "loop:run_1", interactionId: "interaction_1" }) };

describe("POST workflow conflict speaker delegation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "project_owner", authKind: "web_session", webSessionId: "a".repeat(32) });
    vi.mocked(delegateWorkflowConflictSpeaker).mockResolvedValue({
      interactionId: "interaction_1",
      version: 3,
      activeSpeakerKey: "4694a77b445ce31a90944f1c773e24c3",
    });
  });

  it("delegates to one participant as the current session user", async () => {
    const response = await POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({
        commandId: "delegate:user_a",
        expectedVersion: 2,
        speakerUserId: "user_a",
      }),
    }), context);

    expect(response.status).toBe(200);
    expect(delegateWorkflowConflictSpeaker).toHaveBeenCalledWith(expect.objectContaining({
      interactionId: "interaction_1",
      expectedLoopRunId: "loop:run_1",
      actorUserId: "project_owner",
      expectedVersion: 2,
      speakerUserId: "user_a",
    }));
  });

  it("rejects a missing participant identity", async () => {
    const response = await POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ commandId: "delegate:invalid", expectedVersion: 2, speakerUserId: "" }),
    }), context);

    expect(response.status).toBe(400);
    expect(delegateWorkflowConflictSpeaker).not.toHaveBeenCalled();
  });
});
