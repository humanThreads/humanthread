import { describe, expect, it, vi } from "vitest";
import { setWorkbenchDeviceAuthorization } from "./workbench-device-actions";

describe("setWorkbenchDeviceAuthorization", () => {
  it("authorizes a device and clears the revoke timestamp", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });

    await setWorkbenchDeviceAuthorization(
      {
        teamId: "team_1",
        deviceId: "device_mac_1",
        isAuthorized: true,
      },
      {
        updateMany,
      },
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "device_mac_1",
        user: {
          teamId: "team_1",
        },
      },
      data: {
        status: "authorized",
        authorizedAt: expect.any(Date),
        revokedAt: null,
      },
    });
  });

  it("revokes a device authorization", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });

    await setWorkbenchDeviceAuthorization(
      {
        teamId: "team_1",
        deviceId: "device_mac_1",
        isAuthorized: false,
      },
      {
        updateMany,
      },
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "device_mac_1",
        user: {
          teamId: "team_1",
        },
      },
      data: {
        status: "revoked",
        authorizedAt: null,
        revokedAt: expect.any(Date),
      },
    });
  });

  it("rejects authorization when the device is outside the current team", async () => {
    await expect(
      setWorkbenchDeviceAuthorization(
        {
          teamId: "team_1",
          deviceId: "device_other_team",
          isAuthorized: true,
        },
        {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      ),
    ).rejects.toThrow("Device is unavailable for the current workbench team");
  });
});
