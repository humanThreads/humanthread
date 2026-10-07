import { beforeEach, describe, expect, it, vi } from "vitest";

import { appendDesktopLoopInteractionMessage } from "@/lib/desktop/desktop-loop-interactions";
import { OPTIONS, POST } from "./route";

vi.mock("@/lib/desktop/desktop-loop-interactions", () => ({
  appendDesktopLoopInteractionMessage: vi.fn(),
}));

const params = { params: Promise.resolve({ loopRunId: "loop_1", interactionId: "interaction_1" }) };

describe("Desktop Loop interaction message route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("appends a message through the Desktop facade", async () => {
    vi.mocked(appendDesktopLoopInteractionMessage).mockResolvedValue({
      id: "interaction_1", status: "open", version: 4,
    });
    const response = await POST(new Request(
      "http://localhost/api/desktop/agents/loops/loop_1/interactions/interaction_1/messages?space=personal",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: "desktop:message:1",
          message: { body: "Use A", answers: {}, attachmentIds: [], mentionedUserIds: [] },
        }),
      },
    ), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: { id: "interaction_1", status: "open", version: 4 },
    });
    expect(vi.mocked(appendDesktopLoopInteractionMessage).mock.calls[0]?.[3]).not.toHaveProperty("expectedVersion");
  });

  it("supports Desktop CORS preflight", () => {
    const response = OPTIONS(new Request("http://localhost/api/desktop/agents/loops/loop_1/interactions/interaction_1/messages", {
      method: "OPTIONS",
      headers: { origin: "tauri://localhost" },
    }));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });
});
