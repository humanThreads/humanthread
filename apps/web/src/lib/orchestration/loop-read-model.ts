import { assertCanReadProject, prisma } from "@humanthread/db";
import { loopAuthoringGraphSchema, type LoopAuthoringGraph } from "@humanthread/orchestration-core";
import { projectApprovalDecisionItem, type ApprovalDecisionItem, type ApprovalDecisionRecord } from "./approval-read-model";
import { buildActiveApprovalWhere } from "./approval-visibility";
import {
  loopChecklistCreatedPayloadSchema,
  loopChecklistUpdatedPayloadSchema,
  loopExecutionPhaseStatusSchema,
  validateLoopChecklistTransition,
  type LoopChecklistItem,
} from "@humanthread/shared";

type JsonRecord = Record<string, unknown>;

interface RawNodeRun {
  id: string;
  nodeKey: string;
  activationNo: number;
  status: string;
  selectedExecutionTarget?: string | null;
  waitingReason: string | null;
  attemptCount: number;
  attempts: Array<{
    id: string;
    attempt: number;
    status: string;
    executorType: string;
    startedAt: Date | null;
    finishedAt: Date | null;
    result: unknown;
    error: unknown;
    executionPhase?: string | null;
    executionPhaseStatus?: string | null;
    executionPhaseStartedAt?: Date | null;
    executionPhaseFinishedAt?: Date | null;
    executionPhaseCode?: string | null;
    executionPhaseSummary?: string | null;
    executionPhaseUpdatedAt?: Date | null;
    agentRun?: {
      linuxWorkerPoolSession?: { instanceId: string; workerPool?: { displayName: string } | null } | null;
    } | null;
  }>;
}

interface RawLoopRun {
  id: string;
  projectId: string | null;
  taskId?: string | null;
  status: string;
  statusReason?: string | null;
  repeatCount: number;
  transitionCount: number;
  stopReason: string | null;
  projectionVersion: number;
  usageAggregate: unknown;
  executionSnapshot?: unknown;
  loopVersion: { versionNumber: number; graph: unknown } | null;
  nodeRuns: RawNodeRun[];
  effects: Array<{ id: string }>;
  approvals?: ApprovalDecisionRecord[];
  parentLoopRun?: { id: string; projectId: string | null; status: string } | null;
  childLoopRuns?: Array<{
    id: string;
    projectId: string | null;
    parentNodeRunId: string | null;
    status: string;
    loopVersion: { graph: unknown } | null;
    nodeRuns: RawNodeRun[];
  }>;
}

interface RawLoopEvent {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  sequence: number;
  occurredAt: Date;
  payload: unknown;
}

interface LoopReadDependencies {
  assertCanReadProject(input: { userId: string; projectId: string }): Promise<unknown>;
  loadRun(loopRunId: string): Promise<RawLoopRun | null>;
  loadEventCount(input: { loopRunId: string; nodeRunIds: string[]; effectIds: string[] }): Promise<number>;
  loadEvents(input: { loopRunId: string; nodeRunIds: string[]; effectIds: string[] }): Promise<RawLoopEvent[]>;
  loadVisibleEvents(input: { loopRunId: string; nodeRunIds: string[]; effectIds: string[] }): Promise<RawLoopEvent[]>;
}

