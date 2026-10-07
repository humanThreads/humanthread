import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirmDesktopLoopInteraction } from "@/lib/desktop/desktop-loop-interactions";
import { POST } from "./route";

vi.mock("@/lib/desktop/desktop-loop-interactions", () => ({
  confirmDesktopLoopInteraction: vi.fn(),
}));

const params = { params: Promise.resolve({ loopRunId: "loop_1", interactionId: "interaction_1" }) };

describe("Desktop Loop interaction confirm route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirms an open requirement interaction", async () => {
    vi.mocked(confirmDesktopLoopInteraction).mockResolvedValue({
      id: "interaction_1", status: "confirmed", version: 4,
    });
    const response = await POST(new Request(
      "http://localhost/api/desktop/agents/loops/loop_1/interactions/interaction_1/confirm?space=personal",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: "desktop:confirm:1", expectedVersion: 3, reason: "Confirmed" }),
      },
    ), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { status: "confirmed", version: 4 } });
  });
});
