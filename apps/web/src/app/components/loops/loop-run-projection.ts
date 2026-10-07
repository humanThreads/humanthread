import type { LoopRouteAudit, LoopRunProjection } from "@/lib/orchestration/loop-read-model";
import {
  loopChecklistCreatedPayloadSchema,
  loopChecklistUpdatedPayloadSchema,
  validateLoopChecklistTransition,
} from "@humanthread/shared";

type JsonRecord = Record<string, unknown>;

export interface PersistedLoopEvent {
  cursor: number;
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  sequence: number;
  occurredAt: string;
  payload: unknown;
}

export interface LoopRunViewerProjection extends LoopRunProjection {
  activeEdgeId: string | null;
}

export function createLoopRunViewerProjection(
  projection: LoopRunProjection,
): LoopRunViewerProjection {
  return { ...projection, activeEdgeId: null };
}

export function applyPersistedLoopEvent(
  projection: LoopRunViewerProjection,
  event: PersistedLoopEvent,
): LoopRunViewerProjection {
  if (event.cursor <= projection.eventCursor) return projection;
  if (event.cursor !== projection.eventCursor + 1) {
    throw Object.assign(new Error("Loop event cursor gap"), { code: "cursor_gap" });
  }

  if (event.eventType === "worker.app_server.notification") {
    return { ...projection, eventCursor: event.cursor };
  }

  const payload = isRecord(event.payload) ? event.payload : {};
  const nodeKey = readString(payload.nodeKey) ?? findNodeKey(projection, event.aggregateId);
  const routeDecision = event.eventType === "loop.agent.route_decided"
    ? readRouteDecision(projection, payload)
    : undefined;
  const edgeId = routeDecision?.selectedEdgeId ?? readEdgeId(event.eventType, payload);
  const edge = edgeId ? projection.edges.find((candidate) => candidate.edgeId === edgeId) : undefined;
  const targetNodeKey = event.eventType === "loop.node.completed"
    ? readTransitionTargetNodeKey(payload, edge)
    : edge?.target;
  const next: LoopRunViewerProjection = {
    ...projection,
    eventCursor: event.cursor,
    activities: [
      ...projection.activities,
      {
        id: event.id,
        cursor: event.cursor,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        nodeKey,
        edgeId,
        summary: summarizePersistedEvent(projection, event.eventType, payload, nodeKey, targetNodeKey, routeDecision),
        ...(routeDecision ? { routeDecision } : {}),
      },
    ],
  };

  if (event.eventType === "loop.node.ready" && nodeKey) {
    return updateNode(next, nodeKey, {
      status: "ready",
      currentNodeRunId: event.aggregateId,
      waitingReason: readString(payload.reason),
    });
  }
  if (event.eventType === "loop.node.activated" && nodeKey) {
    const attemptNo = readInteger(payload.attemptNo);
    return updateNode(next, nodeKey, {
      status: "running",
      currentNodeRunId: event.aggregateId,
      waitingReason: null,
      ...(attemptNo === null ? {} : { attemptNo }),
    });
  }
  if (event.eventType === "loop.node.waiting" && nodeKey) {
    return updateNode(next, nodeKey, {
      status: "waiting_input",
      waitingReason: readString(payload.waitingReason),
    });
  }
  if (event.eventType === "loop.node.failed" && nodeKey) {
    return updateNode(next, nodeKey, { status: "failed", waitingReason: null });
  }
  if (event.eventType === "loop.checklist.created" || event.eventType === "loop.checklist.updated") {
    return applyRuntimeChecklistEvent(next, event, nodeKey, payload);
  }
  if (event.eventType === "loop.node.completed") {
    return applyNodeCompletion(next, event, payload, nodeKey, edge);
  }
  if (event.eventType === "loop.gate.routed") {
    return applyGateRoute(next, event, payload, nodeKey, edge);
  }
  if (event.eventType === "loop.gate.exhausted") {
    const result = isRecord(payload.result) ? payload.result : {};
    const stopReason = readString(result.stopReason) ?? "返工预算已耗尽";
    const withRun = { ...next, run: { ...next.run, status: "exhausted", stopReason } };
    return nodeKey ? updateNode(withRun, nodeKey, { status: "succeeded", waitingReason: null }) : withRun;
  }
  if (event.eventType === "loop.agent.route_decided") {
    return edge ? markActiveEdge(next, edge.edgeId, event.occurredAt) : next;
  }
  return next;
}

