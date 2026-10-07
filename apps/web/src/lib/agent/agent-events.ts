import type { Prisma } from "@prisma/client";
import {
  persistToolSessionExitWithPrisma,
  persistToolSessionStartWithPrisma,
  prisma,
} from "../../../../../packages/db/src/index";
import { appendLegacyTaskEvents } from "../../../../../packages/db/src/legacy-task-events";
import type {
  AgentDeviceInfo,
  AgentTaskEventType,
  TaskEventType,
} from "@humanthread/shared";
import { assertLegacyWorkflowTask } from "../tasks/legacy-workflow-task";

const SUPPORTED_AGENT_EVENT_TYPES = [
  "local_opened",
  "command_started",
  "command_exited",
] as const;

type SupportedAgentEventType = AgentTaskEventType;

function isSupportedAgentEventType(
  value: string,
): value is SupportedAgentEventType {
  return SUPPORTED_AGENT_EVENT_TYPES.includes(value as SupportedAgentEventType);
}

function createAgentEventId(
  taskId: string,
  eventType: SupportedAgentEventType,
): string {
  return `${taskId}:${eventType}:${Date.now()}`;
}

function extractSessionMetadata(input: unknown): {
  sessionName: string;
  sessionType: string;
  status: string | undefined;
} {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  return {
    sessionName:
      typeof record.sessionName === "string" ? record.sessionName : "",
    sessionType:
      typeof record.sessionType === "string" ? record.sessionType : "tmux",
    status: typeof record.status === "string" ? record.status : undefined,
  };
}

export interface ReportAgentTaskEventInput {
  taskId: string;
  actorUserId: string;
  actorTeamId?: string;
  eventType: string;
  message?: string;
  payload?: unknown;
  localDevice: AgentDeviceInfo;
  now?: Date;
}

interface ReportAgentTaskEventDependencies {
  createEventId: (taskId: string, eventType: SupportedAgentEventType) => string;
  loadTaskContext: (input: { taskId: string }) => Promise<{
    task: {
      id: string;
      workflowInstanceId: string | null;
      teamId: string;
    };
  }>;
  persist: (input: {
    actorUserId: string;
    event: {
      id: string;
      taskId: string;
      workflowInstanceId: string;
      type: TaskEventType;
      actorType: "human";
      actorUserId: string;
      message?: string;
      payload: Prisma.InputJsonObject;
      createdAt: Date;
    };
    localDevice: AgentDeviceInfo;
    now: Date;
  }) => Promise<void>;
  persistToolSessionStart?: typeof persistToolSessionStartWithPrisma;
  persistToolSessionExit?: typeof persistToolSessionExitWithPrisma;
}

export async function reportAgentTaskEvent(
  input: ReportAgentTaskEventInput,
  dependencies: ReportAgentTaskEventDependencies = {
    createEventId: createAgentEventId,
    loadTaskContext: async ({ taskId }) => {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          workflowInstanceId: true,
          teamId: true,
        },
      });

      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      return { task };
    },
    persist: async ({ actorUserId, event, localDevice, now }) => {
      await prisma.$transaction(async (tx) => {
        await tx.localDevice.upsert({
          where: { id: localDevice.id },
          update: {
            userId: actorUserId,
            name: localDevice.name,
            platform: localDevice.platform,
            lastSeenAt: now,
          },
          create: {
            id: localDevice.id,
            userId: actorUserId,
            name: localDevice.name,
            platform: localDevice.platform,
            lastSeenAt: now,
          },
        });

        await tx.taskEvent.create({
          data: {
            id: event.id,
            taskId: event.taskId,
            workflowInstanceId: event.workflowInstanceId,
            type: event.type,
            actorType: event.actorType,
            actorUserId: event.actorUserId,
            ...(event.message ? { message: event.message } : {}),
            payload: event.payload,
            createdAt: event.createdAt,
          },
        });

        await appendLegacyTaskEvents({
          tx: {
            orchestrationAggregateSequence: {
              upsert: (args) => tx.orchestrationAggregateSequence.upsert(args),
            },
            orchestrationEvent: {
              createMany: (args) => tx.orchestrationEvent.createMany({
                data: args.data as Prisma.OrchestrationEventCreateManyInput[],
              }),
            },
            outboxMessage: {
              createMany: (args) => tx.outboxMessage.createMany({
                data: args.data as Prisma.OutboxMessageCreateManyInput[],
              }),
            },
          },
          events: [event],
        });
      });
    },
    persistToolSessionStart: persistToolSessionStartWithPrisma,
    persistToolSessionExit: persistToolSessionExitWithPrisma,
  },
) {
  if (!isSupportedAgentEventType(input.eventType)) {
    throw new Error("Unsupported agent event type");
  }

  const now = input.now ?? new Date();
  const context = await dependencies.loadTaskContext({
    taskId: input.taskId,
  });
  assertLegacyWorkflowTask(context.task);

  if (input.actorTeamId && context.task.teamId !== input.actorTeamId) {
    throw new Error("Agent user cannot report events for a different team");
  }

  const payload =
    input.payload && typeof input.payload === "object"
      ? {
          ...(input.payload as Record<string, unknown>),
        }
      : {};

  const event = {
    id: dependencies.createEventId(input.taskId, input.eventType),
    taskId: input.taskId,
    workflowInstanceId: context.task.workflowInstanceId,
    type: input.eventType,
    actorType: "human" as const,
    actorUserId: input.actorUserId,
    ...(input.message?.trim() ? { message: input.message.trim() } : {}),
    payload: {
      ...payload,
      deviceId: input.localDevice.id,
      deviceName: input.localDevice.name,
      platform: input.localDevice.platform,
    } satisfies Prisma.InputJsonObject,
    createdAt: now,
  };

  if (input.eventType === "command_started") {
    const { sessionName, sessionType } = extractSessionMetadata(input.payload);

    if (sessionName.trim() && dependencies.persistToolSessionStart) {
      await dependencies.persistToolSessionStart({
        prisma,
        taskId: input.taskId,
        localDeviceId: input.localDevice.id,
        sessionType,
        sessionName,
        now,
      });
    }
  }

  if (input.eventType === "command_exited") {
    const { sessionName, sessionType, status } = extractSessionMetadata(
      input.payload,
    );
    const exitStatus = status === "completed" ? "completed" : "interrupted";

    if (sessionName.trim() && dependencies.persistToolSessionExit) {
      await dependencies.persistToolSessionExit({
        prisma,
        taskId: input.taskId,
        localDeviceId: input.localDevice.id,
        sessionType,
        sessionName,
        status: exitStatus,
        lastOutputSummary: null,
        now,
      });
    }
  }

  await dependencies.persist({
    actorUserId: input.actorUserId,
    event,
    localDevice: input.localDevice,
    now,
  });

  return {
    event,
    localDevice: input.localDevice,
  };
}