const DEFAULTS: LoopReadDependencies = {
  assertCanReadProject: (input) => assertCanReadProject(input),
  loadRun: (loopRunId) => prisma.loopRun.findFirst({
    where: { id: loopRunId, engineKind: "graph_v1" },
    select: {
      id: true,
      projectId: true,
      taskId: true,
      status: true,
      statusReason: true,
      repeatCount: true,
      transitionCount: true,
      stopReason: true,
      projectionVersion: true,
      usageAggregate: true,
      executionSnapshot: true,
      parentLoopRun: { select: { id: true, projectId: true, status: true } },
      childLoopRuns: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          projectId: true,
          parentNodeRunId: true,
          status: true,
          loopVersion: { select: { graph: true } },
          nodeRuns: {
            orderBy: [{ activationNo: "asc" }, { id: "asc" }],
            select: { id: true, nodeKey: true, activationNo: true, status: true, selectedExecutionTarget: true, waitingReason: true, attemptCount: true, attempts: { select: { id: true, attempt: true, status: true, executorType: true, startedAt: true, finishedAt: true, result: true, error: true, executionPhase: true, executionPhaseStatus: true, executionPhaseStartedAt: true, executionPhaseFinishedAt: true, executionPhaseCode: true, executionPhaseSummary: true, executionPhaseUpdatedAt: true, agentRun: { select: { linuxWorkerPoolSession: { select: { instanceId: true, workerPool: { select: { displayName: true } } } } } } } } },
          },
        },
      },
      loopVersion: { select: { versionNumber: true, graph: true } },
      nodeRuns: {
        orderBy: [{ activationNo: "asc" }, { id: "asc" }],
        select: {
          id: true,
          nodeKey: true,
          activationNo: true,
          status: true,
          selectedExecutionTarget: true,
          waitingReason: true,
          attemptCount: true,
          attempts: {
            orderBy: { attempt: "asc" },
            select: {
              id: true,
              attempt: true,
              status: true,
              executorType: true,
              startedAt: true,
              finishedAt: true,
              result: true,
              error: true,
              executionPhase: true,
              executionPhaseStatus: true,
              executionPhaseStartedAt: true,
              executionPhaseFinishedAt: true,
              executionPhaseCode: true,
              executionPhaseSummary: true,
              executionPhaseUpdatedAt: true,
              agentRun: { select: { linuxWorkerPoolSession: { select: { instanceId: true, workerPool: { select: { displayName: true } } } } } },
            },
          },
        },
      },
      effects: { select: { id: true } },
      approvals: {
        where: buildActiveApprovalWhere(new Date()),
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          status: true,
          projectId: true,
          createdAt: true,
          requestPayload: true,
          policySnapshot: true,
          expiresAt: true,
          project: { select: { name: true } },
          taskId: true,
          task: { select: { id: true, shortId: true, title: true } },
          loopRunId: true,
          loopRun: {
            select: {
              id: true,
              taskId: true,
              task: { select: { id: true, shortId: true, title: true } },
              loopVersion: { select: { graph: true, loopDefinition: { select: { name: true } } } },
            },
          },
          loopNodeRunId: true,
          loopNodeRun: {
            select: {
              id: true,
              nodeKey: true,
              inputSnapshot: true,
              artifacts: {
                where: { type: "review_html" },
                orderBy: { createdAt: "desc" },
                take: 20,
                select: { id: true, type: true, mimeType: true, byteSize: true, metadata: true },
              },
            },
          },
        },
      },
    },
  }),
  loadEventCount: ({ loopRunId, nodeRunIds, effectIds }) => prisma.orchestrationEvent.count({
    where: loopRunEventWhere(loopRunId, nodeRunIds, effectIds),
  }),
  loadEvents: ({ loopRunId, nodeRunIds, effectIds }) => prisma.orchestrationEvent.findMany({
    where: loopRunEventWhere(loopRunId, nodeRunIds, effectIds),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      eventType: true,
      aggregateType: true,
      aggregateId: true,
      sequence: true,
      occurredAt: true,
      payload: true,
    },
  }),
  loadVisibleEvents: ({ loopRunId, nodeRunIds, effectIds }) => prisma.orchestrationEvent.findMany({
    where: {
      ...loopRunEventWhere(loopRunId, nodeRunIds, effectIds),
      eventType: { not: "worker.app_server.notification" },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      eventType: true,
      aggregateType: true,
      aggregateId: true,
      sequence: true,
      occurredAt: true,
      payload: true,
    },
  }),
};

