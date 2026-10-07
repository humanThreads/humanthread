import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  list: vi.fn(),
  issue: vi.fn(),
  issueViewer: vi.fn(),
}));

vi.mock("../../../../../lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: mocks.actor,
}));

vi.mock("../../../../../lib/live-session/live-session-store", () => ({
  getLiveSessionControl: () => ({ list: mocks.list }),
  issueLiveSessionControlTicket: mocks.issue,
  issueLiveSessionViewerTicket: mocks.issueViewer,
}));

import { POST } from "./route";

describe("live session ticket API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "web_1" });
    mocks.list.mockResolvedValue([{ id: "a".repeat(32) }]);
    mocks.issue.mockReturnValue({ token: "lst1.payload.signature", expiresAt: new Date("2026-09-24T00:01:00.000Z") });
    mocks.issueViewer.mockReturnValue({ token: "lst1.viewer.signature", expiresAt: new Date("2026-09-24T00:01:00.000Z") });
  });

  it("issues a control ticket only for the owner's active session", async () => {
    const response = await POST(new Request("http://localhost/api/live-sessions/ticket", { method: "POST" }), {
      params: Promise.resolve({ sessionId: "a".repeat(32) }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, result: { ticket: { token: "lst1.payload.signature" } } });
    expect(mocks.issue).toHaveBeenCalledWith({ sessionId: "a".repeat(32) });
  });

  it("issues a viewer ticket when the owner explicitly asks to observe", async () => {
    const response = await POST(new Request("http://localhost/api/live-sessions/ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "viewer" }),
    }), {
      params: Promise.resolve({ sessionId: "a".repeat(32) }),
    });

    expect(response.status).toBe(200);
    expect(mocks.issueViewer).toHaveBeenCalledWith({ sessionId: "a".repeat(32) });
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("does not issue a viewer ticket for a session the actor cannot list", async () => {
    mocks.list.mockResolvedValue([]);
    const response = await POST(new Request("http://localhost/api/live-sessions/ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "viewer" }),
    }), {
      params: Promise.resolve({ sessionId: "b".repeat(32) }),
    });

    expect(response.status).toBe(404);
    expect(mocks.issueViewer).not.toHaveBeenCalled();
  });

  it("returns 404 for an ended or foreign session", async () => {
    mocks.list.mockResolvedValue([]);
    const response = await POST(new Request("http://localhost/api/live-sessions/ticket", { method: "POST" }), {
      params: Promise.resolve({ sessionId: "b".repeat(32) }),
    });

    expect(response.status).toBe(404);
    expect(mocks.issue).not.toHaveBeenCalled();
  });
});
