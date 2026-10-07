import { describe, expect, it, vi } from "vitest";
import {
  authenticateWorkbenchUser,
  createPasswordHash,
  verifyPasswordHash,
} from "./workbench-auth";

describe("workbench account authentication", () => {
  it("creates and verifies a password hash without storing the raw password", () => {
    const hash = createPasswordHash("correct-password", {
      salt: "fixed-salt-for-test",
      iterations: 1000,
    });

    expect(hash).not.toContain("correct-password");
    expect(verifyPasswordHash({ password: "correct-password", passwordHash: hash }))
      .toBe(true);
    expect(verifyPasswordHash({ password: "wrong-password", passwordHash: hash }))
      .toBe(false);
  });

  it("authenticates an active user by email and password", async () => {
    const passwordHash = createPasswordHash("correct-password", {
      salt: "fixed-salt-for-test",
      iterations: 1000,
    });
    const findFirst = vi.fn().mockResolvedValue({
      id: "user_owner",
      email: "alice@example.com",
      status: "active",
      passwordHash,
    });

    const user = await authenticateWorkbenchUser({
      email: "  alice@example.com ",
      password: " correct-password ",
      db: {
        user: {
          findFirst,
        },
      },
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        email: "alice@example.com",
      },
      select: {
        id: true,
        email: true,
        status: true,
        passwordHash: true,
      },
    });
    expect(user).toEqual({
      id: "user_owner",
      email: "alice@example.com",
    });
  });

  it("rejects invalid workbench credentials", async () => {
    const passwordHash = createPasswordHash("correct-password", {
      salt: "fixed-salt-for-test",
      iterations: 1000,
    });

    await expect(
      authenticateWorkbenchUser({
        email: "alice@example.com",
        password: "wrong-password",
        db: {
          user: {
            findFirst: vi.fn().mockResolvedValue({
              id: "user_owner",
              email: "alice@example.com",
              status: "active",
              passwordHash,
            }),
          },
        },
      }),
    ).rejects.toThrow("Workbench login credentials are invalid");
  });
});