export interface LoopRunProjection {
  definitionVersion: number;
  projectionVersion: number;
  eventCursor: number;
  pendingApprovals?: ApprovalDecisionItem[];
  run: {
    id: string;
    taskId?: string | null;
    status: string;
    statusReason?: string | null;
    repeatCount: number;
    transitionCount: number;
    stopReason: string | null;
    executionTarget?: { type: "local_agent" | "linux_worker_pool"; displayName: string };
  };
  parentRun?: { id: string; status: string } | null;
  childRuns?: Array<{
    id: string;
    parentNodeRunId: string;
    status: string;
    progress?: { completed: number; total: number };
    nodes?: Array<{ nodeKey: string; label: string; status: string }>;
  }>;
  nodes: Array<{
    nodeKey: string;
    nodeId?: string;
    label: string;
    type: LoopAuthoringGraph["nodes"][number]["type"];
    status: string;
    currentNodeRunId: string | null;
    attemptNo: number;
    waitingReason: string | null;
    checklist?: LoopChecklistItem[];
    attempts: Array<{
      attemptId: string;
      attempt: number;
      status: string;
      executorType: string;
      startedAt: string | null;
      finishedAt: string | null;
      result: unknown;
      error: unknown;
      executionPhase: {
        phase: string;
        status: "pending" | "running" | "succeeded" | "failed" | "skipped";
        startedAt: string | null;
        finishedAt: string | null;
        code: string | null;
        summary: string | null;
        updatedAt: string | null;
      } | null;
      executionTarget?: string;
      workerPoolDisplayName?: string;
      workerInstance?: string;
    }>;
  }>;
  edges: Array<{
    edgeId: string;
    source: string;
    target: string;
    kind: LoopAuthoringGraph["edges"][number]["kind"];
    outcome: LoopAuthoringGraph["edges"][number]["outcome"];
    traversalCount: number;
    limit: number | null;
    lastTraversalAt: string | null;
  }>;
  activities: Array<{
    id: string;
    cursor: number;
    eventType: string;
    occurredAt: string;
    nodeKey: string | null;
    edgeId: string | null;
    summary: string;
    routeDecision?: LoopRouteAudit;
  }>;
}

export interface LoopRouteAudit {
  decisionId: string;
  sourceNodeId: string;
  targetNodeId: string;
  reasonCode: string;
  summary: string;
  confidence: number;
  evidence: string[];
  routerContractVersion: number;
  routerContractDigest: string;
  selectedEdgeId: string | null;
  errorSummary: string | null;
}

