import type { DesktopLoopDetailResponse } from "@humanthread/workbench-client";
import type { WorkflowInteractionView } from "@humanthread/shared";
import { prisma } from "../../../../../packages/db/src/index";

import {
  readLoopRunProjection,
  type LoopRunProjection,
} from "../orchestration/loop-read-model";
import { readAuthorizedLoopRunInteractions } from "../orchestration/workflow-interaction-query";
import {
  readWorkflowTimeline,
  type WorkflowTimelineItem,
  type WorkflowTimelineResult,
} from "../orchestration/workflow-timeline-query";
import { resolveDesktopReadContext } from "./desktop-read-models";

type DesktopLoopDetailData = DesktopLoopDetailResponse["data"];

interface DesktopLoopScope {
  id: string;
  spaceId: string;
  task: { id: string; title: string };
  version: number;
  currentIteration: number;
  maxIterations: number;
  waitingReason: string | null;
  lastHeartbeatAt: Date | null;
  worker: { id: string; name: string; status: string } | null;
  agentRunId: string | null;
}

interface InteractionReadResult {
  interactions: WorkflowInteractionView[];
  capabilities: {
    canReply: boolean;
    canConfirm: boolean;
    canDecideApproval: boolean;
  };
}

export interface DesktopLoopDetailDependencies {
  resolveDesktopReadContext: typeof resolveDesktopReadContext;
  loadLoopScope(loopRunId: string): Promise<DesktopLoopScope | null>;
  readLoopRunProjection(input: { userId: string; loopRunId: string }): Promise<LoopRunProjection>;
  readWorkflowTimeline(input: { userId: string; loopRunId: string; limit: number }): Promise<WorkflowTimelineResult>;
  readAuthorizedLoopRunInteractions(input: { userId: string; loopRunId: string }): Promise<InteractionReadResult>;
}

const DEFAULT_DEPENDENCIES: DesktopLoopDetailDependencies = {
  resolveDesktopReadContext,
  loadLoopScope: async (loopRunId) => {
    const run = await prisma.loopRun.findUnique({
      where: { id: loopRunId },
      select: {
        id: true,
        version: true,
        currentIteration: true,
        statusReason: true,
        budgetSnapshot: true,
        task: {
          select: {
            id: true,
            title: true,
            project: { select: { spaceId: true } },
          },
        },
        agentRuns: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            lastHeartbeatAt: true,
            worker: { select: { id: true, name: true, status: true } },
          },
        },
      },
    });
    if (!run?.task?.project?.spaceId) return null;
    const budget = asRecord(run.budgetSnapshot);
    const latestAgentRun = run.agentRuns[0] ?? null;
    return {
      id: run.id,
      spaceId: run.task.project.spaceId,
      task: { id: run.task.id, title: run.task.title },
      version: run.version,
      currentIteration: run.currentIteration,
      maxIterations: positiveInteger(budget.maxIterations, 1),
      waitingReason: run.statusReason,
      lastHeartbeatAt: latestAgentRun?.lastHeartbeatAt ?? null,
      worker: latestAgentRun?.worker ?? null,
      agentRunId: latestAgentRun?.id ?? null,
    };
  },
  readLoopRunProjection,
  readWorkflowTimeline,
  readAuthorizedLoopRunInteractions,
};

