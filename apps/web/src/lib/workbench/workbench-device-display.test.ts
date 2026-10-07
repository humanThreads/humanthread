import { describe, expect, it } from "vitest";
import {
  getWorkbenchDeviceAuthorizationActionLabel,
  getWorkbenchDeviceAuthorizationPrompt,
  orderWorkbenchDevicesForDisplay,
} from "./workbench-device-display";
import type { WorkbenchDeviceOverview } from "./workbench-devices";

function device(
  input: Pick<WorkbenchDeviceOverview, "id" | "status" | "lastSeenAt">,
): WorkbenchDeviceOverview {
  return {
    id: input.id,
    name: input.id,
    platform: "macos",
    lastSeenAt: input.lastSeenAt,
    status: input.status,
    authorizedAt: null,
    revokedAt: null,
    user: {
      id: "user_owner",
      name: "alice",
    },
  };
}

describe("orderWorkbenchDevicesForDisplay", () => {
  it("shows pending devices before already authorized devices", () => {
    const result = orderWorkbenchDevicesForDisplay([
      device({
        id: "device_authorized_recent",
        status: "authorized",
        lastSeenAt: new Date("2026-05-20T01:00:00.000Z"),
      }),
      device({
        id: "device_pending_old",
        status: "pending",
        lastSeenAt: new Date("2026-05-19T01:00:00.000Z"),
      }),
      device({
        id: "device_revoked",
        status: "revoked",
        lastSeenAt: new Date("2026-05-20T02:00:00.000Z"),
      }),
    ]);

    expect(result.map((item) => item.id)).toEqual([
      "device_pending_old",
      "device_authorized_recent",
      "device_revoked",
    ]);
  });

  it("uses explicit authorization copy for pending and authorized devices", () => {
    expect(getWorkbenchDeviceAuthorizationActionLabel("pending")).toBe("授权设备");
    expect(getWorkbenchDeviceAuthorizationActionLabel("authorized")).toBe("撤销授权");
    expect(
      getWorkbenchDeviceAuthorizationPrompt(
        device({
          id: "device-agent-macbook",
          status: "pending",
          lastSeenAt: null,
        }),
      ),
    ).toContain("确认设备 ID device-agent-macbook");
  });
});