export async function readLoopRunProjection(
  input: { userId: string; loopRunId: string },
  dependencies: LoopReadDependencies = DEFAULTS,
): Promise<LoopRunProjection> {
  const loaded = await loadAuthorizedRun(input, dependencies);
  const [events, eventCursor] = await Promise.all([
    loadVisibleRunEvents(loaded.run, dependencies),
    loadRunEventCount(loaded.run, dependencies),
  ]);
  const latestByNode = latestNodeRuns(loaded.run.nodeRuns);
  const edgeTraversals = parseEdgeTraversals(loaded.run.usageAggregate);
  const lastTraversalAt = findLastTraversalTimes(events);
  const nodesByRunId = new Map(loaded.run.nodeRuns.map((nodeRun) => [nodeRun.id, nodeRun.nodeKey]));
  const runExecutionTarget = projectLoopExecutionTarget(loaded.run.executionSnapshot);
  const now = new Date();

  return {
    definitionVersion: loaded.run.loopVersion!.versionNumber,
    projectionVersion: loaded.run.projectionVersion,
    eventCursor,
    pendingApprovals: (loaded.run.approvals ?? [])
      .filter((approval) => approval.status === "pending" && (!approval.expiresAt || approval.expiresAt > now))
      .map(projectApprovalDecisionItem),
    run: {
      id: loaded.run.id,
      taskId: loaded.run.taskId ?? null,
      status: loaded.run.status,
      statusReason: loaded.run.statusReason ?? null,
      repeatCount: loaded.run.repeatCount,
      transitionCount: loaded.run.transitionCount,
      stopReason: loaded.run.stopReason,
      ...(runExecutionTarget ? { executionTarget: runExecutionTarget } : {}),
    },
    ...(loaded.run.parentLoopRun === undefined ? {} : {
      parentRun: loaded.run.parentLoopRun
        ? { id: loaded.run.parentLoopRun.id, status: loaded.run.parentLoopRun.status }
        : null,
    }),
    ...(loaded.run.childLoopRuns === undefined ? {} : {
      childRuns: loaded.run.childLoopRuns.flatMap((child) => {
        if (!child.parentNodeRunId || !child.loopVersion) return [];
        const childGraph = loopAuthoringGraphSchema.safeParse(child.loopVersion.graph);
        if (!childGraph.success) return [];
        const latest = latestNodeRuns(child.nodeRuns);
        const nodes = childGraph.data.nodes.map((node) => ({
          nodeKey: node.key,
          label: node.label,
          status: latest.get(node.key)?.status ?? "pending",
        }));
        return [{
          id: child.id,
          parentNodeRunId: child.parentNodeRunId,
          status: child.status,
          progress: {
            completed: nodes.filter((node) => ["succeeded", "completed"].includes(node.status)).length,
            total: nodes.length,
          },
          nodes,
        }];
      }),
    }),
    nodes: loaded.graph.nodes.map((node) => {
      const current = latestByNode.get(node.key);
      const currentAttemptNo = current
        ? Math.max(current.attemptCount, ...current.attempts.map((attempt) => attempt.attempt))
        : 0;
      const checklist = current
        ? projectRuntimeChecklist(events, { loopRunId: loaded.run.id, nodeRunId: current.id, attemptNo: currentAttemptNo })
        : undefined;
      return {
        nodeKey: node.key,
        ...(node.nodeId ? { nodeId: node.nodeId } : {}),
        label: node.label,
        type: node.type,
        status: current?.status ?? "pending",
        currentNodeRunId: current?.id ?? null,
        attemptNo: currentAttemptNo,
        waitingReason: current?.waitingReason ?? null,
        ...(checklist && checklist.length > 0 ? { checklist } : {}),
        attempts: (current?.attempts ?? []).map((attempt) => {
          const executionTarget = effectiveExecutionTarget(current?.selectedExecutionTarget, runExecutionTarget);
          const workerPoolDisplayName = attempt.agentRun?.linuxWorkerPoolSession?.workerPool?.displayName
            ?? (executionTarget === "linux_worker_pool" ? runExecutionTarget?.displayName : undefined);
          return {
            attemptId: attempt.id,
            attempt: attempt.attempt,
            status: attempt.status,
            executorType: attempt.executorType,
            startedAt: attempt.startedAt?.toISOString() ?? null,
            finishedAt: attempt.finishedAt?.toISOString() ?? null,
            result: attempt.result,
            error: attempt.error,
            executionPhase: projectAttemptExecutionPhase(attempt),
            ...(executionTarget ? { executionTarget } : {}),
            ...(workerPoolDisplayName ? { workerPoolDisplayName } : {}),
            ...(attempt.agentRun?.linuxWorkerPoolSession?.instanceId
              ? { workerInstance: attempt.agentRun.linuxWorkerPoolSession.instanceId }
              : {}),
          };
        }),
      };
    }),
    edges: loaded.graph.edges.map((edge) => ({
      edgeId: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      outcome: edge.outcome,
      traversalCount: edgeTraversals[edge.id] ?? 0,
      limit: edge.maxTraversals ?? null,
      lastTraversalAt: lastTraversalAt.get(edge.id) ?? null,
    })),
    activities: events.flatMap((event, index) => (
      isVisibleActivityEvent(event) ? [projectActivity(event, index + 1, loaded.graph, nodesByRunId)] : []
    )),
  };
}

function projectAttemptExecutionPhase(
  attempt: RawNodeRun["attempts"][number],
): LoopRunProjection["nodes"][number]["attempts"][number]["executionPhase"] {
  const phase = attempt.executionPhase;
  const status = attempt.executionPhaseStatus;
  if (!phase || !status) return null;
  const parsedStatus = loopExecutionPhaseStatusSchema.safeParse(status);
  if (!parsedStatus.success) return null;
  return {
    phase,
    status: parsedStatus.data,
    startedAt: attempt.executionPhaseStartedAt?.toISOString() ?? null,
    finishedAt: attempt.executionPhaseFinishedAt?.toISOString() ?? null,
    code: attempt.executionPhaseCode ?? null,
    summary: attempt.executionPhaseSummary ?? null,
    updatedAt: attempt.executionPhaseUpdatedAt?.toISOString() ?? null,
  };
}

