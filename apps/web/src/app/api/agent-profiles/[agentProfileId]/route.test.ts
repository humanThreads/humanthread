import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveWorkbenchApiActor: vi.fn(),
  setSpaceAgentProfileStatus: vi.fn(),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: mocks.resolveWorkbenchApiActor,
}));
vi.mock("@/lib/orchestration/agent-profile-commands", () => ({
  setSpaceAgentProfileStatus: mocks.setSpaceAgentProfileStatus,
}));

import { PATCH } from "./route";

const context = { params: Promise.resolve({ agentProfileId: "a".repeat(32) }) };

function request(body: unknown): Request {
  return new Request(`http://localhost/api/agent-profiles/${"a".repeat(32)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/agent-profiles/:agentProfileId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveWorkbenchApiActor.mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "session_1" });
  });

  it("updates the logical Agent Profile status", async () => {
    mocks.setSpaceAgentProfileStatus.mockResolvedValue({ id: "a".repeat(32), status: "disabled" });

    const response = await PATCH(request({ commandId: "disable-profile-1", status: "disabled" }), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, result: { status: "disabled" } });
    expect(mocks.setSpaceAgentProfileStatus).toHaveBeenCalledWith({
      actorUserId: "user_1",
      commandId: "disable-profile-1",
      agentProfileId: "a".repeat(32),
      status: "disabled",
    });
  });

  it("returns not found for a deleted profile", async () => {
    mocks.setSpaceAgentProfileStatus.mockRejectedValue(Object.assign(new Error("missing"), { code: "not_found" }));

    const response = await PATCH(request({ commandId: "disable-profile-1", status: "disabled" }), context);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, code: "not_found" });
  });
});
