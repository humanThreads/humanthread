import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveWorkbenchApiActor: vi.fn(),
  createSpaceAgentProfile: vi.fn(),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: mocks.resolveWorkbenchApiActor,
}));
vi.mock("@/lib/orchestration/agent-profile-commands", () => ({
  createSpaceAgentProfile: mocks.createSpaceAgentProfile,
}));

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/agent-profiles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agent-profiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveWorkbenchApiActor.mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "session_1" });
  });

  it("creates an active Space Agent Profile", async () => {
    mocks.createSpaceAgentProfile.mockResolvedValue({
      id: "a".repeat(32),
      spaceId: "space_1",
      name: "Gelsang Codex",
      provider: "codex",
      status: "active",
      model: "gpt-5.6-terra",
    });

    const response = await POST(request({
      commandId: "create-profile-1",
      spaceId: "space_1",
      name: "Gelsang Codex",
      provider: "codex",
      model: "gpt-5.6-terra",
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true, result: { name: "Gelsang Codex" } });
    expect(mocks.createSpaceAgentProfile).toHaveBeenCalledWith({
      actorUserId: "user_1",
      commandId: "create-profile-1",
      spaceId: "space_1",
      name: "Gelsang Codex",
      provider: "codex",
      model: "gpt-5.6-terra",
    });
  });

  it("rejects invalid provider input", async () => {
    const response = await POST(request({
      commandId: "create-profile-1",
      spaceId: "space_1",
      name: "Gelsang Codex",
      provider: "openai",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, code: "validation_failed" });
    expect(mocks.createSpaceAgentProfile).not.toHaveBeenCalled();
  });

  it("maps management permission failures to 403", async () => {
    mocks.createSpaceAgentProfile.mockRejectedValue(Object.assign(new Error("denied"), { code: "authorization_denied" }));

    const response = await POST(request({
      commandId: "create-profile-1",
      spaceId: "space_1",
      name: "Gelsang Codex",
      provider: "codex",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, code: "authorization_denied" });
  });
});
