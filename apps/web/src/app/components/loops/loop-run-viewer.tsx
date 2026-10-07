"use client";

import "@xyflow/react/dist/style.css";

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import type { LoopRouteAudit, LoopRunProjection } from "@/lib/orchestration/loop-read-model";
import { loopFailureReasonLabel } from "../../../lib/orchestration/loop-status-reason";
import type { WorkflowInteractionField, WorkflowInteractionMessageInput, WorkflowInteractionView } from "@humanthread/shared";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowDownLeft,
  Ban,
  Bot,
  Check,
  CircleDot,
  Clock3,
  FileSearch,
  GitBranch,
  MonitorCog,
  RotateCcw,
  ShieldCheck,
  UserRoundCheck,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoopAttemptLiveStream } from "./loop-attempt-live-stream";
import { useRouter } from "next/navigation";
import { StatusPill, WorkbenchButton } from "../workbench-ui";
import { ApprovalDecisionDialog } from "../approval-decision-dialog";
import { LoopTimeline, type LoopTimelineItemInput } from "./loop-timeline";
import { WorkflowApprovalControls } from "./workflow-approval-controls";
import { WorkflowInteractionComposer } from "./workflow-interaction-composer";
import { WorkflowInteractionThread } from "./workflow-interaction-thread";
import { layoutLoopNodes } from "./loop-graph-layout";
import {
  applyPersistedLoopEvent,
  createLoopRunViewerProjection,
  type PersistedLoopEvent,
} from "./loop-run-projection";
import {
  type LoopEventBatchFetcher,
  useLoopEventStream,
} from "./use-loop-event-stream";

type RuntimeVisualStatus = "current" | "completed" | "failed" | "waiting" | "exhausted";

type RuntimeNodeData = {
  label: string;
  type: LoopRunProjection["nodes"][number]["type"];
  status: string;
  visualStatus: RuntimeVisualStatus;
  compact: boolean;
  hasFeedbackSource: boolean;
  hasFeedbackTarget: boolean;
  childRun: NonNullable<LoopRunProjection["childRuns"]>[number] | null;
  quickApproval: { open(): void } | null;
};

type LoopExecutionOption = {
  type: "local_agent" | "linux_worker_pool";
  id: string;
  displayName: string;
  ready: boolean;
  reason: string | null;
};

function findWaitingApproval(projection: LoopRunProjection) {
  const waitingNodeRunIds = new Set(projection.nodes
    .filter((node) => node.type === "human_gate" && node.status === "waiting_approval" && node.currentNodeRunId)
    .map((node) => node.currentNodeRunId!));
  return [...(projection.pendingApprovals ?? [])]
    .filter((approval) => approval.type === "loop_human_gate" && approval.status === "pending" && approval.loopNodeRunId && waitingNodeRunIds.has(approval.loopNodeRunId))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0] ?? null;
}

const NODE_META = {
  start: { icon: CircleDot, caption: "入口" },
  agent_action: { icon: Bot, caption: "Agent 执行" },
  platform_action: { icon: MonitorCog, caption: "平台执行" },
  condition: { icon: GitBranch, caption: "条件路由" },
  policy_gate: { icon: ShieldCheck, caption: "自动门禁" },
  human_gate: { icon: UserRoundCheck, caption: "人工确认" },
  wait_callback: { icon: Clock3, caption: "等待事件" },
  subloop_call: { icon: Workflow, caption: "任务 SubLoop" },
  end: { icon: Check, caption: "终点" },
} as const;

const STATUS_META: Record<RuntimeVisualStatus, { label: string; classes: string }> = {
  current: { label: "当前", classes: "border-[#0969da] bg-[#ddf4ff] text-[#0a3069]" },
  completed: { label: "完成", classes: "border-[#2da44e] bg-[#dafbe1] text-[#116329]" },
  failed: { label: "失败", classes: "border-[#cf222e] bg-[#ffebe9] text-[#cf222e]" },
  waiting: { label: "等待", classes: "border-[#d4a72c] bg-[#fff8c5] text-[#7d4e00]" },
  exhausted: { label: "耗尽", classes: "border-[#8250df] bg-[#fbefff] text-[#6639ba]" },
};

/**
 * `waiting` covers runs parked on human intervention. They have no live
 * executor, and the usual cause is a transient upstream failure that used up
 * the node's attempts; recovery should resume from that node rather than
 * forcing a fresh run that repeats every successful stage. `running` stays
 * excluded because a Worker still holds the lease.
 */
const RESTARTABLE_RUN_STATUSES = new Set(["failed", "exhausted", "cancelled", "completed", "waiting"]);

function nodeRestartBlockReason(
  projection: LoopRunProjection,
  node: LoopRunProjection["nodes"][number] | undefined,
): string | null {
  if (!node) return "节点不存在";
  if (!RESTARTABLE_RUN_STATUSES.has(projection.run.status)) return "运行尚未结束";
  if (node.type === "start" || node.type === "end") return "边界节点不支持从该处启动";
  if (!node.currentNodeRunId) return "该节点尚未执行";
  return null;
}

type LoopDetailTab = "live" | "evidence" | "timeline" | "run";

const LOOP_DETAIL_TABS = [
  ["live", "实时执行"],
  ["evidence", "节点与证据"],
  ["timeline", "工作流时间线"],
  ["run", "运行详情"],
] as const satisfies ReadonlyArray<readonly [LoopDetailTab, string]>;

const OPEN_RUN_STATUSES = new Set(["pending", "running", "waiting", "ready", "queued"]);

/**
 * Running Runs open on the live view; terminal and historical Runs, including
 * pre-stream history, open on node evidence where the durable record lives.
 */
function defaultLoopDetailTab(projection: LoopRunProjection): LoopDetailTab {
  const hasActiveAttempt = projection.nodes.some((node) => (
    OPEN_RUN_STATUSES.has(node.status)
    && node.attempts.some((attempt) => attempt.status === "running" || attempt.status === "starting")
  ));
  return OPEN_RUN_STATUSES.has(projection.run.status) && hasActiveAttempt ? "live" : "evidence";
}

