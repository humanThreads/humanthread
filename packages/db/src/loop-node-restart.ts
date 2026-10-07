import {
  createEventEnvelope,
} from "@humanthread/orchestration-core";
import {
  decisionRunGraphSnapshotSchema,
  loopAuthoringGraphSchema,
  type OrchestrationCommand,
  type OrchestrationEventEnvelope,
} from "@humanthread/shared";

import { boundedPersistenceId } from "./bounded-id";
import {
  executeIdempotentCommand,
  OrchestrationPersistenceError,
  type OrchestrationCommandDb,
  type OrchestrationEventsTx,
} from "./orchestration-events";
import { prisma } from "./prisma";

type JsonRecord = Record<string, unknown>;

/**
 * `waiting` is included deliberately: a run parked on human intervention has
 * no live executor, and its most common cause is a transient upstream failure
 * that exhausted the node's attempts. Forcing a brand-new run would repeat
 * every already-successful stage. Only `running` (a live lease) is excluded,
 * because restarting then would race the current executor.
 */
const RESTARTABLE_RUN_STATUSES = new Set(["failed", "exhausted", "cancelled", "completed", "waiting"]);

export interface LoopNodeRestartTx extends OrchestrationEventsTx {
  loopRun: {
    findUnique(args: { where: { id: string }; select: JsonRecord }): Promise<JsonRecord | null>;
    updateMany(args: { where: JsonRecord; data: JsonRecord }): Promise<{ count: number }>;
  };
  loopNodeRun: {
    findFirst(args: {
      where: JsonRecord;
      orderBy: JsonRecord | JsonRecord[];
      select: JsonRecord;
    }): Promise<JsonRecord | null>;
    create(args: { data: JsonRecord }): Promise<unknown>;
  };
}

export interface LoopNodeRestartDb extends OrchestrationCommandDb<LoopNodeRestartTx> {}

export interface RestartLoopRunFromNodeInput {
  loopRunId: string;
  targetNodeKey: string;
  reason?: string;
  actorUserId: string;
  commandId: string;
  occurredAt: Date;
}

export interface RestartLoopRunFromNodeResult {
  loopRunId: string;
  nodeKey: string;
  nodeRunId: string;
  activationNo: number;
  loopRunVersion: number;
}

const DEFAULTS: { db: LoopNodeRestartDb } = {
  db: prisma as unknown as LoopNodeRestartDb,
};

