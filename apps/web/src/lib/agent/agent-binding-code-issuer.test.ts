import { describe, expect, it, vi } from "vitest";
import { issueAgentBindingCode } from "./agent-binding-code-issuer";

describe("issueAgentBindingCode", () => {
  it("loads an active user and creates a binding code for that user's team", async () => {
    const loadUser = vi.fn().mockResolvedValue({
      id: "user_owner",
      teamId: "team_1",
      status: "active",
    });
    const createAgentBindingCode = vi.fn().mockReturnValue({
      code: "signed-binding-code",
      expiresAt: new Date("2026-05-20T00:10:00.000Z"),
    });

    const result = await issueAgentBindingCode(
      {
        userId: " user_owner ",
      },
      {
        loadUser,
        createAgentBindingCode,
      },
    );

    expect(loadUser).toHaveBeenCalledWith({
      userId: "user_owner",
    });
    expect(createAgentBindingCode).toHaveBeenCalledWith({
      userId: "user_owner",
      teamId: "team_1",
    });
    expect(result).toEqual({
      userId: "user_owner",
      teamId: "team_1",
      code: "signed-binding-code",
      expiresAt: new Date("2026-05-20T00:10:00.000Z"),
    });
  });

  it("loads an active user by normalized email when user id is not provided", async () => {
    const loadUser = vi.fn().mockResolvedValue({
      id: "user_owner",
      teamId: "team_1",
      status: "active",
    });
    const createAgentBindingCode = vi.fn().mockReturnValue({
      code: "signed-binding-code",
      expiresAt: new Date("2026-05-20T00:10:00.000Z"),
    });

    const result = await issueAgentBindingCode(
      {
        email: "  alice@example.com  ",
      },
      {
        loadUser,
        createAgentBindingCode,
      },
    );

    expect(loadUser).toHaveBeenCalledWith({
      email: "alice@example.com",
    });
    expect(result.userId).toBe("user_owner");
  });

  it("rejects missing or inactive users", async () => {
    await expect(
      issueAgentBindingCode(
        {
          userId: "user_owner",
        },
        {
          loadUser: vi.fn().mockResolvedValue(null),
          createAgentBindingCode: vi.fn(),
        },
      ),
    ).rejects.toThrow("Agent binding code user is unavailable");
  });
});
