import { prisma } from "../../../../../packages/db/src/index";

interface WorkbenchNotificationStateDb {
  workbenchNotificationRead: {
    findMany: typeof prisma.workbenchNotificationRead.findMany;
    upsert: typeof prisma.workbenchNotificationRead.upsert;
  };
}

export async function getReadWorkbenchNotificationIds(input: {
  userId: string;
  notificationIds: string[];
  db?: WorkbenchNotificationStateDb;
}): Promise<Set<string>> {
  const normalizedIds = Array.from(
    new Set(input.notificationIds.map((value) => value.trim()).filter(Boolean)),
  );

  if (normalizedIds.length === 0) {
    return new Set();
  }

  const rows = await (input.db ?? prisma).workbenchNotificationRead.findMany({
    where: {
      userId: input.userId,
      notificationId: {
        in: normalizedIds,
      },
    },
    select: {
      notificationId: true,
    },
  });

  return new Set(rows.map((row) => row.notificationId));
}

export async function markWorkbenchNotificationRead(input: {
  userId: string;
  notificationId: string;
  db?: WorkbenchNotificationStateDb;
}): Promise<void> {
  const notificationId = input.notificationId.trim();

  if (!notificationId) {
    return;
  }

  await (input.db ?? prisma).workbenchNotificationRead.upsert({
    where: {
      userId_notificationId: {
        userId: input.userId,
        notificationId,
      },
    },
    update: {
      readAt: new Date(),
    },
    create: {
      id: `${input.userId}:${notificationId}`.slice(0, 128),
      userId: input.userId,
      notificationId,
      readAt: new Date(),
    },
  });
}
