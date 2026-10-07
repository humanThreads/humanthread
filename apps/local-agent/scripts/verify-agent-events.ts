import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";
import { summarizeAgentEventVerification } from "../src/lib/agent-event-verification-report.ts";

loadEnv({ path: resolve(import.meta.dirname, "../../../.env") });

interface TaskEventRow {
  id: string;
  taskId: string;
  type: string;
  payload: unknown;
  createdAt: Date;
}

function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();

  if (!url) {
    throw new Error("DATABASE_URL is required.");
  }

  return url;
}

function parseTake(): number {
  const raw = process.env.HUMANTHREAD_VERIFY_EVENT_TAKE?.trim() ?? "20";
  const value = Number(raw);

  if (!Number.isFinite(value) || value <= 0) {
    return 20;
  }

  return Math.min(Math.floor(value), 100);
}

function parseTaskId(): string | undefined {
  const taskId = process.env.HUMANTHREAD_VERIFY_TASK_ID?.trim();
  return taskId && taskId.length > 0 ? taskId : undefined;
}

async function loadRecentEvents(prisma: PrismaClient): Promise<TaskEventRow[]> {
  const taskId = parseTaskId();
  const take = parseTake();

  return prisma.taskEvent.findMany({
    where: {
      ...(taskId ? { taskId } : {}),
      type: {
        in: ["local_opened", "command_started", "command_exited"],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take,
    select: {
      id: true,
      taskId: true,
      type: true,
      payload: true,
      createdAt: true,
    },
  });
}

function parseExpectedTypes(): string[] | null {
  const raw = process.env.HUMANTHREAD_VERIFY_EXPECT_TYPES?.trim();

  if (!raw) {
    return null;
  }

  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return values.length > 0 ? values : null;
}

function parseLatestOnly(): boolean {
  const value = process.env.HUMANTHREAD_VERIFY_LATEST_ONLY?.trim().toLowerCase();

  if (value === "0" || value === "false" || value === "no") {
    return false;
  }

  if (value === "1" || value === "true" || value === "yes") {
    return true;
  }

  return Boolean(parseTaskId());
}

async function main() {
  const adapter = new PrismaMariaDb(resolveDatabaseUrl());
  const prisma = new PrismaClient({ adapter });

  try {
    const rows = await loadRecentEvents(prisma);
    const expectedTypes = parseExpectedTypes();
    const latestOnly = parseLatestOnly();
    const summary = summarizeAgentEventVerification({
      rows,
      expectedTypes,
      latestOnly,
    });

    console.log(
      JSON.stringify(summary, null, 2),
    );

    if (!summary.ok) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