function applyRuntimeChecklistEvent(
  projection: LoopRunViewerProjection,
  event: PersistedLoopEvent,
  nodeKey: string | null,
  payload: JsonRecord,
): LoopRunViewerProjection {
  if (!nodeKey) return projection;
  const summary = payload.payloadSummary;
  const node = projection.nodes.find((candidate) => candidate.nodeKey === nodeKey);
  if (!node || node.currentNodeRunId !== event.aggregateId) return projection;

  if (event.eventType === "loop.checklist.created") {
    const parsed = loopChecklistCreatedPayloadSchema.safeParse(summary);
    if (!parsed.success || !matchesChecklistNodeRun(projection, node, event, parsed.data) || node.checklist?.length) return projection;
    return updateNode(projection, nodeKey, { checklist: parsed.data.checklist });
  }

  const parsed = loopChecklistUpdatedPayloadSchema.safeParse(summary);
  if (!parsed.success || !matchesChecklistNodeRun(projection, node, event, parsed.data) || !node.checklist?.length) return projection;
  const current = node.checklist.find((item) => item.id === parsed.data.itemId);
  if (!current) return projection;
  try {
    validateLoopChecklistTransition(current.status, parsed.data.status);
  } catch {
    return projection;
  }
  return updateNode(projection, nodeKey, {
    checklist: node.checklist.map((item) => item.id === current.id ? {
      ...item,
      status: parsed.data.status,
      ...(parsed.data.reason === undefined ? { reason: undefined } : { reason: parsed.data.reason }),
      evidenceRefs: parsed.data.evidenceRefs,
    } : item),
  });
}

function matchesChecklistNodeRun(
  projection: LoopRunViewerProjection,
  node: LoopRunProjection["nodes"][number],
  event: PersistedLoopEvent,
  payload: { loopRunId: string; loopNodeRunId: string; attemptNo: number },
): boolean {
  return payload.loopRunId === projection.run.id
    && payload.loopNodeRunId === event.aggregateId
    && node.currentNodeRunId === event.aggregateId
    && payload.attemptNo === node.attemptNo;
}

function readTransitionTargetNodeKey(
  payload: JsonRecord,
  edge: LoopRunProjection["edges"][number] | undefined,
): string | undefined {
  const transition = isRecord(payload.transition) ? payload.transition : {};
  return readString(transition.targetNodeKey) ?? edge?.target;
}

function applyNodeCompletion(
  projection: LoopRunViewerProjection,
  event: PersistedLoopEvent,
  payload: JsonRecord,
  nodeKey: string | null,
  edge: LoopRunProjection["edges"][number] | undefined,
): LoopRunViewerProjection {
  const transition = isRecord(payload.transition) ? payload.transition : {};
  let next = nodeKey
    ? updateNode(projection, nodeKey, { status: "succeeded", waitingReason: null })
    : projection;
  if (transition.status === "routed") {
    const targetNodeKey = readString(transition.targetNodeKey) ?? edge?.target;
    if (edge) next = traverseEdge(next, edge.edgeId, event.occurredAt);
    if (targetNodeKey) {
      next = updateNode(next, targetNodeKey, { status: "ready", currentNodeRunId: null, waitingReason: null });
    }
    const counters = isRecord(transition.counters) ? transition.counters : {};
    next = {
      ...next,
      run: {
        ...next.run,
        status: "running",
        transitionCount: readInteger(counters.transitions) ?? next.run.transitionCount,
        repeatCount: readInteger(counters.repeats) ?? next.run.repeatCount,
      },
    };
  } else if (transition.status === "exhausted") {
    next = {
      ...next,
      run: {
        ...next.run,
        status: "exhausted",
        stopReason: readString(transition.reason) ?? "运行预算已耗尽",
      },
    };
  } else if (transition.status === "completed") {
    next = { ...next, run: { ...next.run, status: "completed" } };
  }
  return next;
}

