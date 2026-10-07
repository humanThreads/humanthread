export interface SetWorkbenchDeviceAuthorizationInput {
  teamId: string;
  deviceId: string;
  isAuthorized: boolean;
}

interface SetWorkbenchDeviceAuthorizationDependencies {
  updateMany: (input: {
    where: {
      id: string;
      user: {
        teamId: string;
      };
    };
    data: {
      status: "authorized" | "revoked";
      authorizedAt?: Date | null;
      revokedAt?: Date | null;
    };
  }) => Promise<{ count: number }>;
}

export async function setWorkbenchDeviceAuthorization(
  input: SetWorkbenchDeviceAuthorizationInput,
  dependencies: SetWorkbenchDeviceAuthorizationDependencies = {
    updateMany: async ({ where, data }) => {
      const { prisma } = await import("../../../../../packages/db/src/index");

      return prisma.localDevice.updateMany({
        where,
        data,
      });
    },
  },
): Promise<void> {
  const result = await dependencies.updateMany({
    where: {
      id: input.deviceId,
      user: {
        teamId: input.teamId,
      },
    },
    data: input.isAuthorized
      ? {
          status: "authorized",
          authorizedAt: new Date(),
          revokedAt: null,
        }
      : {
          status: "revoked",
          authorizedAt: null,
          revokedAt: new Date(),
        },
  });

  if (result.count === 0) {
    throw new Error("Device is unavailable for the current workbench team");
  }
}
