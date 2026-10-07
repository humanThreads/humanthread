import { prisma } from "../../../../../packages/db/src/index";
import type { LocalAgentPlatform } from "@humanthread/shared";
import type { WorkbenchDeviceStatus } from "./workbench-device-status";

export interface WorkbenchDeviceOverview {
  id: string;
  name: string;
  platform: LocalAgentPlatform;
  lastSeenAt: Date | null;
  status: WorkbenchDeviceStatus;
  authorizedAt: Date | null;
  revokedAt: Date | null;
  user: {
    id: string;
    name: string;
  };
}

export interface GetWorkbenchDevicesInput {
  teamId: string;
  db?: {
    localDevice: {
      findMany: typeof prisma.localDevice.findMany;
    };
  };
}

export async function getWorkbenchDevices(
  input: GetWorkbenchDevicesInput,
): Promise<WorkbenchDeviceOverview[]> {
  const db = input.db ?? prisma;

  const devices = await db.localDevice.findMany({
    where: {
      user: {
        teamId: input.teamId,
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

  return devices.map((device) => ({
    id: device.id,
    name: device.name,
    platform: device.platform as LocalAgentPlatform,
    lastSeenAt: device.lastSeenAt,
    status: device.status as WorkbenchDeviceStatus,
    authorizedAt: device.authorizedAt,
    revokedAt: device.revokedAt,
    user: {
      id: device.user.id,
      name: device.user.name,
    },
  }));
}