function applyGateRoute(
  projection: LoopRunViewerProjection,
  event: PersistedLoopEvent,
  payload: JsonRecord,
  nodeKey: string | null,
  edge: LoopRunProjection["edges"][number] | undefined,
): LoopRunViewerProjection {
  const result = isRecord(payload.result) ? payload.result : {};
  let next = nodeKey
    ? updateNode(projection, nodeKey, { status: "succeeded", waitingReason: null })
    : projection;
  if (!edge || result.status !== "routed") return next;
  next = traverseEdge(next, edge.edgeId, event.occurredAt);
  return updateNode(next, edge.target, {
    status: "ready",
    currentNodeRunId: readString(result.targetNodeRunId),
    waitingReason: null,
  });
}

function traverseEdge(
  projection: LoopRunViewerProjection,
  edgeId: string,
  occurredAt: string,
): LoopRunViewerProjection {
  return {
    ...projection,
    activeEdgeId: edgeId,
    edges: projection.edges.map((edge) => edge.edgeId === edgeId
      ? { ...edge, traversalCount: edge.traversalCount + 1, lastTraversalAt: occurredAt }
      : edge),
  };
}

function markActiveEdge(
  projection: LoopRunViewerProjection,
  edgeId: string,
  occurredAt: string,
): LoopRunViewerProjection {
  return {
    ...projection,
    activeEdgeId: edgeId,
    edges: projection.edges.map((edge) => edge.edgeId === edgeId
      ? { ...edge, lastTraversalAt: occurredAt }
      : edge),
  };
}

function updateNode(
  projection: LoopRunViewerProjection,
  nodeKey: string,
  patch: Partial<LoopRunProjection["nodes"][number]>,
): LoopRunViewerProjection {
  const definedPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<LoopRunProjection["nodes"][number]>;
  return {
    ...projection,
    nodes: projection.nodes.map((node) => node.nodeKey === nodeKey ? { ...node, ...definedPatch } : node),
  };
}

function findNodeKey(projection: LoopRunProjection, aggregateId: string): string | null {
  return projection.nodes.find((node) => node.currentNodeRunId === aggregateId)?.nodeKey ?? null;
}

function readRouteDecision(projection: LoopRunProjection, payload: JsonRecord): LoopRouteAudit | undefined {
  const sourceNodeId = boundedString(payload.sourceNodeId, 96);
  const targetNodeId = boundedString(payload.targetNodeId, 96);
  const decisionId = boundedString(payload.decisionId, 191);
  const reasonCode = boundedString(payload.reasonCode, 96);
  const summary = boundedString(payload.summary, 4_000);
  const routerContractDigest = boundedString(payload.routerContractDigest, 128);
  const routerContractVersion = readInteger(payload.routerContractVersion);
  const confidence = typeof payload.confidence === "number" && Number.isFinite(payload.confidence)
    && payload.confidence >= 0 && payload.confidence <= 1 ? payload.confidence : null;
  const source = sourceNodeId ? projection.nodes.find((node) => (node.nodeId ?? node.nodeKey) === sourceNodeId) : undefined;
  const target = targetNodeId ? projection.nodes.find((node) => (node.nodeId ?? node.nodeKey) === targetNodeId) : undefined;
  const selectedEdgeId = boundedString(payload.selectedEdgeId, 96);
  const edge = selectedEdgeId
    ? projection.edges.find((candidate) => candidate.edgeId === selectedEdgeId && candidate.source === source?.nodeKey && candidate.target === target?.nodeKey)
    : undefined;
  if (!source || !target || !decisionId || !reasonCode || !summary || !routerContractDigest
    || routerContractVersion === null || confidence === null || (selectedEdgeId !== null && !edge)) return undefined;
  return {
    decisionId,
    sourceNodeId: source.nodeId ?? source.nodeKey,
    targetNodeId: target.nodeId ?? target.nodeKey,
    reasonCode,
    summary,
    confidence,
    evidence: readEvidence(payload.evidence),
    routerContractVersion,
    routerContractDigest,
    selectedEdgeId: edge?.edgeId ?? null,
    errorSummary: boundedString(payload.errorSummary, 2_000),
  };
}