function projectLoopExecutionTarget(
  value: unknown,
): { type: "local_agent" | "linux_worker_pool"; displayName: string } | undefined {
  if (!isRecord(value) || !isRecord(value.target)) return undefined;
  const target = value.target;
  if (target.type === "local_agent" && typeof target.profileDisplayName === "string") {
    return { type: "local_agent", displayName: target.profileDisplayName };
  }
  if (target.type === "linux_worker_pool" && typeof target.poolDisplayName === "string") {
    return { type: "linux_worker_pool", displayName: target.poolDisplayName };
  }
  return undefined;
}

function effectiveExecutionTarget(
  selectedExecutionTarget: string | null | undefined,
  runExecutionTarget: { type: "local_agent" | "linux_worker_pool"; displayName: string } | undefined,
): string | undefined {
  if (selectedExecutionTarget === "local" && runExecutionTarget) return runExecutionTarget.type;
  return selectedExecutionTarget ?? runExecutionTarget?.type;
}

export async function readLoopEventsAfterCursor(
  input: { userId: string; loopRunId: string; cursor: number },
  dependencies: LoopReadDependencies = DEFAULTS,
): Promise<{ cursor: number; events: Array<Record<string, unknown>> }> {
  if (!Number.isInteger(input.cursor) || input.cursor < 0) throw validationError("Loop event cursor is invalid");
  const loaded = await loadAuthorizedRun(input, dependencies);
  const events = await loadRunEvents(loaded.run, dependencies);
  if (input.cursor > events.length) throw validationError("Loop event cursor is ahead of the event stream");
  return {
    cursor: events.length,
    events: events.slice(input.cursor).map((event) => serializeEvent(event, loaded.graph)),
  };
}

async function loadAuthorizedRun(
  input: { userId: string; loopRunId: string },
  dependencies: LoopReadDependencies,
): Promise<{ run: RawLoopRun; graph: LoopAuthoringGraph }> {
  const loopRunId = decodedRouteText(input.loopRunId, "LoopRun id", 96);
  const userId = requiredText(input.userId, "User id", 64);
  const run = await dependencies.loadRun(loopRunId);
  if (!run || !run.projectId || !run.loopVersion) throw notFound("Graph LoopRun not found");
  await dependencies.assertCanReadProject({ userId, projectId: run.projectId });
  assertRelatedRunsBelongToProject(run);
  const parsed = loopAuthoringGraphSchema.safeParse(run.loopVersion.graph);
  if (!parsed.success) throw validationError("Persisted LoopVersion graph is invalid");
  return { run, graph: parsed.data };
}

function assertRelatedRunsBelongToProject(run: RawLoopRun): void {
  if (run.parentLoopRun && run.parentLoopRun.projectId !== run.projectId) {
    throw validationError("LoopRun relation belongs to another Project");
  }
  if (run.childLoopRuns?.some((child) => child.projectId !== run.projectId)) {
    throw validationError("LoopRun relation belongs to another Project");
  }
}

function loadRunEvents(run: RawLoopRun, dependencies: LoopReadDependencies): Promise<RawLoopEvent[]> {
  return dependencies.loadEvents(loopRunEventInput(run));
}

function loadVisibleRunEvents(run: RawLoopRun, dependencies: LoopReadDependencies): Promise<RawLoopEvent[]> {
  return dependencies.loadVisibleEvents(loopRunEventInput(run));
}

function loadRunEventCount(run: RawLoopRun, dependencies: LoopReadDependencies): Promise<number> {
  return dependencies.loadEventCount(loopRunEventInput(run));
}

