import { describe, expect, it, vi } from "vitest";
import { getWorkbenchDevices } from "./workbench-devices";

describe("getWorkbenchDevices", () => {
  it("loads devices for a team ordered by last heartbeat", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "device_mac_1",
        name: "agent-macbook",
        platform: "macos",
        lastSeenAt: new Date("2026-05-19T10:00:00.000Z"),
        status: "authorized",
        authorizedAt: new Date("2026-05-19T09:30:00.000Z"),
        revokedAt: null,
        user: {
          id: "user_owner",
          name: "alice",
        },
      },
      {
        id: "device_web_fallback",
        name: "web-workbench",
        platform: "web",
        lastSeenAt: new Date("2026-05-19T09:58:00.000Z"),
        status: "pending",
        authorizedAt: null,
        revokedAt: null,
        user: {
          id: "user_owner",
          name: "alice",
        },
      },
    ]);

    const result = await getWorkbenchDevices({
      teamId: "team_1",
      db: {
        localDevice: {
          findMany,
        },
      },
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        user: {
          teamId: "team_1",
        },
      },
      orderBy: [{ lastSeenAt: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        platform: true,
        lastSeenAt: true,
        status: true,
        authorizedAt: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    expect(result).toEqual([
      {
        id: "device_mac_1",
        name: "agent-macbook",
        platform: "macos",
        lastSeenAt: new Date("2026-05-19T10:00:00.000Z"),
        status: "authorized",
        authorizedAt: new Date("2026-05-19T09:30:00.000Z"),
        revokedAt: null,
        user: {
          id: "user_owner",
          name: "alice",
        },
      },
      {
        id: "device_web_fallback",
        name: "web-workbench",
        platform: "web",
        lastSeenAt: new Date("2026-05-19T09:58:00.000Z"),
        status: "pending",
        authorizedAt: null,
        revokedAt: null,
        user: {
          id: "user_owner",
          name: "alice",
        },
      },
    ]);
  });
});