function readEdgeId(eventType: string, payload: JsonRecord): string | null {
  if (eventType === "loop.node.completed") {
    const transition = isRecord(payload.transition) ? payload.transition : {};
    const edge = isRecord(transition.edge) ? transition.edge : {};
    return readString(edge.id);
  }
  if (eventType === "loop.gate.routed" || eventType === "loop.gate.exhausted") {
    const result = isRecord(payload.result) ? payload.result : {};
    return readString(result.selectedEdgeId);
  }
  return null;
}

function summarizePersistedEvent(
  projection: LoopRunProjection,
  eventType: string,
  payload: JsonRecord,
  nodeKey: string | null,
  targetKey: string | undefined,
  routeDecision?: LoopRouteAudit,
): string {
  const label = projection.nodes.find((node) => node.nodeKey === nodeKey)?.label ?? nodeKey ?? "Loop 节点";
  const target = projection.nodes.find((node) => node.nodeKey === targetKey)?.label ?? targetKey;
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
  if (eventType === "loop.checklist.created") {
    const checklist = isRecord(workerPayload) && Array.isArray(workerPayload.checklist) ? workerPayload.checklist : [];
    return `${label} 已生成 ${checklist.length} 项执行清单`;
  }
  if (eventType === "loop.checklist.updated") {
    const itemId = readString(workerPayload.itemId);
    const item = itemId ? projection.nodes.find((node) => node.nodeKey === nodeKey)?.checklist?.find((candidate) => candidate.id === itemId) : undefined;
    const status = readString(workerPayload.status);
    const statusLabel = checklistStatusSummary(status);
    return item && statusLabel ? `${label} · ${item.title}${statusLabel}` : `${label} 已更新执行清单`;
  }
  if (eventType === "loop.run.created") return "Loop 运行已创建";
  if (eventType === "loop.node.ready") return `${label} 已就绪`;
  if (eventType === "loop.node.activated") {
    const attemptNo = readInteger(payload.attemptNo);
    return attemptNo ? `${label} 开始第 ${attemptNo} 次尝试` : `${label} 开始执行`;
  }
  if (eventType === "loop.node.waiting") return `${label} 正在等待`;
  if (eventType === "loop.node.completed") return target ? `${label} 已完成，流转至 ${target}` : `${label} 已完成`;
  if (eventType === "loop.gate.routed") return target ? `${label} 已路由至 ${target}` : `${label} 已完成门禁路由`;
  if (eventType === "loop.gate.exhausted") return `${label} 返工预算已耗尽`;
  if (eventType === "loop.agent.route_decided") {
    return routeDecision ? `${label} 已作出路由决策：${routeDecision.reasonCode}` : `${label} 路由决策未通过校验`;
  }
  if (eventType === "loop.node.progressed") {
    const detail = readString(payload.payloadSummary);
    return detail ? `${label}：${detail}` : `${label} 已上报进度`;
  }
  return nodeKey ? `${label} · ${eventType}` : eventType;
}

function checklistStatusSummary(status: string | null): string | null {
  if (status === "not_started") return "未开始";
  if (status === "in_progress") return "进行中";
  if (status === "succeeded") return "已成功";
  if (status === "failed") return "失败";
  if (status === "skipped") return "已跳过";
  return null;
}

function readEvidence(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim().slice(0, 512)] : []).slice(0, 20);
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readInteger(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? value as number : null;
}
