import { createEventEnvelope, transitionLoopNode } from "@humanthread/orchestration-core";
import {
  gateDecisionSchema,
  loopRuntimeBudgetSchema,
  loopTransitionCountersSchema,
  parsePublishedLoopGraph,
  type GateDecision,
  type OrchestrationCommand,
} from "@humanthread/shared";

import { boundedPersistenceId } from "./bounded-id";
import {
  executeIdempotentCommand,
  type OrchestrationCommandDb,
  type OrchestrationEventsTx,
} from "./orchestration-events";
import { prisma } from "./prisma";

type JsonRecord = Record<string, unknown>;

type PersistedGateNode = {
  id: string;
  loopRunId: string;
  nodeKey: string;
  activationNo: number;
  status: string;
  version: number;
  loopRun: {
    id: string;
    engineKind: string;
    status: string;
    version: number;
    projectionVersion: number;
    transitionCount: number;
    repeatCount: number;
    usageAggregate: unknown;
    budgetSnapshot: unknown;
    loopVersion: {
      graph: unknown;
      maxRepeatCount: number;
      platformMaxTransitions: number;
    } | null;
  };
};

export interface LoopGateRoutingTx extends OrchestrationEventsTx {
  loopNodeRun: {
    findUnique(args: unknown): Promise<PersistedGateNode | null>;
    findFirst(args: unknown): Promise<{ activationNo: number } | null>;
    updateMany(args: { where: JsonRecord; data: JsonRecord }): Promise<{ count: number }>;
    create(args: { data: JsonRecord }): Promise<unknown>;
  };
  loopRun: {
    updateMany(args: { where: JsonRecord; data: JsonRecord }): Promise<{ count: number }>;
  };
}

export interface LoopGateRoutingDb extends OrchestrationCommandDb<LoopGateRoutingTx> {}

export type RouteGateDecisionInput = {
  command: OrchestrationCommand<unknown>;
  loopRunId: string;
  loopNodeRunId: string;
  decision: GateDecision;
};

export type RouteGateDecisionResult =
  | {
      status: "routed";
      selectedEdgeId: string;
      targetNodeRunId: string;
    }
  | {
      status: "exhausted";
      selectedEdgeId: string;
      stopReason: "max_transitions_exhausted" | "max_repeat_count_exhausted" | "edge_max_traversals_exhausted";
    };

const DEFAULTS = { db: prisma as unknown as LoopGateRoutingDb };