export async function restartLoopRunFromNode(
  input: RestartLoopRunFromNodeInput,
  dependencies: { db: LoopNodeRestartDb } = DEFAULTS,
): Promise<RestartLoopRunFromNodeResult> {
  assertText(input.loopRunId, "Loop Run id");
  assertText(input.targetNodeKey, "Restart node key");
  assertText(input.actorUserId, "Restart actor user id");
  assertText(input.commandId, "Restart command id");
  if (Number.isNaN(input.occurredAt.getTime())) throw validationError("Restart time is invalid");
  const reason = (input.reason ?? "").trim();
  if (reason.length > 2_000) throw validationError("Restart reason is too long");

  const command: OrchestrationCommand<JsonRecord> = {
    commandId: input.commandId,
    correlationId: `loop:${input.loopRunId}`,
    actor: { type: "user", id: input.actorUserId },
    payload: { action: "restart_from_node", nodeKey: input.targetNodeKey },
    issuedAt: input.occurredAt,
  };
  return executeIdempotentCommand({
    command,
    aggregate: { type: "run", id: input.loopRunId },
    db: dependencies.db,
    transactionOptions: { isolationLevel: "Serializable" },
    apply: async (tx) => {
      const run = await tx.loopRun.findUnique({
        where: { id: input.loopRunId },
        select: {
          id: true,
          status: true,
          statusReason: true,
          stopReason: true,
          version: true,
          projectionVersion: true,
          inputSnapshot: true,
          runGraphSnapshot: true,
          loopVersion: { select: { graph: true } },
        },
      });
      if (!run) throw validationError("Loop Run not found");
      const status = requiredText(run.status, "Loop Run status");
      if (!RESTARTABLE_RUN_STATUSES.has(status)) throw validationError("Loop Run is not restartable");
      const graph = rootGraphFromRun(run);
      const node = graph.nodes.find((candidate) => candidate.key === input.targetNodeKey
        || candidate.nodeId === input.targetNodeKey);
      if (!node) throw validationError("Restart node does not exist in the Loop graph");
      if (node.type === "start" || node.type === "end") throw validationError("Loop boundary node cannot be restarted");
      const targetNodeKey = node.key;
      const previous = await tx.loopNodeRun.findFirst({
        where: { loopRunId: input.loopRunId, nodeKey: targetNodeKey },
        orderBy: [{ activationNo: "desc" }, { id: "desc" }],
        select: { activationNo: true, inputSnapshot: true },
      });
      const previousActivationNo = previous ? requiredInteger(previous.activationNo, "Restart activation number") : null;
      if (previousActivationNo === null) {
        throw validationError("Restart node has no prior activation");
      }
      const activationNo = previousActivationNo + 1;
      const incomingEdgeIds = graph.edges
        .filter((edge) => edge.target === targetNodeKey)
        .map((edge) => edge.id);
      const routedSource = incomingEdgeIds.length === 0
        ? null
        : await tx.loopNodeRun.findFirst({
            where: {
              loopRunId: input.loopRunId,
              status: "succeeded",
              selectedEdgeId: { in: incomingEdgeIds },
            },
            orderBy: [{ finishedAt: "desc" }, { activationNo: "desc" }, { id: "desc" }],
            select: { structuredOutput: true },
          });
      const recoveryInputSnapshot = routedSource?.structuredOutput
        ?? previous?.inputSnapshot
        ?? run.inputSnapshot;
      const nodeRunId = boundedPersistenceId("loop-node", [input.loopRunId, targetNodeKey, String(activationNo)], 96);
      await tx.loopNodeRun.create({
        data: {
          id: nodeRunId,
          loopRunId: input.loopRunId,
          nodeKey: targetNodeKey,
          activationNo,
          status: "ready",
          inputSnapshot: toJson(recoveryInputSnapshot),
          attemptCount: 0,
          version: 1,
          readyAt: input.occurredAt,
        },
      });
      const runVersion = requiredInteger(run.version, "Loop Run version");
      const projectionVersion = requiredInteger(run.projectionVersion, "Loop Run projection version");
      const updated = await tx.loopRun.updateMany({
        where: {
          id: input.loopRunId,
          status,
          version: runVersion,
          projectionVersion,
        },
        data: {
          status: "running",
          statusReason: null,
          stopReason: null,
          finishedAt: null,
          version: { increment: 1 },
          projectionVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new OrchestrationPersistenceError("version_conflict", "Loop Run changed while restarting the node");
      const result: RestartLoopRunFromNodeResult = {
        loopRunId: input.loopRunId,
        nodeKey: targetNodeKey,
        nodeRunId,
        activationNo,
        loopRunVersion: runVersion + 1,
      };
      return {
        result,
        events: [
          createEventEnvelope({
            id: boundedPersistenceId("event", ["loop.run.node_restarted", input.loopRunId, input.commandId], 128),
            eventType: "loop.run.node_restarted",
            aggregate: { type: "run", id: input.loopRunId, version: runVersion + 1 },
            sequence: runVersion + 1,
            correlationId: command.correlationId,
            commandId: input.commandId,
            actor: command.actor,
            occurredAt: input.occurredAt,
            payload: {
              loopRunId: input.loopRunId,
              nodeKey: targetNodeKey,
              nodeRunId,
              activationNo,
              previousStatus: status,
              attemptCountReset: true,
              ...(reason ? { reason } : {}),
            },
          }),
          createEventEnvelope({
            id: boundedPersistenceId("event", ["loop.node.ready", nodeRunId, input.commandId], 128),
            eventType: "loop.node.ready",
            aggregate: { type: "loop_node", id: nodeRunId, version: 1 },
            sequence: 0,
            correlationId: command.correlationId,
            commandId: input.commandId,
            actor: command.actor,
            occurredAt: input.occurredAt,
            payload: {
              loopRunId: input.loopRunId,
              nodeKey: targetNodeKey,
              activationNo,
              restartOfStatus: status,
            },
          }),
        ],
        persist: async () => updated.count,
      };
    },
  });
}

function rootGraphFromRun(run: JsonRecord): {
  nodes: Array<{ key: string; nodeId?: string; type: string }>;
  edges: Array<{ id: string; target: string }>;
} {
  const snapshot = decisionRunGraphSnapshotSchema.safeParse(run.runGraphSnapshot);
  if (snapshot.success) {
    const root = snapshot.data.loopVersions.find((version) => version.loopVersionId === snapshot.data.rootLoopVersionId)
      ?? snapshot.data.loopVersions[0];
    if (root) return normalizeGraph(root.graph);
  }
  const fallback = loopAuthoringGraphSchema.safeParse(record(run.loopVersion)?.graph);
  if (fallback.success) return normalizeGraph(fallback.data);
  throw validationError("Loop Run graph snapshot is invalid");
}

function normalizeGraph(value: unknown): {
  nodes: Array<{ key: string; nodeId?: string; type: string }>;
  edges: Array<{ id: string; target: string }>;
} {
  const graph = record(value);
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  return {
    nodes: nodes.flatMap((entry) => {
      const node = record(entry);
      if (!node || typeof node.key !== "string" || typeof node.type !== "string") return [];
      return [{
        key: node.key,
        type: node.type,
        ...(typeof node.nodeId === "string" ? { nodeId: node.nodeId } : {}),
      }];
    }),
    edges: edges.flatMap((entry) => {
      const edge = record(entry);
      if (!edge || typeof edge.id !== "string" || typeof edge.target !== "string") return [];
      return [{ id: edge.id, target: edge.target }];
    }),
  };
}

function toJson(value: unknown): unknown {
  return value === undefined ? {} : value;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw validationError(`${field} is invalid`);
  return value;
}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value)) throw validationError(`${field} is invalid`);
  return value as number;
}

function assertText(value: unknown, field: string): void {
  requiredText(value, field);
}

function validationError(message: string): Error {
  return new OrchestrationPersistenceError("validation_failed", message);
}
