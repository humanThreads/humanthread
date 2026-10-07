import type { LoopRunProjection } from "@/lib/orchestration/loop-read-model";
import { describe, expect, it } from "vitest";
import {
  applyPersistedLoopEvent,
  createLoopRunViewerProjection,
  type PersistedLoopEvent,
} from "./loop-run-projection";

function projectionAt12(): LoopRunProjection {
  return {
    definitionVersion: 3,
    projectionVersion: 8,
    eventCursor: 12,
    run: { id: "run_1", status: "running", repeatCount: 0, transitionCount: 2, stopReason: null },
    nodes: [
      { nodeKey: "work", label: "执行工作", type: "agent_action", status: "succeeded", currentNodeRunId: "node_work_1", attemptNo: 1, waitingReason: null, attempts: [] },
      { nodeKey: "review", label: "质量门禁", type: "policy_gate", status: "running", currentNodeRunId: "node_review_1", attemptNo: 1, waitingReason: null, attempts: [] },
    ],
    edges: [
      { edgeId: "review_to_work", source: "review", target: "work", kind: "feedback", outcome: "rework", traversalCount: 0, limit: 2, lastTraversalAt: null },
    ],
    activities: [],
  };
}

function event(overrides: Partial<PersistedLoopEvent> = {}): PersistedLoopEvent {
  return {
    cursor: 13,
    id: "event_13",
    eventType: "loop.gate.routed",
    aggregateType: "loop_node",
    aggregateId: "node_review_1",
    sequence: 4,
    occurredAt: "2026-07-31T08:00:00.000Z",
    payload: {
      loopRunId: "run_1",
      result: { status: "routed", selectedEdgeId: "review_to_work", targetNodeRunId: "node_work_2" },
    },
    ...overrides,
  };
}