export async function routeGateDecision(
  input: RouteGateDecisionInput,
  dependencies: { db: LoopGateRoutingDb } = DEFAULTS,
): Promise<RouteGateDecisionResult> {
  const loopRunId = requiredId(input.loopRunId, "LoopRun id");
  const loopNodeRunId = requiredId(input.loopNodeRunId, "LoopNodeRun id");
  const decision = gateDecisionSchema.parse(input.decision);

  return executeIdempotentCommand({
    command: input.command,
    aggregate: { type: "loop_node", id: loopNodeRunId },
    db: dependencies.db,
    apply: async (tx) => {
      const state = await tx.loopNodeRun.findUnique({
        where: { id: loopNodeRunId },
        select: {
          id: true,
          loopRunId: true,
          nodeKey: true,
          activationNo: true,
          status: true,
          version: true,
          loopRun: {
            select: {
              id: true,
              engineKind: true,
              status: true,
              version: true,
              projectionVersion: true,
              transitionCount: true,
              repeatCount: true,
              usageAggregate: true,
              budgetSnapshot: true,
              loopVersion: {
                select: {
                  graph: true,
                  maxRepeatCount: true,
                  platformMaxTransitions: true,
                },
              },
            },
          },
        },
      });
      assertRoutableGateState(state, { loopRunId, loopNodeRunId });

      const graph = parsePublishedLoopGraph(state.loopRun.loopVersion.graph);
      const node = graph.nodes.find(({ key }) => key === state.nodeKey);
      if (!node || (node.type !== "policy_gate" && node.type !== "human_gate")) {
        throw validationError("Only a persisted gate node can route a GateDecision");
      }
      const counters = loopTransitionCountersSchema.parse(state.loopRun.usageAggregate);
      if (
        counters.transitions !== state.loopRun.transitionCount
        || counters.repeats !== state.loopRun.repeatCount
      ) throw validationError("Persisted LoopRun counters disagree with the usage snapshot");
      const budget = loopRuntimeBudgetSchema.parse(state.loopRun.budgetSnapshot);
      const transition = transitionLoopNode({
        graph,
        nodeKey: state.nodeKey,
        decision,
        counters,
        limits: {
          maxRepeatCount: Math.min(
            budget.maxRepeatCount,
            state.loopRun.loopVersion.maxRepeatCount,
            graph.limits.maxRepeatCount,
            20,
          ),
          maxTransitions: Math.min(
            budget.maxTransitions,
            state.loopRun.loopVersion.platformMaxTransitions,
            1_024,
          ),
        },
      });

      let targetActivationNo: number | null = null;
      let targetNodeRunId: string | null = null;
      if (transition.status === "routed") {
        const latestTarget = await tx.loopNodeRun.findFirst({
          where: { loopRunId, nodeKey: transition.edge.target },
          orderBy: { activationNo: "desc" },
          select: { activationNo: true },
        });
        targetActivationNo = (latestTarget?.activationNo ?? 0) + 1;
        targetNodeRunId = boundedPersistenceId("loop-node", [
          loopRunId,
          transition.edge.target,
          String(targetActivationNo),
        ], 96);
      }

      const result: RouteGateDecisionResult = transition.status === "routed"
        ? {
            status: "routed",
            selectedEdgeId: transition.edge.id,
            targetNodeRunId: targetNodeRunId as string,
          }
        : {
            status: "exhausted",
            selectedEdgeId: transition.edge.id,
            stopReason: transition.reason,
          };
      const eventType = transition.status === "routed"
        ? "loop.gate.routed"
        : "loop.gate.exhausted";
      const event = createEventEnvelope({
        id: boundedPersistenceId("event", [eventType, input.command.commandId]),
        eventType,
        aggregate: { type: "loop_node", id: loopNodeRunId, version: state.version + 1 },
        sequence: state.version + 1,
        correlationId: input.command.correlationId,
        commandId: input.command.commandId,
        actor: input.command.actor,
        occurredAt: input.command.issuedAt,
        payload: { loopRunId, decision, result },
      });

      return {
        result,
        events: [event],
        persist: async (currentTx) => {
          const updatedNode = await currentTx.loopNodeRun.updateMany({
            where: {
              id: state.id,
              loopRunId,
              status: state.status,
              version: state.version,
            },
            data: {
              status: "succeeded",
              structuredOutput: decision,
              gateDecision: decision,
              selectedEdgeId: transition.edge.id,
              finishedAt: input.command.issuedAt,
              version: { increment: 1 },
            },
          });
          if (updatedNode.count !== 1) return 0;

          const updatedRun = await currentTx.loopRun.updateMany({
            where: {
              id: state.loopRun.id,
              engineKind: "graph_v1",
              status: state.loopRun.status,
              version: state.loopRun.version,
              projectionVersion: state.loopRun.projectionVersion,
              transitionCount: state.loopRun.transitionCount,
              repeatCount: state.loopRun.repeatCount,
            },
            data: transition.status === "routed"
              ? {
                  status: "running",
                  transitionCount: transition.counters.transitions,
                  repeatCount: transition.counters.repeats,
                  usageAggregate: transition.counters,
                  projectionVersion: { increment: 1 },
                  version: { increment: 1 },
                }
              : {
                  status: "exhausted",
                  statusReason: transition.reason,
                  stopReason: transition.reason,
                  finishedAt: input.command.issuedAt,
                  projectionVersion: { increment: 1 },
                  version: { increment: 1 },
                },
          });
          if (updatedRun.count !== 1) return 0;

          if (
            transition.status === "routed"
            && targetActivationNo !== null
            && targetNodeRunId !== null
          ) {
            await currentTx.loopNodeRun.create({
              data: {
                id: targetNodeRunId,
                loopRunId,
                nodeKey: transition.edge.target,
                activationNo: targetActivationNo,
                status: "ready",
                inputSnapshot: decision,
                attemptCount: 0,
                version: 1,
                readyAt: input.command.issuedAt,
              },
            });
          }
          return 1;
        },
      };
    },
  });
}

function assertRoutableGateState(
  state: PersistedGateNode | null,
  input: { loopRunId: string; loopNodeRunId: string },
): asserts state is PersistedGateNode & { loopRun: PersistedGateNode["loopRun"] & { loopVersion: NonNullable<PersistedGateNode["loopRun"]["loopVersion"]> } } {
  if (
    !state
    || state.id !== input.loopNodeRunId
    || state.loopRunId !== input.loopRunId
    || !["running", "waiting_approval"].includes(state.status)
    || state.loopRun.id !== input.loopRunId
    || state.loopRun.engineKind !== "graph_v1"
    || !["running", "waiting"].includes(state.loopRun.status)
    || !state.loopRun.loopVersion
  ) throw staleGateError();
}

function requiredId(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 128) {
    throw validationError(`${name} is invalid`);
  }
  return value;
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

function staleGateError(): Error {
  return Object.assign(new Error("Gate node is stale or no longer routable"), { code: "stale_lease" });
}
