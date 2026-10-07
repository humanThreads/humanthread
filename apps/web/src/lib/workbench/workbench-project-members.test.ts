import { describe, expect, it, vi } from "vitest";
import { getProjectMemberView } from "./workbench-project-members";

describe("getProjectMemberView", () => {
  it("returns only active membership facts for an accessible Project", async () => {
    const joinedAt = new Date("2026-07-01T08:00:00.000Z");
    const lastSeenAt = new Date("2026-07-29T02:00:00.000Z");
    const findFirst = vi.fn().mockResolvedValue({
      id: "project_1",
      name: "交付中心",
      members: [{
        id: "member_1",
        role: "manager",
        status: "active",
        createdAt: joinedAt,
        user: { id: "user_1", name: "项目经理", email: "manager@example.com", lastSeenAt },
      }],
    });

    const result = await getProjectMemberView({
      projectId: "project_1",
      userId: "viewer_1",
      db: { project: { findFirst } },
    });

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "project_1", AND: expect.any(Array) }),
      select: expect.objectContaining({
        members: expect.objectContaining({ where: { status: "active" } }),
      }),
    }));
    expect(result).toEqual({
      project: { id: "project_1", name: "交付中心" },
      members: [{
        id: "member_1",
        role: "manager",
        joinedAt,
        user: { id: "user_1", name: "项目经理", email: "manager@example.com", lastSeenAt },
      }],
    });
  });

  it("returns null when the Project is outside the accessible scope", async () => {
    await expect(getProjectMemberView({
      projectId: "hidden",
      userId: "viewer_1",
      db: { project: { findFirst: vi.fn().mockResolvedValue(null) } },
    })).resolves.toBeNull();
  });
});