function loopRunEventInput(run: RawLoopRun): { loopRunId: string; nodeRunIds: string[]; effectIds: string[] } {
  return {
    loopRunId: run.id,
    nodeRunIds: run.nodeRuns.map((nodeRun) => nodeRun.id),
    effectIds: run.effects.map((effect) => effect.id),
  };
}

function loopRunEventWhere(loopRunId: string, nodeRunIds: string[], effectIds: string[]) {
  return {
    OR: [
      { aggregateType: "run", aggregateId: loopRunId },
      ...(nodeRunIds.length === 0 ? [] : [{ aggregateType: "loop_node", aggregateId: { in: nodeRunIds } }]),
      ...(effectIds.length === 0 ? [] : [{ aggregateType: "loop_effect", aggregateId: { in: effectIds } }]),
    ],
  };
}

function isVisibleActivityEvent(event: RawLoopEvent): boolean {
  // Worker app-server notifications are raw transport diagnostics. They are
  // retained for audit, but are not lifecycle activity and can arrive once per
  // generated token or command-output chunk.
  return event.eventType !== "worker.app_server.notification";
}

function latestNodeRuns(nodeRuns: RawNodeRun[]): Map<string, RawNodeRun> {
  const latest = new Map<string, RawNodeRun>();
  for (const nodeRun of nodeRuns) {
    const current = latest.get(nodeRun.nodeKey);
    if (!current || nodeRun.activationNo > current.activationNo) latest.set(nodeRun.nodeKey, nodeRun);
  }
  return latest;
}

function parseEdgeTraversals(value: unknown): Record<string, number> {
  if (!isRecord(value) || !isRecord(value.edgeTraversals)) return {};
  return Object.fromEntries(Object.entries(value.edgeTraversals).filter((entry): entry is [string, number] => (
    Number.isInteger(entry[1]) && (entry[1] as number) >= 0
  )));
}

function findLastTraversalTimes(events: RawLoopEvent[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const event of events) {
    if (event.eventType !== "loop.node.completed" || !isRecord(event.payload)) continue;
    const transition = event.payload.transition;
    if (!isRecord(transition) || !isRecord(transition.edge) || typeof transition.edge.id !== "string") continue;
    result.set(transition.edge.id, event.occurredAt.toISOString());
  }
  return result;
}

/**
 * A read projection is intentionally defensive: database ingress has already
 * validated current events, but a historical malformed record must not make
 * the whole authorized run unreadable. Only lease-bound entries for this
 * NodeRun are replayed and an invalid replay is ignored.
 */
function projectRuntimeChecklist(
  events: readonly RawLoopEvent[],
  expected: { loopRunId: string; nodeRunId: string; attemptNo: number },
): LoopChecklistItem[] | undefined {
  const checklist = new Map<string, LoopChecklistItem>();
  let created = false;

  for (const event of events) {
    if (event.aggregateType !== "loop_node" || event.aggregateId !== expected.nodeRunId) continue;
    const payload = isRecord(event.payload) ? event.payload : {};
    const summary = payload.payloadSummary;
    if (event.eventType === "loop.checklist.created") {
      const parsed = loopChecklistCreatedPayloadSchema.safeParse(summary);
      if (!parsed.success || !matchesChecklistProjection(parsed.data, expected) || created) continue;
      created = true;
      for (const item of parsed.data.checklist) checklist.set(item.id, item);
      continue;
    }
    if (event.eventType !== "loop.checklist.updated" || !created) continue;
    const parsed = loopChecklistUpdatedPayloadSchema.safeParse(summary);
    if (!parsed.success || !matchesChecklistProjection(parsed.data, expected)) continue;
    const current = checklist.get(parsed.data.itemId);
    if (!current) continue;
    try {
      validateLoopChecklistTransition(current.status, parsed.data.status);
    } catch {
      continue;
    }
    checklist.set(current.id, {
      ...current,
      status: parsed.data.status,
      ...(parsed.data.reason === undefined ? { reason: undefined } : { reason: parsed.data.reason }),
      evidenceRefs: parsed.data.evidenceRefs,
    });
  }

  return created ? [...checklist.values()] : undefined;
}