export function LoopRunViewer({
  initialProjection,
  fetchBatch,
  loadProjection = loadLoopRunProjection,
  pollIntervalMs,
}: {
  initialProjection: LoopRunProjection;
  fetchBatch?: LoopEventBatchFetcher;
  loadProjection?: (loopRunId: string) => Promise<LoopRunProjection>;
  pollIntervalMs?: number;
}) {
  const router = useRouter();
  const [projection, setProjection] = useState(() => createLoopRunViewerProjection(initialProjection));
  const projectionRef = useRef(projection);
  const reloadRef = useRef<Promise<void> | null>(null);
  const [selectedNodeKey, setSelectedNodeKey] = useState(
    initialProjection.nodes.find((node) => normalizeNodeStatus(node.status) === "current")?.nodeKey
      ?? initialProjection.nodes[0]?.nodeKey
      ?? null,
  );
  const [timelineItems, setTimelineItems] = useState<LoopTimelineItemInput[]>([]);
  const [timelineQuery, setTimelineQuery] = useState("");
  const [currentInteraction, setCurrentInteraction] = useState<WorkflowInteractionView | null>(null);
  const [interactionCapabilities, setInteractionCapabilities] = useState({ canReply: false, canConfirm: false, canDecideApproval: false });
  const [detailTab, setDetailTab] = useState<LoopDetailTab>(() => defaultLoopDetailTab(initialProjection));
  // Once the user chooses a tab, later event/auto-refresh cycles must not pull
  // them back to the status-derived default.
  const detailTabChosenRef = useRef(false);
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [retryingChildRunId, setRetryingChildRunId] = useState<string | null>(null);
  const [cancellingRun, setCancellingRun] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [nodeMenu, setNodeMenu] = useState<{ nodeKey: string; x: number; y: number } | null>(null);
  const [restartTargetKey, setRestartTargetKey] = useState<string | null>(null);
  const [restartReason, setRestartReason] = useState("");
  const [restartPending, setRestartPending] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(() => findWaitingApproval(initialProjection)?.id ?? null);
  const [recoveryNodeKey, setRecoveryNodeKey] = useState<string | null>(null);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const compact = useMediaQuery("(max-width: 767px)");

  useEffect(() => {
    projectionRef.current = projection;
  }, [projection]);

  const waitingApproval = useMemo(() => findWaitingApproval(projection), [projection]);
  const selectedApproval = (projection.pendingApprovals ?? []).find((approval) => approval.id === selectedApprovalId) ?? null;

  const openApproval = useCallback((approvalId: string) => setSelectedApprovalId(approvalId), []);
  const closeApproval = useCallback(() => setSelectedApprovalId(null), []);

  useEffect(() => {
    let active = true;
    const search = new URLSearchParams({ limit: "100" });
    if (timelineQuery.trim()) search.set("query", timelineQuery.trim());
    void fetch(`/api/loop-runs/${encodeURIComponent(initialProjection.run.id)}/timeline?${search.toString()}`, { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Timeline unavailable");
        return response.json() as Promise<{ items?: LoopTimelineItemInput[] }>;
      })
      .then((body) => {
        if (!active) return;
        setTimelineItems(Array.isArray(body.items) ? body.items : []);
      })
      .catch(() => {
        if (active) setTimelineItems([]);
      });
    return () => { active = false; };
  }, [initialProjection.run.id, timelineQuery]);

  const refreshInteractions = useCallback(async () => {
    const response = await fetch(`/api/loop-runs/${encodeURIComponent(projectionRef.current.run.id)}/interactions`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("交互不可用");
    const body = await response.json() as { interactions?: WorkflowInteractionView[]; capabilities?: { canReply?: boolean; canConfirm?: boolean; canDecideApproval?: boolean } };
    const interactions = Array.isArray(body.interactions) ? body.interactions : [];
    const requestedInteractionId = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("interaction");
    setCurrentInteraction(
      (requestedInteractionId ? interactions.find((item) => item.id === requestedInteractionId) : null)
      ?? interactions.find((item) => item.status === "open")
      ?? interactions.at(-1)
      ?? null,
    );
    setInteractionCapabilities({
      canReply: body.capabilities?.canReply === true,
      canConfirm: body.capabilities?.canConfirm === true,
      canDecideApproval: body.capabilities?.canDecideApproval === true,
    });
  }, []);

  useEffect(() => { void refreshInteractions().catch(() => setCurrentInteraction(null)); }, [refreshInteractions, initialProjection.run.id]);

  const mutateInteraction = useCallback(async (path: string, body: Record<string, unknown>) => {
    if (!currentInteraction) return;
    setInteractionError(null);
    const response = await fetch(`/api/loop-runs/${encodeURIComponent(projectionRef.current.run.id)}/interactions/${encodeURIComponent(currentInteraction.id)}${path}`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body),
    });
    const responseBody = await response.json().catch(() => ({})) as { code?: unknown; error?: unknown };
    if (!response.ok) {
      const stale = response.status === 409 || responseBody.code === "version_conflict";
      setInteractionError(stale
        ? "人工介入已过期或运行状态已变化，页面已刷新，请重新确认当前状态。"
        : typeof responseBody.error === "string" ? responseBody.error : "交互更新失败");
      if (stale) await refreshInteractions().catch(() => undefined);
      return;
    }
    await Promise.all([refreshInteractions(), reloadTimeline(projectionRef.current.run.id, setTimelineItems)]);
  }, [currentInteraction, refreshInteractions]);

  const submitInteractionMessage = useCallback((message: WorkflowInteractionMessageInput) => mutateInteraction("/messages", { commandId: createUiCommandId(), message }), [mutateInteraction]);
  const confirmInteraction = useCallback((reason: string) => mutateInteraction("/confirm", { commandId: createUiCommandId(), expectedVersion: currentInteraction?.version ?? 0, reason }), [currentInteraction?.version, mutateInteraction]);
  const decideInteraction = useCallback((decision: "approved" | "rejected", reason: string, selectedEdgeId: string) => mutateInteraction("/decision", { commandId: createUiCommandId(), expectedVersion: currentInteraction?.version ?? 0, decision, reason, selectedEdgeId }), [currentInteraction?.version, mutateInteraction]);
  const confirmOwnPosition = useCallback(() => {
    if (!currentInteraction) return;
    return mutateInteraction("/speaker-confirmation", { commandId: createUiCommandId() });
  }, [currentInteraction, mutateInteraction]);
  const submitIntervention = useCallback((
    action: "resume_checkpoint" | "route_upstream" | "terminate",
    reason: string,
    manualConflict: boolean,
  ) => {
    if (!currentInteraction) return;
    const resolution = action === "route_upstream"
      ? {
          type: action,
          targetNodeKey: interventionRouteTarget(projectionRef.current, selectedNodeKey),
        }
      : { type: action };
    return mutateInteraction("/submit", {
      commandId: createUiCommandId(),
      expectedVersion: currentInteraction.version,
      reason,
      action: resolution,
      manualConflict,
    });
  }, [currentInteraction, mutateInteraction, selectedNodeKey]);
  const delegateConflictSpeaker = useCallback((speakerUserId: string) => {
    if (!currentInteraction) return;
    return mutateInteraction("/conflict-speaker", {
      commandId: createUiCommandId(),
      expectedVersion: currentInteraction.version,
      speakerUserId,
    });
  }, [currentInteraction, mutateInteraction]);

  const reload = useCallback(async () => {
    if (reloadRef.current) return reloadRef.current;
    const pending = (async () => {
      const snapshot = await loadProjection(projectionRef.current.run.id);
      const next = createLoopRunViewerProjection(snapshot);
      projectionRef.current = next;
      setProjection(next);
    })().finally(() => {
      reloadRef.current = null;
    });
    reloadRef.current = pending;
    return pending;
  }, [loadProjection]);

  const confirmRestart = useCallback(async () => {
    const targetNodeKey = restartTargetKey;
    if (!targetNodeKey || restartPending) return;
    setRestartPending(true);
    setRestartError(null);
    try {
      const response = await fetch(`/api/loop-runs/${encodeURIComponent(projectionRef.current.run.id)}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: "restart_from_node",
          targetNodeKey,
          reason: restartReason.trim(),
          commandId: createUiCommandId(),
        }),
      });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "从节点重新启动失败");
      setNodeMenu(null);
      setRestartTargetKey(null);
      setRestartReason("");
      await reload();
      router.refresh();
    } catch (error) {
      setRestartError(error instanceof Error ? error.message : "从节点重新启动失败");
    } finally {
      setRestartPending(false);
    }
  }, [reload, restartPending, restartReason, restartTargetKey, router]);

  const onApprovalDecided = useCallback((approvalId: string) => {
    const current = projectionRef.current;
    const withoutApproval = {
      ...current,
      pendingApprovals: (current.pendingApprovals ?? []).filter((approval) => approval.id !== approvalId),
    };
    projectionRef.current = withoutApproval;
    setProjection(withoutApproval);
    setSelectedApprovalId(null);
    void Promise.all([
      reload(),
      reloadTimeline(current.run.id, setTimelineItems),
      refreshInteractions().catch(() => undefined),
    ]).then(() => {
      const nextNode = projectionRef.current.nodes.find((node) => normalizeNodeStatus(node.status) === "current")
        ?? projectionRef.current.nodes.find((node) => node.status === "waiting_approval");
      if (nextNode) setSelectedNodeKey(nextNode.nodeKey);
    });
  }, [refreshInteractions, reload]);

  const onEvents = useCallback(async (events: PersistedLoopEvent[]) => {
    if (events.some((event) => isChildLoopRelationshipEvent(event, projectionRef.current))) {
      await reload();
      return;
    }
    let next = projectionRef.current;
    try {
      for (const event of events) next = applyPersistedLoopEvent(next, event);
    } catch (cause) {
      if (isCursorGap(cause)) await reload();
      else throw cause;
      return;
    }
    projectionRef.current = next;
    setProjection(next);
  }, [reload]);

  const stream = useLoopEventStream({
    loopRunId: projection.run.id,
    initialCursor: projection.eventCursor,
    onEvents,
    onGap: reload,
    ...(fetchBatch ? { fetchBatch } : {}),
    ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
  });

  const autoPositions = useMemo(() => layoutLoopNodes({
    nodes: projection.nodes.map((node) => node.nodeKey),
    edges: projection.edges.map((edge) => ({ source: edge.source, target: edge.target, kind: edge.kind })),
    compact,
  }), [compact, projection.edges, projection.nodes]);
  const flowNodes = useMemo(() => projection.nodes.map((node, index) => {
    const childRun = node.currentNodeRunId
      ? projection.childRuns?.find((child) => child.parentNodeRunId === node.currentNodeRunId) ?? null
      : null;
    return {
      id: node.nodeKey,
      type: "runtime",
      width: 184,
      height: childRun?.progress && childRun.nodes ? 160 : childRun ? 98 : waitingApproval?.loopNodeRunId === node.currentNodeRunId ? 100 : 70,
      position: nodePositions[node.nodeKey] ?? autoPositions[node.nodeKey] ?? (compact ? { x: 48, y: 36 + index * 152 } : { x: 64 + index * 232, y: 96 }),
      data: {
      label: node.label,
      type: node.type,
      status: node.status,
      visualStatus: normalizeNodeStatus(node.status),
      compact,
      hasFeedbackSource: projection.edges.some((edge) => edge.kind === "feedback" && edge.source === node.nodeKey),
      hasFeedbackTarget: projection.edges.some((edge) => edge.kind === "feedback" && edge.target === node.nodeKey),
      childRun,
      quickApproval: waitingApproval?.loopNodeRunId === node.currentNodeRunId
        ? { open: () => openApproval(waitingApproval.id) }
        : null,
      } satisfies RuntimeNodeData,
      selected: selectedNodeKey === node.nodeKey,
    };
  }), [autoPositions, compact, nodePositions, openApproval, projection.childRuns, projection.edges, projection.nodes, selectedNodeKey, waitingApproval]);

  const flowEdges = useMemo(() => projection.edges.map((edge) => ({
    id: edge.edgeId,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    animated: !reducedMotion && projection.activeEdgeId === edge.edgeId,
    label: edge.limit === null
      ? `${edge.outcome} · ${edge.traversalCount}`
      : `${edge.outcome} · ${edge.traversalCount}/${edge.limit}`,
    className: edge.kind === "feedback" ? "loop-runtime-feedback-edge" : "loop-runtime-edge",
    markerEnd: { type: MarkerType.ArrowClosed },
    ...(edge.kind === "feedback" ? { sourceHandle: "feedback-source", targetHandle: "feedback-target" } : {}),
    style: {
      stroke: projection.activeEdgeId === edge.edgeId ? "#0969da" : edge.kind === "feedback" ? "#8250df" : "#8c959f",
      strokeWidth: projection.activeEdgeId === edge.edgeId ? 2.5 : 1.5,
      strokeDasharray: edge.kind === "feedback" ? "7 4" : undefined,
    },
    labelStyle: { fill: "#57606a", fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: "#ffffff", fillOpacity: 0.92 },
    data: { traversalCount: edge.traversalCount, limit: edge.limit, kind: edge.kind },
  })), [projection.activeEdgeId, projection.edges, reducedMotion]);

  const selectedNode = projection.nodes.find((node) => node.nodeKey === selectedNodeKey) ?? null;
  const selectedChildRun = selectedNode?.currentNodeRunId
    ? projection.childRuns?.find((child) => child.parentNodeRunId === selectedNode.currentNodeRunId) ?? null
    : null;
  const retryTarget = useMemo(() => projection.parentRun
    && projection.parentRun.status === "waiting"
    && isRetryableChildStatus(projection.run.status)
    ? { id: projection.run.id, parentLoopRunId: projection.parentRun.id }
    : selectedChildRun
      && projection.run.status === "waiting"
      && isRetryableChildStatus(selectedChildRun.status)
      ? { id: selectedChildRun.id, parentLoopRunId: projection.run.id }
      : null, [projection.parentRun, projection.run.id, projection.run.status, selectedChildRun]);
  const canRestartTaskLoop = !projection.parentRun
    && Boolean(projection.run.taskId)
    && ["failed", "cancelled", "exhausted"].includes(projection.run.status);
  const canCancelRun = Boolean(projection.run.taskId)
    && !["completed", "failed", "cancelled", "exhausted"].includes(projection.run.status);
  const recoveryNodes = useMemo(() => projection.nodes.filter((node) => node.type !== "start"), [projection.nodes]);
  const defaultRecoveryNodeKey = useMemo(() => (
    projection.nodes.find((node) => normalizeNodeStatus(node.status) === "failed")?.nodeKey
      ?? projection.nodes.find((node) => normalizeNodeStatus(node.status) === "current")?.nodeKey
      ?? recoveryNodes[0]?.nodeKey
      ?? null
  ), [projection.nodes, recoveryNodes]);
  const selectedRecoveryNodeKey = recoveryNodeKey && recoveryNodes.some((node) => node.nodeKey === recoveryNodeKey)
    ? recoveryNodeKey
    : defaultRecoveryNodeKey;
  const retryChild = useCallback(async () => {
    if (!retryTarget || retryingChildRunId) return;
    setRetryingChildRunId(retryTarget.id);
    setRetryError(null);
    try {
      const response = await fetch(`/api/loop-runs/${encodeURIComponent(retryTarget.id)}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          command: "retry_child",
          commandId: createUiCommandId(),
          ...(selectedRecoveryNodeKey ? { targetNodeId: selectedRecoveryNodeKey } : {}),
        }),
      });
      const body = await response.json() as { ok?: boolean; result?: { childLoopRunId?: string }; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "任务流程重试失败");
      const childLoopRunId = body.result?.childLoopRunId ?? retryTarget.id;
      router.push(`/loop-runs/${encodeURIComponent(childLoopRunId)}`);
      router.refresh();
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "任务流程重试失败");
    } finally {
      setRetryingChildRunId(null);
    }
  }, [retryTarget, retryingChildRunId, router, selectedRecoveryNodeKey]);
  const restartTaskLoop = useCallback(async () => {
    const taskId = projection.run.taskId;
    if (!taskId || retryingChildRunId) return;
    setRetryingChildRunId(projection.run.id);
    setRetryError(null);
    try {
      const optionsResponse = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/loop/execution-options`, { headers: { accept: "application/json" } });
      const optionsBody = await optionsResponse.json() as { ok?: boolean; options?: LoopExecutionOption[]; defaultTarget?: LoopExecutionOption | null; error?: string };
      if (!optionsResponse.ok || !optionsBody.ok || !Array.isArray(optionsBody.options)) {
        throw new Error(optionsBody.error ?? "执行目标暂不可用");
      }
      const target = optionsBody.defaultTarget && optionsBody.defaultTarget.ready
        ? optionsBody.defaultTarget
        : optionsBody.options.find((option) => option.ready) ?? null;
      if (!target) throw new Error("没有可用的执行目标");
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/loop`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          command: "start",
          commandId: createUiCommandId(),
          executionTarget: target.type === "linux_worker_pool"
            ? { type: target.type, workerPoolId: target.id }
            : { type: target.type, agentProfileId: target.id },
        }),
      });
      const body = await response.json() as { ok?: boolean; result?: { id?: string }; error?: string };
      if (!response.ok || !body.ok || !body.result?.id) throw new Error(body.error ?? "任务 Loop 重启失败");
      router.push(`/loop-runs/${encodeURIComponent(body.result.id)}`);
      router.refresh();
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "任务 Loop 重启失败");
    } finally {
      setRetryingChildRunId(null);
    }
  }, [projection.run.id, projection.run.taskId, retryingChildRunId, router]);
  const cancelRun = useCallback(async () => {
    const taskId = projection.run.taskId;
    if (!taskId || cancellingRun) return;
    setCancellingRun(true);
    setRetryError(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/loop`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ command: "cancel", loopRunId: projection.run.id }),
      });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Loop 取消失败");
      await reload();
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "Loop 取消失败");
    } finally {
      setCancellingRun(false);
    }
  }, [cancellingRun, projection.run.id, projection.run.taskId, reload]);
  const latestRouteDecision = [...projection.activities].reverse().find((activity) => activity.routeDecision)?.routeDecision ?? null;
  const completedCount = projection.nodes.filter((node) => normalizeNodeStatus(node.status) === "completed").length;
  const progress = projection.nodes.length === 0 ? 0 : Math.round((completedCount / projection.nodes.length) * 100);

  return (
    <div className="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto] overflow-y-auto bg-[#f6f8fa] lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
      <main className="grid min-w-0 grid-rows-[auto_360px] overflow-visible lg:min-h-0 lg:grid-rows-[auto_minmax(360px,1fr)] lg:overflow-hidden">
        <header className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3 border-b border-[#d0d7de] bg-white px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-base font-semibold text-[#24292f]">Loop 运行 {projection.run.id}</h1>
              <RunStatus status={projection.run.status} />
            </div>
            <p className="mt-1 text-xs text-[#57606a]">定义 v{projection.definitionVersion} · 投影 v{projection.projectionVersion} · 游标 {projection.eventCursor}</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {waitingApproval ? <WorkbenchButton onClick={() => openApproval(waitingApproval.id)} size="small" type="button" variant="primary"><UserRoundCheck aria-hidden="true" className="h-3.5 w-3.5" />立即审批</WorkbenchButton> : null}
            {canCancelRun ? <WorkbenchButton disabled={cancellingRun || retryingChildRunId !== null} onClick={() => void cancelRun()} size="small" type="button"><Ban aria-hidden="true" className="h-3.5 w-3.5" />{cancellingRun ? "正在取消" : "取消 Loop"}</WorkbenchButton> : null}
            {retryTarget ? (
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-[#57606a]">
                  恢复节点
                  <select aria-label="恢复节点" className="ml-1 rounded-md border border-[#d0d7de] bg-white px-2 py-1 text-xs text-[#24292f]" value={selectedRecoveryNodeKey ?? ""} onChange={(event) => setRecoveryNodeKey(event.currentTarget.value)}>
                    {recoveryNodes.map((node) => <option key={node.nodeKey} value={node.nodeKey}>{node.label}</option>)}
                  </select>
                </label>
                <WorkbenchButton disabled={retryingChildRunId !== null || !selectedRecoveryNodeKey} onClick={() => void retryChild()} size="small" type="button" variant="primary">
                  <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />{retryingChildRunId ? "正在恢复" : "从所选节点恢复"}
                </WorkbenchButton>
              </div>
            ) : null}
            {projection.parentRun ? (
              <WorkbenchButton href={`/loop-runs/${encodeURIComponent(projection.parentRun.id)}`} size="small">
                <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />返回项目流程
              </WorkbenchButton>
            ) : null}
            {selectedChildRun ? (
              <WorkbenchButton href={`/loop-runs/${encodeURIComponent(selectedChildRun.id)}`} size="small" variant="primary">
                进入任务流程<ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </WorkbenchButton>
            ) : null}
            <div className="flex items-center gap-2 text-xs text-[#57606a]" role="status" aria-live="polite">
              <span className={`h-2 w-2 rounded-full ${stream.state === "connected" ? "bg-[#1f883d]" : "bg-[#bf8700]"}`} />
              {stream.state === "connected" ? "事件流已连接" : stream.state === "connecting" ? "正在连接" : "正在重连"}
            </div>
            {retryError ? <span className="basis-full text-right text-xs text-[#cf222e]" role="alert">{retryError}</span> : null}
          </div>
        </header>

        <section
          data-testid="loop-run-canvas"
          data-motion={reducedMotion ? "reduced" : "full"}
          aria-label="Loop 运行图区域"
          className="relative min-h-0 min-w-0 bg-white"
        >
          <ReactFlow
            key={compact ? "compact" : "wide"}
            aria-label="Loop 运行图"
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={{ runtime: RuntimeNode }}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            fitView
            fitViewOptions={{ padding: compact ? 0.2 : 0.12, maxZoom: 1.1 }}
            minZoom={0.35}
            maxZoom={1.5}
            onNodeClick={(_, node) => setSelectedNodeKey(node.id)}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              setSelectedNodeKey(node.id);
              setNodeMenu({ nodeKey: node.id, x: event.clientX, y: event.clientY });
            }}
            onPaneClick={() => setNodeMenu(null)}
            onNodeDragStop={(_, node) => setNodePositions((current) => ({ ...current, [node.id]: node.position }))}
          >
            <Background color="#d8dee4" gap={24} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
          {nodeMenu ? (() => {
            const menuNode = projection.nodes.find((candidate) => candidate.nodeKey === nodeMenu.nodeKey);
            const blockReason = nodeRestartBlockReason(projection, menuNode);
            return <div role="menu" aria-label="节点操作" style={{ position: "fixed", left: nodeMenu.x, top: nodeMenu.y, zIndex: 60 }} className="min-w-44 rounded-md border border-[#d0d7de] bg-white p-1 text-sm shadow-lg">
              <button
                type="button"
                role="menuitem"
                disabled={Boolean(blockReason)}
                title={blockReason ?? undefined}
                onClick={() => {
                  if (blockReason) return;
                  setNodeMenu(null);
                  setRestartError(null);
                  setRestartReason("");
                  setRestartTargetKey(nodeMenu.nodeKey);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[#24292f] hover:bg-[#f6f8fa] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />从该节点启动
              </button>
              {blockReason ? <p className="px-2 py-1 text-[11px] text-[#8c959f]">{blockReason}</p> : null}
            </div>;
          })() : null}
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2" aria-label="运行图图例">
            <span className="inline-flex items-center gap-1 border border-[#d0d7de] bg-white/95 px-2 py-1 text-[11px] font-medium text-[#57606a]"><ArrowDownLeft className="h-3 w-3 text-[#8250df]" />虚线为返工路径</span>
            <span className="inline-flex items-center gap-1 border border-[#d0d7de] bg-white/95 px-2 py-1 text-[11px] font-medium text-[#57606a]"><RotateCcw className="h-3 w-3" />数字为经过次数 / 上限</span>
          </div>
          <button className="absolute right-3 top-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d0d7de] bg-white px-3 text-xs font-semibold text-[#24292f] shadow-sm hover:bg-[#f6f8fa]" onClick={() => setNodePositions({})} type="button"><RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />重置布局</button>
        </section>
      </main>

      <aside className="min-w-0 overflow-visible border-t border-[#d0d7de] bg-white lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0" aria-label="Loop 运行详情">
        {isTerminalFailure(projection.run.status) ? <section className="border-b border-[#f1aeb5] bg-[#fff5f5] px-4 py-3" aria-label="Loop 失败恢复">
          <div className="flex items-start gap-2 text-sm text-[#cf222e]"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-semibold">{loopFailureReasonLabel(projection.run.statusReason)}</p><p className="mt-1 text-xs leading-5 text-[#57606a]">{canRestartTaskLoop ? "未创建 Agent 运行。重新开始将创建新的任务 Loop，原失败记录会保留供排查。" : "请查看失败节点和运行证据；若这是子流程，请从父流程选择恢复节点。"}</p></div></div>
          {canRestartTaskLoop ? <WorkbenchButton className="mt-3" disabled={retryingChildRunId !== null} onClick={() => void restartTaskLoop()} size="small" type="button" variant="primary"><RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />重新开始任务 Loop</WorkbenchButton> : null}
        </section> : null}
        <section className="border-b border-[#d0d7de] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[#24292f]">运行进度</h2>
            <span className="text-xs font-semibold tabular-nums text-[#24292f]">{completedCount}/{projection.nodes.length}</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#d8dee4]" aria-label={`运行进度 ${progress}%`} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-[#1f883d] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
          </div>
          {waitingApproval ? <button type="button" onClick={() => openApproval(waitingApproval.id)} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#1f883d] px-3 text-sm font-semibold text-white hover:bg-[#1a7f37] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f883d]"><UserRoundCheck aria-hidden="true" className="h-4 w-4" />立即审批</button> : null}
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            <div><dt className="text-[#6e7781]">节点跳转</dt><dd className="mt-1 font-semibold tabular-nums text-[#24292f]">{projection.run.transitionCount}</dd></div>
            <div><dt className="text-[#6e7781]">返工次数</dt><dd className="mt-1 font-semibold tabular-nums text-[#24292f]">{projection.run.repeatCount}</dd></div>
            {projection.run.executionTarget ? <div className="col-span-2"><dt className="text-[#6e7781]">执行目标</dt><dd className="mt-1 break-words font-semibold text-[#24292f]">{loopExecutionTargetLabel(projection.run.executionTarget)}</dd></div> : null}
          </dl>
          {projection.run.stopReason ? (
            <div className="mt-4 flex gap-2 border border-[#d0d7de] bg-[#f6f8fa] p-3 text-xs leading-5 text-[#24292f]">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#9a6700]" />
              <div><div className="font-semibold">停止原因</div><div className="mt-0.5 break-words text-[#57606a]">{projection.run.stopReason}</div></div>
            </div>
          ) : null}
        </section>

        <div aria-label="Loop 详情视图" className="sticky top-0 z-10 grid grid-cols-2 border-b border-[#d0d7de] bg-white sm:grid-cols-4" role="tablist">
          {LOOP_DETAIL_TABS.map(([key, label]) => <button aria-selected={detailTab === key} className={`min-w-0 px-2 py-3 text-xs font-semibold ${detailTab === key ? "border-b-2 border-[#0969da] text-[#0969da]" : "text-[#57606a] hover:bg-[#f6f8fa]"}`} key={key} onClick={() => { detailTabChosenRef.current = true; setDetailTab(key); }} role="tab" type="button">{label}</button>)}
        </div>
        {detailTab === "live" ? (
          selectedNode?.attempts.length
            ? <LoopAttemptLiveStream
                loopRunId={projection.run.id}
                attempt={selectedNode.attempts[selectedNode.attempts.length - 1]!}
              />
            : <section className="px-4 py-4" aria-label="实时执行"><p className="text-sm text-[#57606a]">该节点尚未开始执行。</p></section>
        ) : null}
        {detailTab === "run" ? <section className="px-4 py-4" aria-label="运行详情">
          <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-[#24292f]">运行活动</h2><span className="text-xs tabular-nums text-[#57606a]">{projection.activities.length} 条</span></div>
          {projection.activities.length === 0 ? <p className="text-sm text-[#57606a]">等待首个运行事件。</p> : <ol className="grid gap-3">{projection.activities.slice(-100).reverse().map((activity) => <li className="border-l-2 border-[#d0d7de] pl-3 text-xs" key={`${activity.cursor}:${activity.id}`}><div className="font-medium text-[#24292f]">{activity.summary}</div><div className="mt-1 text-[#6e7781]">#{activity.cursor} · {formatTime(activity.occurredAt)}</div></li>)}</ol>}
          <RouteDecisionPanel decision={latestRouteDecision} />
        </section> : null}
        {detailTab === "evidence" ? <section className="px-4 py-4">
          <div className="flex items-center gap-2">
            <FileSearch aria-hidden="true" className="h-4 w-4 text-[#57606a]" />
            <h2 className="text-sm font-semibold text-[#24292f]">节点尝试与证据</h2>
          </div>
          <label className="mt-3 block text-xs font-medium text-[#57606a]">
            节点
            <select className="mt-1 w-full rounded-md border border-[#d0d7de] bg-white px-2 py-2 text-sm text-[#24292f]" value={selectedNodeKey ?? ""} onChange={(event) => setSelectedNodeKey(event.currentTarget.value)}>
              {projection.nodes.map((node) => <option key={node.nodeKey} value={node.nodeKey}>{node.label}</option>)}
            </select>
          </label>
          {selectedNode ? <AttemptEvidence node={selectedNode} /> : <p className="mt-4 text-sm text-[#57606a]">当前没有节点详情。</p>}
        </section> : null}
        {detailTab === "timeline" ? <><LoopTimeline items={timelineItems} currentInteraction={currentInteraction} query={timelineQuery} onQueryChange={setTimelineQuery} onExport={exportTimeline} />
        {interactionError ? <div role="alert" className="mx-4 mt-3 border border-[#cf222e55] bg-[#ffebe9] px-3 py-2 text-xs leading-5 text-[#cf222e]">{interactionError}</div> : null}
        {currentInteraction ? <>
          <WorkflowInteractionThread interaction={currentInteraction} />
          <WorkflowInteractionComposer interaction={currentInteraction} fields={interactionFields(currentInteraction)} enabled={interactionCapabilities.canReply} onSubmit={submitInteractionMessage} />
          <WorkflowApprovalControls
            interaction={currentInteraction}
            canConfirm={interactionCapabilities.canConfirm}
            canDecideApproval={interactionCapabilities.canDecideApproval}
            onConfirm={confirmInteraction}
            onDecide={decideInteraction}
            onConfirmPosition={confirmOwnPosition}
            onSubmitIntervention={submitIntervention}
            onDelegateConflictSpeaker={delegateConflictSpeaker}
          />
        </> : null}</> : null}
      </aside>
      {selectedApproval ? <ApprovalDecisionDialog key={selectedApproval.id} open approval={selectedApproval} onClose={closeApproval} onDecided={({ approvalId }) => onApprovalDecided(approvalId)} /> : null}
      {restartTargetKey ? (() => {
        const restartNode = projection.nodes.find((candidate) => candidate.nodeKey === restartTargetKey);
        return <div role="dialog" aria-modal="true" aria-label="从节点重新启动" className="fixed inset-0 z-50 grid place-items-center bg-[#1f2328]/45 p-4">
          <div className="w-full max-w-md rounded-lg border border-[#d0d7de] bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-[#24292f]">从节点重新启动</h2>
            <p className="mt-2 text-sm leading-6 text-[#57606a]">
              将从「{restartNode?.label ?? restartTargetKey}」重新执行：该节点的失败计数会清零，其下游节点会按运行图重新流转。若该节点涉及推送、发版等外部副作用，请先确认现状再继续。
            </p>
            <label className="mt-4 grid gap-1.5 text-sm font-semibold text-[#24292f]">
              重跑原因（可选）
              <textarea
                aria-label="重跑原因（可选）"
                value={restartReason}
                onChange={(event) => setRestartReason(event.target.value)}
                rows={3}
                className="resize-y rounded-md border border-[#8c959f] px-3 py-2 text-sm font-normal outline-none focus:border-[#0969da] focus:ring-2 focus:ring-[#0969da]/10"
              />
            </label>
            {restartError ? <div role="alert" className="mt-3 rounded-md border border-[#f1aeb5] bg-[#fff5f5] px-3 py-2 text-sm text-[#cf222e]">{restartError}</div> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={restartPending} onClick={() => setRestartTargetKey(null)} className="h-9 rounded-md border border-[#d0d7de] bg-white px-3 text-sm font-semibold disabled:opacity-50">取消</button>
              <button type="button" disabled={restartPending} onClick={() => void confirmRestart()} className="h-9 rounded-md bg-[#1f883d] px-4 text-sm font-semibold text-white disabled:opacity-50">{restartPending ? "重启中…" : "确认重启"}</button>
            </div>
          </div>
        </div>;
      })() : null}
    </div>
  );
}

function RouteDecisionPanel({ decision }: { decision: LoopRouteAudit | null }) {
  return <section className="border-t border-[#d0d7de] px-4 py-4" aria-label="路由决策审计">
    <div className="flex items-center gap-2">
      <GitBranch aria-hidden="true" className="h-4 w-4 text-[#57606a]" />
      <h2 className="text-sm font-semibold text-[#24292f]">路由决策</h2>
    </div>
    {!decision ? <p className="mt-3 text-sm leading-6 text-[#57606a]">尚无已确认的 Agent 路由。</p> : <div className="mt-3 space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-[#24292f]">{decision.reasonCode}</span>
        <span className="text-[#57606a]">{decision.sourceNodeId} → {decision.targetNodeId}</span>
      </div>
      <p className="break-words leading-5 text-[#57606a]">{decision.summary}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[#6e7781]">
        <span>置信度 {Math.round(decision.confidence * 100)}% · Router v{decision.routerContractVersion}</span>
        <span className="font-mono" title={decision.routerContractDigest}>digest {decision.routerContractDigest.slice(0, 12)}</span>
      </div>
      {decision.evidence.length ? <ul className="space-y-1 border-l-2 border-[#d0d7de] pl-3 text-[#57606a]">
        {decision.evidence.map((path) => <li className="break-all" key={path}>{path}</li>)}
      </ul> : null}
      {decision.errorSummary ? <p className="flex gap-2 border border-[#cf222e55] bg-[#ffebe9] p-2 leading-5 text-[#cf222e]"><AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{decision.errorSummary}</p> : null}
    </div>}
  </section>;
}

async function reloadTimeline(loopRunId: string, setter: (items: LoopTimelineItemInput[]) => void) {
  const response = await fetch(`/api/loop-runs/${encodeURIComponent(loopRunId)}/timeline?limit=100`, { headers: { accept: "application/json" } });
  if (!response.ok) return;
  const body = await response.json() as { items?: LoopTimelineItemInput[] };
  setter(Array.isArray(body.items) ? body.items : []);
}

function exportTimeline(format: "json" | "markdown") {
  const url = `/api/loop-runs/${encodeURIComponent(window.location.pathname.split("/").at(-1) ?? "")}/timeline/export?format=${format}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function interactionFields(interaction: WorkflowInteractionView): WorkflowInteractionField[] {
  const policy = interaction.policySnapshot && typeof interaction.policySnapshot === "object" ? interaction.policySnapshot as Record<string, unknown> : {};
  return Array.isArray(policy.structuredFields) ? policy.structuredFields as WorkflowInteractionField[] : [];
}

function interventionRouteTarget(projection: LoopRunProjection, selectedNodeKey: string | null): string {
  const feedbackTarget = projection.edges.find((edge) => (
    edge.kind === "feedback" && edge.source === selectedNodeKey
  ))?.target;
  if (feedbackTarget) return feedbackTarget;
  return projection.nodes.find((node) => node.nodeKey !== selectedNodeKey && node.type !== "start" && node.type !== "end")?.nodeKey
    ?? projection.nodes.find((node) => node.type !== "start")?.nodeKey
    ?? "start";
}

function createUiCommandId() {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `ui-${suffix}`;
}

function RuntimeNode({ id, data, selected }: NodeProps) {
  const node = data as RuntimeNodeData;
  const updateNodeInternals = useUpdateNodeInternals();
  const meta = NODE_META[node.type];
  const Icon = meta.icon;
  const status = STATUS_META[node.visualStatus];
  const targetPosition = node.compact ? Position.Top : Position.Left;
  const sourcePosition = node.compact ? Position.Bottom : Position.Right;
  const isStart = node.type === "start";
  const isEnd = node.type === "end";
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, node.compact, updateNodeInternals]);
  return (
    <div data-status={node.status} className={`w-[184px] border-2 bg-white shadow-[0_3px_10px_rgba(31,35,40,0.12)] ${selected ? "ring-2 ring-[#0969da33]" : ""} ${status.classes}`}>
      {!isStart ? <Handle type="target" position={targetPosition} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-[#57606a]" /> : null}
      {node.hasFeedbackTarget ? <Handle id="feedback-target" type="target" position={node.compact ? Position.Right : Position.Bottom} style={node.compact ? { top: "34%" } : { left: "32%" }} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-[#8250df]" /> : null}
      <div className="flex items-center gap-2 border-b border-current/20 px-3 py-2">
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="truncate text-xs font-semibold text-[#24292f]">{node.label}</span>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px]">
        <span>{meta.caption}</span><span className="font-semibold">{status.label}</span>
      </div>
      {node.quickApproval ? <button type="button" onClick={(event) => { event.stopPropagation(); node.quickApproval?.open(); }} className="nodrag nopan flex w-full items-center justify-center gap-1.5 border-t border-current/20 bg-white/70 px-3 py-2 text-[11px] font-semibold text-[#116329] hover:bg-[#dafbe1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#1f883d]"><UserRoundCheck aria-hidden="true" className="h-3 w-3" />立即审批</button> : null}
      {node.childRun?.progress && node.childRun.nodes ? (
        <div className="border-t border-current/20 bg-white/60 px-2 py-2 text-[10px] text-[#24292f]">
          <div className="mb-1.5 flex items-center justify-between font-semibold"><span>任务节点</span><span>{node.childRun.progress.completed} / {node.childRun.progress.total}</span></div>
          <ol className="grid gap-1">
            {node.childRun.nodes.map((childNode) => <li className="flex min-w-0 items-center gap-1.5" key={childNode.nodeKey}><span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${["running", "ready", "active"].includes(childNode.status) ? "bg-[#0969da]" : ["succeeded", "completed"].includes(childNode.status) ? "bg-[#1f883d]" : ["failed", "cancelled"].includes(childNode.status) ? "bg-[#cf222e]" : "bg-[#8c959f]"}`} /><span className={`truncate ${["running", "ready", "active"].includes(childNode.status) ? "font-semibold text-[#0969da]" : ""}`}>{childNode.label}</span></li>)}
          </ol>
        </div>
      ) : null}
      {node.childRun ? <a
          href={`/loop-runs/${encodeURIComponent(node.childRun.id)}`}
          aria-label={`任务流程${runStatusLabel(node.childRun.status)}`}
          className="nodrag nopan flex items-center justify-between gap-2 border-t border-current/20 px-3 py-1.5 text-[11px] font-semibold text-[#0969da] hover:bg-[#ddf4ff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0969da]"
        >
          <span className="inline-flex items-center gap-1"><Workflow aria-hidden="true" className="h-3 w-3" />任务流程</span>
          <span className="inline-flex items-center gap-1">{runStatusLabel(node.childRun.status)}<ArrowRight aria-hidden="true" className="h-3 w-3" /></span>
        </a> : null}
      {!isEnd ? <Handle type="source" position={sourcePosition} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-[#1f883d]" /> : null}
      {node.hasFeedbackSource ? <Handle id="feedback-source" type="source" position={node.compact ? Position.Right : Position.Bottom} style={node.compact ? { top: "68%" } : { left: "68%" }} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-[#8250df]" /> : null}
    </div>
  );
}

function AttemptEvidence({ node }: { node: LoopRunProjection["nodes"][number] }) {
  if (node.attempts.length === 0 && !node.checklist?.length) {
    return <p className="mt-4 text-sm leading-6 text-[#57606a]">该节点尚无执行尝试。</p>;
  }
  return (
    <div className="mt-4">
      <RuntimeChecklist items={node.checklist ?? []} />
      {node.attempts.length > 0 ? <div className="divide-y divide-[#d8dee4] border-y border-[#d8dee4]">
      {node.attempts.map((attempt) => (
        <details key={attempt.attempt} className="group py-3" open={attempt.attempt === node.attemptNo}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-[#24292f]">
            <span>尝试 {attempt.attempt} · {attempt.workerInstance ? `Linux Worker · ${attempt.workerInstance}` : attempt.executionTarget === "linux_worker_pool" ? `Linux Worker${attempt.workerPoolDisplayName ? ` · ${attempt.workerPoolDisplayName}` : ""}` : attempt.executionTarget === "local" || attempt.executionTarget === "local_agent" || attempt.executorType === "local" ? "本地 Agent" : "平台"}</span>
            <StatusPill tone={attempt.status === "succeeded" ? "success" : attempt.status === "failed" ? "danger" : "blue"}>{attempt.status}</StatusPill>
          </summary>
          <dl className="mt-3 grid gap-2 text-xs text-[#57606a]">
            <div><dt className="inline font-medium text-[#24292f]">开始：</dt><dd className="inline">{attempt.startedAt ? formatDateTime(attempt.startedAt) : "未记录"}</dd></div>
            <div><dt className="inline font-medium text-[#24292f]">结束：</dt><dd className="inline">{attempt.finishedAt ? formatDateTime(attempt.finishedAt) : "进行中"}</dd></div>
            {attempt.executionTarget ? <div><dt className="inline font-medium text-[#24292f]">执行目标：</dt><dd className="inline">{attempt.executionTarget === "linux_worker_pool" ? "Linux Worker Pool" : attempt.executionTarget === "local" || attempt.executionTarget === "local_agent" ? "本地 Agent" : attempt.executionTarget}</dd></div> : null}
            {attempt.workerPoolDisplayName ? <div><dt className="inline font-medium text-[#24292f]">Worker Pool：</dt><dd className="inline">{attempt.workerPoolDisplayName}</dd></div> : null}
            {attempt.workerInstance ? <div><dt className="inline font-medium text-[#24292f]">Worker 实例：</dt><dd className="inline">{attempt.workerInstance}</dd></div> : null}
          </dl>
          {attempt.status === "failed" ? <FailureSummary result={attempt.result} error={attempt.error} /> : null}
          {attempt.result !== null ? <EvidenceBlock title="结果证据" value={attempt.result} /> : null}
          {attempt.error !== null ? <EvidenceBlock title="错误证据" value={attempt.error} tone="danger" /> : null}
        </details>
      ))}
      </div> : null}
    </div>
  );
}

function RuntimeChecklist({ items }: { items: NonNullable<LoopRunProjection["nodes"][number]["checklist"]> }) {
  if (items.length === 0) return null;
  return <section className="mb-4 border border-[#d0d7de] bg-[#f6f8fa] p-3" aria-label="AI 执行清单">
    <div className="mb-2 text-xs font-semibold text-[#24292f]">AI 执行清单</div>
    <ol className="grid gap-2">
      {items.map((item) => <li className="border-l-2 border-[#d0d7de] pl-3 text-xs" key={item.id}>
        <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-[#24292f]">{item.title}</span><ChecklistStatus status={item.status} /></div>
        {item.reason ? <p className="mt-1 break-words leading-5 text-[#57606a]">{item.reason}</p> : null}
        {item.evidenceRefs.length ? <ul className="mt-1 grid gap-1 text-[#57606a]">{item.evidenceRefs.map((reference) => <li className="break-all" key={reference}>{reference}</li>)}</ul> : null}
      </li>)}
    </ol>
  </section>;
}

function ChecklistStatus({ status }: { status: NonNullable<LoopRunProjection["nodes"][number]["checklist"]>[number]["status"] }) {
  const meta = {
    not_started: { label: "未开始", tone: "default" as const },
    in_progress: { label: "进行中", tone: "blue" as const },
    succeeded: { label: "已成功", tone: "success" as const },
    failed: { label: "失败", tone: "danger" as const },
    skipped: { label: "已跳过", tone: "warning" as const },
  }[status];
  return <StatusPill tone={meta.tone}>{meta.label}</StatusPill>;
}

function FailureSummary({ result, error }: { result: unknown; error: unknown }) {
  const summary = readFailureSummary(result) ?? readFailureSummary(error);
  if (!summary) return null;
  return <div className="mt-3 border border-[#cf222e66] bg-[#fff5f5] p-2 text-xs text-[#cf222e]" role="alert">
    <div className="font-semibold">执行失败：{summary.code}</div>
    <div className="mt-1 leading-5 text-[#57606a]">{summary.message}</div>
  </div>;
}

function EvidenceBlock({ title, value, tone = "default" }: { title: string; value: unknown; tone?: "default" | "danger" }) {
  return (
    <div className={`mt-3 border p-2 ${tone === "danger" ? "border-[#cf222e33] bg-[#ffebe9]" : "border-[#d0d7de] bg-[#f6f8fa]"}`}>
      <div className="text-[11px] font-semibold text-[#24292f]">{title}</div>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-5 text-[#57606a]">{formatEvidence(value)}</pre>
    </div>
  );
}

function RunStatus({ status }: { status: string }) {
  const terminalDanger = status === "failed" || status === "exhausted" || status === "cancelled";
  return <StatusPill tone={status === "completed" ? "success" : terminalDanger ? "danger" : status === "waiting" ? "warning" : "blue"}>{runStatusLabel(status)}</StatusPill>;
}

function normalizeNodeStatus(status: string): RuntimeVisualStatus {
  if (["ready", "running", "active"].includes(status)) return "current";
  if (["succeeded", "completed"].includes(status)) return "completed";
  if (status === "exhausted") return "exhausted";
  if (["failed", "cancelled"].includes(status)) return "failed";
  return "waiting";
}

function runStatusLabel(status: string): string {
  return ({ pending: "待启动", running: "运行中", waiting: "等待中", paused: "已暂停", completed: "已完成", failed: "失败", exhausted: "预算耗尽", cancelled: "已取消" } as Record<string, string>)[status] ?? status;
}

function loopExecutionTargetLabel(target: NonNullable<LoopRunProjection["run"]["executionTarget"]>): string {
  return target.type === "linux_worker_pool"
    ? `Linux Worker · ${target.displayName}`
    : `本地 Agent · ${target.displayName}`;
}

function isTerminalFailure(status: string): boolean {
  return ["failed", "exhausted", "cancelled"].includes(status);
}

function isRetryableChildStatus(status: string): boolean {
  return status === "failed" || status === "cancelled";
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}

async function loadLoopRunProjection(loopRunId: string): Promise<LoopRunProjection> {
  const response = await fetch(`/api/loop-runs/${encodeURIComponent(loopRunId)}`, { headers: { accept: "application/json" } });
  const body = await response.json() as { ok?: boolean; result?: LoopRunProjection; error?: string };
  if (!response.ok || !body.ok || !body.result) throw new Error(body.error ?? "Loop 运行快照载入失败");
  return body.result;
}

function isCursorGap(value: unknown): value is Error & { code: "cursor_gap" } {
  return value instanceof Error && "code" in value && (value as Error & { code?: unknown }).code === "cursor_gap";
}

function isChildLoopRelationshipEvent(event: PersistedLoopEvent, projection: LoopRunProjection): boolean {
  if (event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    && event.eventType === "loop.node.waiting"
    && Reflect.get(event.payload, "waitingReason") === "child_loop"
    && typeof Reflect.get(event.payload, "childLoopRunId") === "string") return true;
  if (event.eventType !== "loop.node.completed") return false;
  return projection.childRuns?.some((child) => child.parentNodeRunId === event.aggregateId) === true;
}

function formatEvidence(value: unknown): string {
  try { return JSON.stringify(value, null, 2); } catch { return "证据内容无法序列化"; }
}

function readFailureSummary(value: unknown): { code: string; message: string } | null {
  const root = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const failure = root?.failure && typeof root.failure === "object" && !Array.isArray(root.failure)
    ? root.failure as Record<string, unknown>
    : null;
  const output = root?.output && typeof root.output === "object" && !Array.isArray(root.output)
    ? root.output as Record<string, unknown>
    : root;
  const code = typeof failure?.code === "string" ? failure.code : typeof output?.errorCode === "string" ? output.errorCode : null;
  const message = typeof failure?.summary === "string" ? failure.summary : typeof output?.message === "string" ? output.message : null;
  return code && message ? { code, message } : null;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}