export async function readDesktopLoopDetail(
  request: Request,
  loopRunId: string,
  overrides: Partial<DesktopLoopDetailDependencies> = {},
): Promise<DesktopLoopDetailData> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const context = await dependencies.resolveDesktopReadContext(request);
  const scope = await dependencies.loadLoopScope(loopRunId);
  if (!scope || scope.spaceId !== context.space.id) throw new Error("Loop not found");

  const projection = await dependencies.readLoopRunProjection({
    userId: context.actor.userId,
    loopRunId: scope.id,
  });
  const [timelineResult, interactionResult] = await Promise.allSettled([
    dependencies.readWorkflowTimeline({
      userId: context.actor.userId,
      loopRunId: scope.id,
      limit: 100,
    }),
    dependencies.readAuthorizedLoopRunInteractions({
      userId: context.actor.userId,
      loopRunId: scope.id,
    }),
  ]);
  const platformTimeline = timelineResult.status === "fulfilled" ? timelineResult.value.items : [];
  const routeTimeline = projection.activities.flatMap((activity) => activity.routeDecision ? [{
    id: activity.id,
    kind: "loop_event" as const,
    occurredAt: activity.occurredAt,
    interactionId: null,
    loopNodeRunId: null,
    actorType: "agent",
    actorId: "decision-router",
    nodeKey: activity.nodeKey,
    status: "routed",
    eventType: activity.eventType,
    summary: activity.summary,
    routeDecision: activity.routeDecision,
  }] : []);
  const timelineById = new Map<string, WorkflowTimelineItem>(platformTimeline.map((item) => [item.id, item]));
  for (const item of routeTimeline) timelineById.set(item.id, item);
  const timeline = [...timelineById.values()].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const interactionRead = interactionResult.status === "fulfilled" ? interactionResult.value : null;
  const interaction = interactionRead
    ? interactionRead.interactions.find((item) => item.status === "open")
      ?? interactionRead.interactions.at(-1)
      ?? null
    : null;
  return {
    run: {
      id: projection.run.id,
      status: projection.run.status,
      version: scope.version,
      definitionVersion: projection.definitionVersion,
      projectionVersion: projection.projectionVersion,
      currentIteration: scope.currentIteration,
      maxIterations: scope.maxIterations,
      transitionCount: projection.run.transitionCount,
      stopReason: boundedText(projection.run.stopReason, 2_000),
      waitingReason: boundedText(scope.waitingReason, 191),
      lastHeartbeatAt: scope.lastHeartbeatAt?.toISOString() ?? null,
    },
    task: {
      id: scope.task.id,
      title: scope.task.title,
      route: `/tasks/${encodeURIComponent(scope.task.id)}`,
    },
    worker: scope.worker,
    agentRunId: scope.agentRunId,
    nodes: projection.nodes.map((node) => ({
      nodeKey: node.nodeKey,
      label: node.label,
      type: node.type,
      status: node.status,
      currentNodeRunId: node.currentNodeRunId,
      attemptNo: node.attemptNo,
      waitingReason: boundedText(node.waitingReason, 191),
      attempts: node.attempts.map((attempt) => ({
        attempt: attempt.attempt,
        status: attempt.status,
        executorType: attempt.executorType,
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        summary: summarizeEvidence(attempt.result),
        errorSummary: summarizeEvidence(attempt.error),
      })),
    })),
    edges: projection.edges,
    timeline: timeline.map((item) => ({
      id: item.id,
      kind: item.eventType ?? item.kind,
      occurredAt: item.occurredAt,
      summary: boundedText(item.summary, 2_000) ?? item.kind,
      ...(item.actorType ? { actorType: item.actorType } : {}),
      ...(item.actorId ? { actorId: item.actorId } : {}),
      ...(item.status ? { status: item.status } : {}),
      ...(item.routeDecision ? { routeDecision: item.routeDecision } : {}),
    })),
    interaction: interaction ? projectInteraction(interaction) : null,
    capabilities: interactionRead ? {
      canReply: interactionRead.capabilities.canReply,
      canConfirm: interactionRead.capabilities.canConfirm,
      canDecideApproval: interactionRead.capabilities.canDecideApproval,
    } : {
      canReply: false,
      canConfirm: false,
      canDecideApproval: false,
    },
  };
}

function projectInteraction(interaction: WorkflowInteractionView): NonNullable<DesktopLoopDetailData["interaction"]> {
  return {
    id: interaction.id,
    kind: interaction.kind,
    status: interaction.status,
    version: interaction.version,
    createdAt: interaction.createdAt,
    closedAt: interaction.closedAt,
    messages: interaction.messages.map((message) => ({
      id: message.id,
      sequence: message.sequence,
      actorType: message.actorType,
      actorId: message.actorId,
      body: boundedText(message.body, 20_000) ?? "",
      answers: message.answers,
      createdAt: message.createdAt,
    })),
    decision: interaction.decision ? {
      decision: interaction.decision.decision,
      actorType: interaction.decision.actorType,
      actorId: interaction.decision.actorId,
      reason: boundedText(interaction.decision.reason, 4_000),
      createdAt: interaction.decision.createdAt,
    } : null,
  };
}

const SECRET_KEY = /(?:access|refresh|api)?token|secret|password|credential|authorization|cookie|prompt|command|environment|(?:^|_)env(?:$|_)/iu;

function summarizeEvidence(value: unknown): string | null {
  const sanitized = sanitizeEvidence(value, 0);
  if (sanitized === null || sanitized === undefined) return null;
  const text = typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized);
  return boundedText(text, 2_000);
}

function sanitizeEvidence(value: unknown, depth: number): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || ["boolean", "number"].includes(typeof value)) return value;
  if (typeof value === "string") return value.slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeEvidence(item, depth + 1));
  if (!value || typeof value !== "object") return String(value);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !SECRET_KEY.test(key))
    .slice(0, 40)
    .map(([key, nested]) => [key, sanitizeEvidence(nested, depth + 1)]));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}