function matchesChecklistProjection(
  payload: { loopRunId: string; loopNodeRunId: string; attemptNo: number },
  expected: { loopRunId: string; nodeRunId: string; attemptNo: number },
): boolean {
  return payload.loopRunId === expected.loopRunId
    && payload.loopNodeRunId === expected.nodeRunId
    && payload.attemptNo === expected.attemptNo;
}

function serializeEvent(event: RawLoopEvent, graph: LoopAuthoringGraph): Record<string, unknown> {
  const rawPayload = isRecord(event.payload) ? event.payload : {};
  const routeDecision = event.eventType === "loop.agent.route_decided"
    ? projectRouteDecision(rawPayload, graph)
    : undefined;
  return {
    id: event.id,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    sequence: event.sequence,
    occurredAt: event.occurredAt.toISOString(),
    payload: event.eventType === "loop.agent.route_decided" ? routeDecision ?? {} : event.payload,
  };
}

function projectActivity(
  event: RawLoopEvent,
  cursor: number,
  graph: LoopAuthoringGraph,
  nodesByRunId: Map<string, string>,
): LoopRunProjection["activities"][number] {
  const payload = isRecord(event.payload) ? event.payload : {};
  const nodeKey = readString(payload.nodeKey) ?? nodesByRunId.get(event.aggregateId) ?? null;
  const nodeLabel = graph.nodes.find((node) => node.key === nodeKey)?.label ?? nodeKey;
  const routeDecision = event.eventType === "loop.agent.route_decided"
    ? projectRouteDecision(payload, graph)
    : undefined;
  const edgeId = routeDecision?.selectedEdgeId ?? readEventEdgeId(event.eventType, payload);
  const edge = graph.edges.find((candidate) => candidate.id === edgeId);
  const targetLabel = graph.nodes.find((node) => node.key === edge?.target)?.label ?? edge?.target;
  const projectedNodeKey = routeDecision
    ? graph.nodes.find((node) => stableNodeId(node) === routeDecision.sourceNodeId)?.key ?? nodeKey
    : nodeKey;

  return {
    id: event.id,
    cursor,
    eventType: event.eventType,
    occurredAt: event.occurredAt.toISOString(),
    nodeKey: projectedNodeKey,
    edgeId,
    summary: summarizeEvent(event.eventType, payload, nodeLabel, targetLabel, routeDecision),
    ...(routeDecision ? { routeDecision } : {}),
  };
}

function readEventEdgeId(eventType: string, payload: JsonRecord): string | null {
  if (eventType === "loop.node.completed") {
    const transition = isRecord(payload.transition) ? payload.transition : null;
    const edge = transition && isRecord(transition.edge) ? transition.edge : null;
    return readString(edge?.id) ?? null;
  }
  if (eventType === "loop.gate.routed" || eventType === "loop.gate.exhausted") {
    const result = isRecord(payload.result) ? payload.result : null;
    return readString(result?.selectedEdgeId) ?? null;
  }
  return null;
}

