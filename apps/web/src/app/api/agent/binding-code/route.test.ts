import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { resolveWorkbenchSession } from "../../../../lib/workbench/workbench-session";
import { issueAgentBindingCode } from "../../../../lib/agent/agent-binding-code-issuer";

const cookieGet = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: cookieGet }),
}));
vi.mock("../../../../lib/workbench/workbench-session", () => ({
  resolveWorkbenchSession: vi.fn(),
}));
vi.mock("../../../../lib/agent/agent-binding-code-issuer", () => ({
  issueAgentBindingCode: vi.fn().mockResolvedValue({
    userId: "user_owner",
    teamId: "team_1",
    code: "binding-code",
    expiresAt: new Date("2026-08-12T00:10:00.000Z"),
  }),
}));

function request(body: Record<string, unknown> = {}) {
  return new Request("http://localhost:3000/api/agent/binding-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agent/binding-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchSession).mockResolvedValue({
      loginEmail: "owner@example.com",
      selectedUserId: null,
      webSessionId: "a".repeat(32),
      context: { teamId: "team_1", userId: "user_owner", projectId: "project_1", matterTypeId: "matter_dev" },
    });
  });

  it("issues a binding code for the database Web session owner", async () => {
    const response = await POST(request({ userId: "user_attacker" }));
    expect(response.status).toBe(200);
    expect(issueAgentBindingCode).toHaveBeenCalledWith({ userId: "user_owner" });
  });

  it("rejects requests whose Web token does not resolve", async () => {
    vi.mocked(resolveWorkbenchSession).mockResolvedValueOnce({
      loginEmail: null,
      selectedUserId: null,
      webSessionId: null,
      context: { teamId: "team_1", userId: "default", projectId: "project_1", matterTypeId: "matter_dev" },
    });
    const response = await POST(request({ userId: "user_owner" }));
    expect(response.status).toBe(401);
    expect(issueAgentBindingCode).not.toHaveBeenCalled();
  });

  it.each(["ht_workbench_session", "ht_workbench_login_email", "ht_workbench_user_id"])(
    "does not grant access from legacy cookie %s",
    async (name) => {
      cookieGet.mockImplementation((candidate: string) => candidate === name ? { value: "legacy" } : undefined);
      vi.mocked(resolveWorkbenchSession).mockResolvedValueOnce({
        loginEmail: null,
        selectedUserId: null,
        webSessionId: null,
        context: { teamId: "team_1", userId: "default", projectId: "project_1", matterTypeId: "matter_dev" },
      });
      expect((await POST(request())).status).toBe(401);
    },
  );
});
