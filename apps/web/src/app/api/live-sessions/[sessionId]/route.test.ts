import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  close: vi.fn(),
}));

vi.mock("../../../../lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: mocks.actor,
}));

vi.mock("../../../../lib/live-session/live-session-store", () => ({
  getLiveSessionControl: () => ({ close: mocks.close }),
}));

import { DELETE } from "./route";

describe("live session detail API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockResolvedValue({ userId: "user_1", authKind: "desktop_token", sessionId: "desktop_1" });
  });

  it("returns 404 when the session is absent or belongs to another user", async () => {
    mocks.close.mockRejectedValue(Object.assign(new Error("Live session was not found"), { code: "live_session_not_found" }));
    const response = await DELETE(new Request("http://localhost/api/live-sessions/missing", { method: "DELETE" }), {
      params: Promise.resolve({ sessionId: "c".repeat(32) }),
    });

    expect(response.status).toBe(404);
    expect(mocks.close).toHaveBeenCalledWith({ userId: "user_1" }, "c".repeat(32));
  });
});