function summarizeEvent(
  eventType: string,
  payload: JsonRecord,
  nodeLabel: string | null | undefined,
  targetLabel: string | null | undefined,
  routeDecision?: LoopRouteAudit,
): string {
  const label = nodeLabel ?? "Loop 节点";
  const workerPayload = isRecord(payload.payloadSummary) ? payload.payloadSummary : {};
  if (eventType === "worker.assignment.claimed") return `${label} 已由 Linux Worker 领取`;
  if (eventType === "worker.stage.started") return `${label} 正在准备执行环境`;
  if (eventType === "worker.app_server.started") return `${label} 已启动 Codex 执行`;
  if (eventType === "worker.stage.completed") return `${label} 已完成 Worker 执行`;
  if (eventType === "worker.stage.failed") {
    const code = readString(workerPayload.code);
    return code ? `${label} 执行失败：${code}` : `${label} 执行失败`;
  }
  if (eventType === "worker.cleanup.started") return `${label} 正在清理执行环境`;
  if (eventType === "worker.cleanup.completed") return `${label} 已完成执行环境清理`;
  if (eventType === "loop.run.created") return "Loop 运行已创建";
  if (eventType === "loop.node.ready") return `${label} 已就绪`;
  if (eventType === "loop.node.activated") {
    const attemptNo = typeof payload.attemptNo === "number" ? payload.attemptNo : null;
    return attemptNo ? `${label} 开始第 ${attemptNo} 次尝试` : `${label} 开始执行`;
  }
  if (eventType === "loop.node.waiting") return `${label} 正在等待`;
  if (eventType === "loop.node.completed") {
    const transition = isRecord(payload.transition) ? payload.transition : null;
    if (transition?.status === "routed" && targetLabel) return `${label} 已完成，流转至 ${targetLabel}`;
    if (transition?.status === "exhausted") return `${label} 已完成，运行预算耗尽`;
    return `${label} 已完成`;
  }
  if (eventType === "loop.gate.routed") return targetLabel ? `${label} 已路由至 ${targetLabel}` : `${label} 已完成门禁路由`;
  if (eventType === "loop.gate.exhausted") return `${label} 返工预算已耗尽`;
  if (eventType === "loop.agent.route_decided") {
    return routeDecision ? `${label} 已作出路由决策：${routeDecision.reasonCode}` : `${label} 路由决策未通过校验`;
  }
  if (eventType === "loop.node.progressed") {
    const detail = readString(payload.payloadSummary);
    return detail ? `${label}：${detail}` : `${label} 已上报进度`;
  }
  return nodeLabel ? `${label} · ${eventType}` : eventType;
}

function projectRouteDecision(payload: JsonRecord, graph: LoopAuthoringGraph): LoopRouteAudit | undefined {
  const sourceNodeId = boundedString(payload.sourceNodeId, 96);
  const targetNodeId = boundedString(payload.targetNodeId, 96);
  const decisionId = boundedString(payload.decisionId, 191);
  const reasonCode = boundedString(payload.reasonCode, 96);
  const summary = boundedString(payload.summary, 4_000);
  const routerContractDigest = boundedString(payload.routerContractDigest, 128);
  const routerContractVersion = readNonNegativeInteger(payload.routerContractVersion);
  const confidence = typeof payload.confidence === "number" && Number.isFinite(payload.confidence)
    && payload.confidence >= 0 && payload.confidence <= 1 ? payload.confidence : null;
  const source = sourceNodeId ? graph.nodes.find((node) => stableNodeId(node) === sourceNodeId) : undefined;
  const target = targetNodeId ? graph.nodes.find((node) => stableNodeId(node) === targetNodeId) : undefined;
  const selectedEdgeId = boundedString(payload.selectedEdgeId, 96);
  const edge = selectedEdgeId
    ? graph.edges.find((candidate) => candidate.id === selectedEdgeId && candidate.source === source?.key && candidate.target === target?.key)
    : undefined;
  if (!source || !target || !decisionId || !reasonCode || !summary || !routerContractDigest
    || routerContractVersion === null || confidence === null || (selectedEdgeId !== null && !edge)) return undefined;
  return {
    decisionId,
    sourceNodeId: stableNodeId(source),
    targetNodeId: stableNodeId(target),
    reasonCode,
    summary,
    confidence,
    evidence: readEvidence(payload.evidence),
    routerContractVersion,
    routerContractDigest,
    selectedEdgeId: edge?.id ?? null,
    errorSummary: boundedString(payload.errorSummary, 2_000),
  };
}

function readEvidence(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim().slice(0, 512)] : []).slice(0, 20);
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function readNonNegativeInteger(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? value as number : null;
}

function stableNodeId(node: { key: string; nodeId?: string | undefined }): string {
  return node.nodeId ?? node.key;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value !== value.trim()) {
    throw validationError(`${name} is invalid`);
  }
  return value;
}

function decodedRouteText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string") throw validationError(`${name} is invalid`);
  try {
    return requiredText(decodeURIComponent(value), name, maxLength);
  } catch (error) {
    if (error instanceof URIError) throw validationError(`${name} is invalid`);
    throw error;
  }
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}
