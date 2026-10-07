import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "./prisma";

export type ToolSessionStatus = "active" | "completed" | "interrupted";

export interface ToolSessionRecord {
  id: string;
  taskId: string;
  localDeviceId: string;
  sessionType: string;
  sessionName: string;
  status: ToolSessionStatus | string;
  lastOutputSummary: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BuildToolSessionIdInput {
  taskId: string;
  localDeviceId: string;
  sessionName: string;
}

export interface BuildToolSessionNameInput {
  taskId: string;
  localDeviceId: string;
}

export interface ToolSessionPersistenceTx {
  toolSession: {
    findFirst?(args: unknown): Promise<ToolSessionRecord | null>;
    findUnique?(args: unknown): Promise<ToolSessionRecord | null>;
    create(args: unknown): Promise<ToolSessionRecord>;
    update(args: unknown): Promise<ToolSessionRecord>;
  };
}

export interface ToolSessionPersistenceDb {
  $transaction<T>(
    callback: (tx: ToolSessionPersistenceTx) => Promise<T>,
  ): Promise<T>;
}

function normalizeSessionPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function buildToolSessionName(
  input: BuildToolSessionNameInput,
): string {
  return `ht-${normalizeSessionPart(input.taskId)}-${normalizeSessionPart(input.localDeviceId)}`;
}

export function buildToolSessionId(input: BuildToolSessionIdInput): string {
  const hash = createHash("sha256")
    .update(`${input.taskId}::${input.localDeviceId}::${input.sessionName}`)
    .digest("hex")
    .slice(0, 24);

  return `tool_session_${hash}`;
}

function resolveToolSessionLookup(
  tx: ToolSessionPersistenceTx,
  input: {
    taskId: string;
    localDeviceId: string;
    sessionName?: string;
  },
): Promise<ToolSessionRecord | null> {
  const where = {
    taskId: input.taskId,
    localDeviceId: input.localDeviceId,
    ...(input.sessionName ? { sessionName: input.sessionName } : {}),
  };

  if (tx.toolSession.findFirst) {
    return tx.toolSession.findFirst({
      where,
      orderBy: [
        {
          updatedAt: "desc",
        },
        {
          createdAt: "desc",
        },
      ],
    });
  }

  if (tx.toolSession.findUnique) {
    return tx.toolSession.findUnique({
      where,
    });
  }

  return Promise.resolve(null);
}

async function persistToolSession(
  input: {
    db: ToolSessionPersistenceDb;
    taskId: string;
    localDeviceId: string;
    sessionName: string;
    sessionType: string;
    status: ToolSessionStatus;
    lastOutputSummary?: string | null;
    now: Date;
  },
): Promise<ToolSessionRecord> {
  return input.db.$transaction(async (tx) => {
    const existing = await resolveToolSessionLookup(tx, {
      taskId: input.taskId,
      localDeviceId: input.localDeviceId,
      sessionName: input.sessionName,
    });

    const payload = {
      taskId: input.taskId,
      localDeviceId: input.localDeviceId,
      sessionType: input.sessionType,
      sessionName: input.sessionName,
      status: input.status,
      lastOutputSummary: input.lastOutputSummary ?? null,
      updatedAt: input.now,
    };

    if (existing) {
      return tx.toolSession.update({
        where: { id: existing.id },
        data: payload,
      });
    }

    return tx.toolSession.create({
      data: {
        id: buildToolSessionId({
          taskId: input.taskId,
          localDeviceId: input.localDeviceId,
          sessionName: input.sessionName,
        }),
        ...payload,
        createdAt: input.now,
      },
    });
  });
}

export async function persistToolSessionStart(input: {
  db: ToolSessionPersistenceDb;
  taskId: string;
  localDeviceId: string;
  sessionType: string;
  sessionName: string;
  now: Date;
}): Promise<ToolSessionRecord> {
  return persistToolSession({
    ...input,
    status: "active",
  });
}

export async function persistToolSessionExit(input: {
  db: ToolSessionPersistenceDb;
  taskId: string;
  localDeviceId: string;
  sessionType: string;
  sessionName: string;
  status: ToolSessionStatus;
  lastOutputSummary?: string | null;
  now: Date;
}): Promise<ToolSessionRecord> {
  return persistToolSession({
    ...input,
  });
}

export async function getLatestToolSessionForTask(input: {
  db?: {
    toolSession: {
      findFirst: typeof prisma.toolSession.findFirst;
    };
  };
  taskId: string;
  localDeviceId?: string;
}): Promise<ToolSessionRecord | null> {
  const db = input.db ?? prisma;

  return db.toolSession.findFirst({
    where: {
      taskId: input.taskId,
      ...(input.localDeviceId ? { localDeviceId: input.localDeviceId } : {}),
      status: "active",
    },
    orderBy: [
      {
        updatedAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
  });
}

export async function persistToolSessionStartWithPrisma(input: {
  prisma: PrismaClient;
  taskId: string;
  localDeviceId: string;
  sessionType: string;
  sessionName: string;
  now: Date;
}): Promise<ToolSessionRecord> {
  const dbAdapter: ToolSessionPersistenceDb = {
    $transaction: async <T,>(
      callback: (tx: ToolSessionPersistenceTx) => Promise<T>,
    ) =>
      input.prisma.$transaction(async (tx) =>
        callback({
          toolSession: tx.toolSession,
        }),
      ),
  };

  return persistToolSessionStart({
    db: dbAdapter,
    taskId: input.taskId,
    localDeviceId: input.localDeviceId,
    sessionType: input.sessionType,
    sessionName: input.sessionName,
    now: input.now,
  });
}

export async function persistToolSessionExitWithPrisma(input: {
  prisma: PrismaClient;
  taskId: string;
  localDeviceId: string;
  sessionType: string;
  sessionName: string;
  status: ToolSessionStatus;
  lastOutputSummary?: string | null;
  now: Date;
}): Promise<ToolSessionRecord> {
  const dbAdapter: ToolSessionPersistenceDb = {
    $transaction: async <T,>(
      callback: (tx: ToolSessionPersistenceTx) => Promise<T>,
    ) =>
      input.prisma.$transaction(async (tx) =>
        callback({
          toolSession: tx.toolSession,
        }),
      ),
  };

  return persistToolSessionExit({
    db: dbAdapter,
    taskId: input.taskId,
    localDeviceId: input.localDeviceId,
    sessionType: input.sessionType,
    sessionName: input.sessionName,
    status: input.status,
    ...(input.lastOutputSummary !== undefined
      ? { lastOutputSummary: input.lastOutputSummary }
      : {}),
    now: input.now,
  });
}
