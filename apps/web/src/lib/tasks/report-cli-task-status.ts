import type { Task, TaskEvent, WorkflowInstance, WorkflowTemplate } from "@humanthread/shared";
import {
  blockTaskForUser,
  completeTaskForUser,
  followUpTaskForUser,
  interruptTaskForUser,
} from "./update-task-status";
import type {
  BlockTaskResult,
  CompleteTaskResult,
  FollowUpTaskResult,
  InterruptTaskResult,
} from "../../../../../packages/workflow-core/src/index";

export interface ReportCliTaskStatusInput {
  status: "completed" | "interrupted" | "follow_up" | "blocked";
  exitCode?: number | null | undefined;
  durationSeconds?: number | undefined;
  outputSummary?: string | undefined;
  payload?: unknown | undefined;
  now: Date;
}

export interface ReportCliTaskStatusContext {
  teamId: string;
  actorUserId: string;
  workflow: WorkflowInstance;
  task: Task;
  template?: WorkflowTemplate;
  userTask?: {
    statusCategory: string;
    acceptanceMode: "none" | "human" | "automated" | "hybrid";
    version: number;
  };
}

export interface ReportCliTaskStatusDependencies {
  loadTaskContext: () => Promise<ReportCliTaskStatusContext>;
  persistCompleted: (input: { teamId: string; result: CompleteTaskResult }) => Promise<void>;
  persistInterrupted: (input: { result: InterruptTaskResult }) => Promise<void>;
  persistBlocked: (input: { result: BlockTaskResult }) => Promise<void>;
  persistFollowUp: (input: { result: FollowUpTaskResult }) => Promise<void>;
  persistCandidate?: (input: {
    taskId: string;
    actorUserId: string;
    expectedVersion: number;
    requestedCommand: "submit_for_review";
    event: TaskEvent;
  }) => Promise<void>;
}

export interface ReportCliTaskStatusResult {
  reportedStatus: "completed" | "interrupted" | "follow_up" | "blocked";
  workflow: WorkflowInstance;
  task: Task;
  nextTask: Task | null;
  events: TaskEvent[];
}

function prependCliReportedEvent<Result extends { events: TaskEvent[] }>(
  result: Result,
  cliReportedEvent: TaskEvent,
): Result {
  return {
    ...result,
    events: [cliReportedEvent, ...result.events],
  };
}

function createCliReportedEvent(input: {
  task: Task;
  workflow: WorkflowInstance;
  actorUserId: string;
  now: Date;
  status: ReportCliTaskStatusInput["status"];
  exitCode?: number | null;
  durationSeconds?: number;
  outputSummary?: string;
  payload?: unknown;
}): TaskEvent {
  const payload =
    input.payload !== undefined && input.payload !== null && typeof input.payload === "object"
      ? {
          status: input.status,
          exitCode: input.exitCode ?? null,
          durationSeconds: input.durationSeconds,
          outputSummary: input.outputSummary,
          ...(input.payload as Record<string, unknown>),
        }
      : {
          status: input.status,
          exitCode: input.exitCode ?? null,
          durationSeconds: input.durationSeconds,
          outputSummary: input.outputSummary,
          ...(input.payload !== undefined ? { payload: input.payload } : {}),
        };

  const baseEvent: TaskEvent = {
    id: `${input.task.id}:cli_reported:${input.now.getTime()}`,
    taskId: input.task.id,
    workflowInstanceId: input.workflow.id,
    type: "cli_reported",
    actorType: "human",
    actorUserId: input.actorUserId,
    createdAt: input.now,
    payload,
  };

  if (input.outputSummary) {
    return {
      ...baseEvent,
      message: input.outputSummary,
    };
  }

  return {
    ...baseEvent,
  };
}

export async function reportCliTaskStatus(
  input: ReportCliTaskStatusInput,
  dependencies: ReportCliTaskStatusDependencies,
): Promise<ReportCliTaskStatusResult> {
  const context = await dependencies.loadTaskContext();
  const cliReportedEvent = createCliReportedEvent({
    task: context.task,
    workflow: context.workflow,
    actorUserId: context.actorUserId,
    now: input.now,
    status: input.status,
    ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
    ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}),
    ...(input.outputSummary !== undefined ? { outputSummary: input.outputSummary } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  });

  if (input.status === "completed") {
    if (context.userTask) {
      if (!dependencies.persistCandidate) {
        throw new Error("Missing user Task candidate persistence");
      }
      await dependencies.persistCandidate({
        taskId: context.task.id,
        actorUserId: context.actorUserId,
        expectedVersion: context.userTask.version,
        requestedCommand: "submit_for_review",
        event: cliReportedEvent,
      });
      return {
        reportedStatus: input.status,
        workflow: context.workflow,
        task: context.task,
        nextTask: null,
        events: [cliReportedEvent],
      };
    }
    const template = context.template;
    if (!template) {
      throw new Error("Missing workflow template for completed CLI report");
    }

    const baseResult = await completeTaskForUser(
      {
        teamId: context.teamId,
        actorUserId: context.actorUserId,
        now: input.now,
      },
      {
        loadTaskContext: async () => ({
          workflow: context.workflow,
          task: context.task,
          template,
        }),
        persist: async () => {},
      },
    );
    const result = prependCliReportedEvent(baseResult, cliReportedEvent);
    await dependencies.persistCompleted({
      teamId: context.teamId,
      result,
    });

    return {
      reportedStatus: input.status,
      workflow: result.workflow,
      task: result.completedTask,
      nextTask: result.nextTask,
      events: result.events,
    };
  }

  if (input.status === "interrupted") {
    const baseResult = await interruptTaskForUser(
      {
        actorUserId: context.actorUserId,
        reason:
          input.outputSummary ?? `CLI exited with code ${input.exitCode ?? "unknown"}`,
        now: input.now,
      },
      {
        loadTaskContext: async () => ({
          workflow: context.workflow,
          task: context.task,
        }),
        persist: async () => {},
      },
    );
    const result = prependCliReportedEvent(baseResult, cliReportedEvent);
    await dependencies.persistInterrupted({
      result,
    });

    return {
      reportedStatus: input.status,
      workflow: result.workflow,
      task: result.task,
      nextTask: null,
      events: result.events,
    };
  }

  if (input.status === "follow_up") {
    const baseResult = await followUpTaskForUser(
      {
        actorUserId: context.actorUserId,
        reason: input.outputSummary ?? "CLI 建议跟进",
        now: input.now,
      },
      {
        loadTaskContext: async () => ({
          workflow: context.workflow,
          task: context.task,
        }),
        persist: async () => {},
      },
    );
    const result = prependCliReportedEvent(baseResult, cliReportedEvent);
    await dependencies.persistFollowUp({
      result,
    });

    return {
      reportedStatus: input.status,
      workflow: result.workflow,
      task: result.task,
      nextTask: null,
      events: result.events,
    };
  }

  const baseResult = await blockTaskForUser(
    {
      actorUserId: context.actorUserId,
      reason: input.outputSummary ?? "CLI 报告阻塞",
      now: input.now,
    },
    {
      loadTaskContext: async () => ({
        workflow: context.workflow,
        task: context.task,
      }),
      persist: async () => {},
    },
  );
  const result = prependCliReportedEvent(baseResult, cliReportedEvent);
  await dependencies.persistBlocked({
    result,
  });

  return {
    reportedStatus: input.status,
    workflow: result.workflow,
    task: result.task,
    nextTask: null,
    events: result.events,
  };
}
