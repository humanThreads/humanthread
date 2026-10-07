import { describe, expect, it, vi } from "vitest";

import {
  appendDesktopLoopInteractionMessage,
  confirmDesktopLoopInteraction,
  decideDesktopLoopInteraction,
} from "./desktop-loop-interactions";

const request = new Request(
  "http://localhost/api/desktop/agents/loops/loop_1/interactions/interaction_1/messages?space=company:company_1",
);

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    resolveDesktopReadContext: vi.fn().mockResolvedValue({
      actor: { userId: "user_1" },
      space: { id: "space_1" },
    }),
    findInteractionScope: vi.fn().mockResolvedValue({
      loopRunId: "loop_1",
      spaceId: "space_1",
    }),
    appendRequirementMessage: vi.fn().mockResolvedValue({
      interactionId: "interaction_1", messageId: "message_1", sequence: 3, version: 4,
    }),
    confirmRequirement: vi.fn().mockResolvedValue({
      interactionId: "interaction_1", status: "confirmed", version: 4,
      nodeVersion: 3, loopRunVersion: 8, loopRunProjectionVersion: 9,
    }),
    decideWorkflowInteraction: vi.fn().mockResolvedValue({
      interactionId: "interaction_1", status: "approved", version: 4,
      selectedEdgeId: "edge_approved", routed: {},
    }),
    ...overrides,
  };
}

describe("Desktop Loop interaction facade", () => {
  it("checks selected Space before appending a message and forwards the Desktop actor", async () => {
    const deps = dependencies();
    const result = await appendDesktopLoopInteractionMessage(
      request,
      "loop_1",
      "interaction_1",
      {
        commandId: "desktop:message:1",
        message: { body: "Use A", answers: {}, attachmentIds: [], mentionedUserIds: [] },
      },
      deps,
    );

    expect(deps.appendRequirementMessage).toHaveBeenCalledWith(expect.objectContaining({
      interactionId: "interaction_1",
      expectedLoopRunId: "loop_1",
      actor: { type: "user", id: "user_1" },
      actorUserId: "user_1",
      commandId: "desktop:message:1",
    }));
    expect(deps.appendRequirementMessage.mock.calls[0]?.[0]).not.toHaveProperty("expectedVersion");
    expect(result).toEqual({ id: "interaction_1", status: "open", version: 4 });
  });

  it("conceals cross-Space and route-mismatched interactions before mutation", async () => {
    const crossSpace = dependencies({
      findInteractionScope: vi.fn().mockResolvedValue({ loopRunId: "loop_1", spaceId: "space_other" }),
    });
    await expect(confirmDesktopLoopInteraction(
      request,
      "loop_1",
      "interaction_1",
      { commandId: "desktop:confirm:1", expectedVersion: 3, reason: "Confirmed" },
      crossSpace,
    )).rejects.toMatchObject({ code: "not_found" });
    expect(crossSpace.confirmRequirement).not.toHaveBeenCalled();

    const wrongRun = dependencies({
      findInteractionScope: vi.fn().mockResolvedValue({ loopRunId: "loop_other", spaceId: "space_1" }),
    });
    await expect(confirmDesktopLoopInteraction(
      request,
      "loop_1",
      "interaction_1",
      { commandId: "desktop:confirm:2", expectedVersion: 3, reason: "Confirmed" },
      wrongRun,
    )).rejects.toMatchObject({ code: "not_found" });
    expect(wrongRun.confirmRequirement).not.toHaveBeenCalled();
  });

  it("forwards approval decisions and returns a bounded mutation result", async () => {
    const deps = dependencies();
    const result = await decideDesktopLoopInteraction(
      request,
      "loop_1",
      "interaction_1",
      {
        commandId: "desktop:decision:1",
        expectedVersion: 3,
        decision: "approved",
        reason: "Ready",
        selectedEdgeId: "edge_approved",
      },
      deps,
    );

    expect(deps.decideWorkflowInteraction).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_1",
      expectedLoopRunId: "loop_1",
      selectedEdgeId: "edge_approved",
    }));
    expect(result).toEqual({ id: "interaction_1", status: "approved", version: 4 });
  });
});
