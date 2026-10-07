import { describe, expect, it, vi } from "vitest";
import { getWorkbenchContext } from "./workbench-context";

describe("getWorkbenchContext", () => {
  it("resolves the current workbench user, team, project and matter type", async () => {
    const result = await getWorkbenchContext({
      selectedUserId: "user_runner",
      db: {
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: "user_runner",
            teamId: "team_alpha",
            status: "active",
          }),
          findFirst: vi.fn(),
        },
        project: {
          findFirst: vi.fn().mockResolvedValue({
            id: "project_thread",
          }),
        },
        matterType: {
          findFirst: vi.fn().mockResolvedValue({
            id: "matter_bugfix",
          }),
        },
      },
    });

    expect(result).toEqual({
      teamId: "team_alpha",
      userId: "user_runner",
      projectId: "project_thread",
      matterTypeId: "matter_bugfix",
    });
  });

  it("resolves the current workbench user from a login email", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: "user_owner",
      teamId: "team_1",
      status: "active",
    });

    const result = await getWorkbenchContext({
      selectedUserEmail: "  alice@example.com  ",
      db: {
        user: {
          findUnique: vi.fn(),
          findFirst,
        },
        project: {
          findFirst: vi.fn().mockResolvedValue({
            id: "project_1",
          }),
        },
        matterType: {
          findFirst: vi.fn().mockResolvedValue({
            id: "matter_dev",
          }),
        },
      },
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        email: "alice@example.com",
        status: "active",
      },
      select: {
        id: true,
        teamId: true,
        status: true,
      },
    });
    expect(result).toEqual({
      teamId: "team_1",
      userId: "user_owner",
      projectId: "project_1",
      matterTypeId: "matter_dev",
    });
  });

  it("prefers the selected user's personal project as the default workbench project", async () => {
    const projectFindFirst = vi.fn().mockResolvedValue({
      id: "project_user_alice_personal",
    });

    await getWorkbenchContext({
      selectedUserEmail: "alice@example.com",
      db: {
        user: {
          findUnique: vi.fn(),
          findFirst: vi.fn().mockResolvedValue({
            id: "user_alice",
            teamId: "team_1",
            status: "active",
          }),
        },
        project: {
          findFirst: projectFindFirst,
        },
        matterType: {
          findFirst: vi.fn().mockResolvedValue({
            id: "matter_dev",
          }),
        },
      },
    });

    expect(projectFindFirst).toHaveBeenCalledWith({
      where: {
        teamId: "team_1",
        AND: [expect.objectContaining({ OR: expect.any(Array) })],
      },
      orderBy: [
        {
          ownerType: "desc",
        },
        {
          createdAt: "asc",
        },
      ],
      select: {
        id: true,
      },
    });
  });

  it("can resolve the default project inside the selected company space", async () => {
    const projectFindFirst = vi.fn().mockResolvedValue({
      id: "project_company_1",
    });

    const result = await getWorkbenchContext({
      selectedUserEmail: "alice@example.com",
      companyId: "company_1",
      ownerType: "company",
      db: {
        user: {
          findUnique: vi.fn(),
          findFirst: vi.fn().mockResolvedValue({
            id: "user_alice",
            teamId: "team_1",
            status: "active",
          }),
        },
        project: {
          findFirst: projectFindFirst,
        },
        matterType: {
          findFirst: vi.fn().mockResolvedValue({
            id: "matter_dev",
          }),
        },
      },
    });

    expect(projectFindFirst).toHaveBeenCalledWith({
      where: {
        teamId: "team_1",
        AND: [expect.objectContaining({ AND: expect.any(Array) })],
      },
      orderBy: [
        {
          ownerType: "desc",
        },
        {
          createdAt: "asc",
        },
      ],
      select: {
        id: true,
      },
    });
    expect(result.projectId).toBe("project_company_1");
  });

  it("falls back to the earliest active user when no selected user id is provided", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: "user_owner",
      teamId: "team_1",
    });

    const result = await getWorkbenchContext({
      db: {
        user: {
          findUnique: vi.fn(),
          findFirst,
        },
        project: {
          findFirst: vi.fn().mockResolvedValue({
            id: "project_1",
          }),
        },
        matterType: {
          findFirst: vi.fn().mockResolvedValue({
            id: "matter_dev",
          }),
        },
      },
    });

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(result.userId).toBe("user_owner");
  });

  it("rejects when the selected workbench user does not exist or is inactive", async () => {
    await expect(
      getWorkbenchContext({
        selectedUserId: "user_missing",
        db: {
          user: {
            findUnique: vi.fn().mockResolvedValue(null),
            findFirst: vi.fn(),
          },
          project: {
            findFirst: vi.fn(),
          },
          matterType: {
            findFirst: vi.fn(),
          },
        },
      }),
    ).rejects.toThrow("Workbench user is unavailable");
  });

  it("rejects when no active workbench user exists", async () => {
    await expect(
      getWorkbenchContext({
        db: {
          user: {
            findUnique: vi.fn(),
            findFirst: vi.fn().mockResolvedValue(null),
          },
          project: {
            findFirst: vi.fn(),
          },
          matterType: {
            findFirst: vi.fn(),
          },
        },
      }),
    ).rejects.toThrow("No active workbench user found");
  });
});
