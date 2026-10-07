import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
}));

vi.mock("../../../lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: mocks.actor,
}));

vi.mock("../../../lib/live-session/live-session-store", () => ({
  getLiveSessionControl: () => ({ create: mocks.create, list: mocks.list }),
}));

import { GET, POST } from "./route";

describe("live session collection API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "web_1" });
    mocks.list.mockResolvedValue([]);
    mocks.create.mockResolvedValue({
      session: { id: "a".repeat(32) },
      ticket: { token: "lst1.payload.signature", expiresAt: new Date("2026-09-24T00:01:00.000Z") },
    });
  });

  it("rejects an unauthenticated request before invoking the control plane", async () => {
    mocks.actor.mockRejectedValue(new Error("Workbench API authentication required"));
    const response = await GET(new Request("http://localhost/api/live-sessions"));

    expect(response.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("passes the authenticated actor into session creation", async () => {
    const response = await POST(new Request("http://localhost/api/live-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "b".repeat(32),
        kind: "agent",
        surface: "web",
        spaceId: "space_company",
        projectId: null,
        taskId: null,
        executionPolicy: "direct",
        target: { type: "agent_device", deviceId: "device_1" },
        initialCols: 120,
        initialRows: 36,
      }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ kind: "agent" }), { userId: "user_1" });
  });
});