describe("persisted Loop run projection", () => {
  it("applies a contiguous persisted gate route and marks its feedback traversal active", () => {
    const result = applyPersistedLoopEvent(createLoopRunViewerProjection(projectionAt12()), event());

    expect(result.eventCursor).toBe(13);
    expect(result.activeEdgeId).toBe("review_to_work");
    expect(result.edges[0]).toMatchObject({ traversalCount: 1, lastTraversalAt: "2026-07-31T08:00:00.000Z" });
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: "review", status: "succeeded" }),
      expect.objectContaining({ nodeKey: "work", status: "ready", currentNodeRunId: "node_work_2" }),
    ]));
  });

  it("throws a typed cursor gap without guessing later state", () => {
    expect(() => applyPersistedLoopEvent(
      createLoopRunViewerProjection(projectionAt12()),
      event({ cursor: 14 }),
    )).toThrow(expect.objectContaining({ code: "cursor_gap" }));
  });

  it("returns the same projection for duplicate or old events", () => {
    const projection = createLoopRunViewerProjection(projectionAt12());
    expect(applyPersistedLoopEvent(projection, event({ cursor: 12 }))).toBe(projection);
  });

  it("advances past raw app-server notifications without adding a visible activity", () => {
    const projection = createLoopRunViewerProjection(projectionAt12());

    const result = applyPersistedLoopEvent(projection, event({
      eventType: "worker.app_server.notification",
      payload: { payloadSummary: { method: "item/agentMessage/delta" } },
    }));

    expect(result.eventCursor).toBe(13);
    expect(result.activities).toEqual([]);
    expect(result.nodes).toEqual(projection.nodes);
  });

  it("projects a runtime checklist from lease-bound lifecycle events", () => {
    const initial = createLoopRunViewerProjection(projectionAt12());
    const binding = {
      loopRunId: "run_1",
      loopNodeRunId: "node_review_1",
      loopNodeAttemptId: "attempt_review_1",
      attemptNo: 1,
      leaseGeneration: 2,
    };
    const created = applyPersistedLoopEvent(initial, event({
      eventType: "loop.checklist.created",
      payload: {
        payloadSummary: {
          ...binding,
          checklist: [{ id: "inspect", title: "检查仓库状态", status: "not_started", evidenceRefs: [] }],
        },
      },
    }));
    const running = applyPersistedLoopEvent(created, event({
      cursor: 14,
      id: "event_14",
      eventType: "loop.checklist.updated",
      payload: {
        payloadSummary: { ...binding, itemId: "inspect", status: "in_progress", evidenceRefs: [] },
      },
    }));
    const completed = applyPersistedLoopEvent(running, event({
      cursor: 15,
      id: "event_15",
      eventType: "loop.checklist.updated",
      payload: {
        payloadSummary: { ...binding, itemId: "inspect", status: "succeeded", evidenceRefs: ["artifacts/test.json"] },
      },
    }));

    const staleAttempt = applyPersistedLoopEvent(completed, event({
      cursor: 16,
      id: "event_16",
      eventType: "loop.checklist.updated",
      payload: {
        payloadSummary: {
          ...binding,
          attemptNo: 2,
          itemId: "inspect",
          status: "failed",
          reason: "stale attempt",
          evidenceRefs: [],
        },
      },
    }));

    expect(staleAttempt.nodes.find((node) => node.nodeKey === "review")?.checklist).toEqual([
      { id: "inspect", title: "检查仓库状态", status: "succeeded", evidenceRefs: ["artifacts/test.json"] },
    ]);
    expect(completed.activities.map((activity) => activity.summary)).toEqual([
      "质量门禁 已生成 1 项执行清单",
      "质量门禁 · 检查仓库状态进行中",
      "质量门禁 · 检查仓库状态已成功",
    ]);
  });

  it("records an unknown persisted event without inventing a visual transition", () => {
    const projection = createLoopRunViewerProjection(projectionAt12());
    const result = applyPersistedLoopEvent(projection, event({ eventType: "loop.node.progressed" }));

    expect(result.eventCursor).toBe(13);
    expect(result.nodes).toEqual(projection.nodes);
    expect(result.edges).toEqual(projection.edges);
    expect(result.activities.at(-1)).toMatchObject({ id: "event_13", cursor: 13 });
  });

  it("shows the persisted Router decision and activates its selected edge without double counting", () => {
    const projection = createLoopRunViewerProjection({
      ...projectionAt12(),
      eventCursor: 13,
      activities: [{
        id: "event_13", cursor: 13, eventType: "loop.node.completed", occurredAt: "2026-07-31T08:00:00.000Z",
        nodeKey: "review", edgeId: "review_to_work", summary: "质量门禁已完成，流转至执行工作",
      }],
      edges: [{ ...projectionAt12().edges[0]!, traversalCount: 1, lastTraversalAt: "2026-07-31T08:00:00.000Z" }],
    });
    const result = applyPersistedLoopEvent(projection, event({
      cursor: 14,
      eventType: "loop.agent.route_decided",
      id: "route_event_14",
      payload: {
        sourceNodeId: "review",
        targetNodeId: "work",
        decisionId: "decision_14",
        reasonCode: "REWORK_REQUIRED",
        summary: "测试未通过，回到执行节点",
        evidence: ["artifacts/test-report.json"],
        confidence: 0.88,
        routerContractVersion: 1,
        routerContractDigest: "digest_1",
        selectedEdgeId: "review_to_work",
      },
    }));

    expect(result.activeEdgeId).toBe("review_to_work");
    expect(result.edges[0]).toMatchObject({ traversalCount: 1 });
    expect(result.activities.at(-1)).toMatchObject({
      eventType: "loop.agent.route_decided",
      routeDecision: expect.objectContaining({ decisionId: "decision_14", reasonCode: "REWORK_REQUIRED" }),
    });
  });

  it("marks a non-adjacent Decision target ready without inventing an edge traversal", () => {
    const projection = createLoopRunViewerProjection({
      ...projectionAt12(),
      nodes: [
        ...projectionAt12().nodes,
        { nodeKey: "write_plan", nodeId: "write_plan", label: "编写计划", type: "agent_action", status: "pending", currentNodeRunId: null, attemptNo: 0, waitingReason: null, attempts: [] },
      ],
    });

    const result = applyPersistedLoopEvent(projection, event({
      eventType: "loop.node.completed",
      payload: {
        loopRunId: "run_1",
        nodeKey: "review",
        transition: {
          status: "routed",
          edge: null,
          targetNodeKey: "write_plan",
          targetActivationNo: 1,
          counters: { transitions: 3, repeats: 0 },
        },
      },
    }));

    expect(result.activeEdgeId).toBeNull();
    expect(result.edges).toEqual(projection.edges);
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: "review", status: "succeeded" }),
      expect.objectContaining({ nodeKey: "write_plan", status: "ready", currentNodeRunId: null }),
    ]));
    expect(result.activities.at(-1)).toMatchObject({ summary: "质量门禁 已完成，流转至 编写计划" });
  });

  it("ignores a Router decision whose edge is not in the snapshot", () => {
    const result = applyPersistedLoopEvent(createLoopRunViewerProjection(projectionAt12()), event({
      eventType: "loop.agent.route_decided",
      payload: {
        sourceNodeId: "review",
        targetNodeId: "work",
        decisionId: "decision_forged",
        reasonCode: "FORGED",
        summary: "invalid",
        evidence: [],
        confidence: 0.1,
        routerContractVersion: 1,
        routerContractDigest: "digest_1",
        selectedEdgeId: "edge_not_in_snapshot",
      },
    }));

    expect(result.activeEdgeId).toBeNull();
    expect(result.activities.at(-1)).not.toHaveProperty("routeDecision");
  });
});
