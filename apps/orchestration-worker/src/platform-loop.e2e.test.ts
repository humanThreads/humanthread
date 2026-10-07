import type {
  ActivateLoopNodeInput,
  ClaimPlatformLoopAttemptInput,
  CompleteLoopNodeInput,
  PlatformLoopAttemptLease,
} from "@humanthread/db";
import {
  buildLoopTriggerIdentity,
  selectNextEdge,
  type LoopGraph,
  type LoopNodeDefinition,
} from "@humanthread/orchestration-core";
import { describe, expect, it } from "vitest";
import {
  executePlatformLoopAttempt,
  type PlatformExecutionMessage,
} from "./loop-platform-execution";
import { scheduleReadyLoopNodes } from "./loop-scheduler";
import {
  executePlatformNode,
  type PlatformNodeExecutorDependencies,
} from "./platform-node-executors";

const now = new Date("2026-07-30T08:00:00.000Z");

const graph = {
  schemaVersion: 1,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 4, maxRepeatCount: 1 },
  nodes: [
    { key: "start", label: "Start", type: "start" },
    {
      key: "approved",
      label: "Approved?",
      type: "condition",
      executionTarget: "platform",
      expression: { "==": [{ var: "approved" }, true] },
    },
    {
      key: "write",
      label: "Write report",
      type: "platform_action",
      executionTarget: "platform",
      action: "project_document.write",
      config: {
        documentId: "doc_1",
        expectedVersion: 1,
        title: "Loop report",
        contentMarkdown: "# Completed",
      },
    },
    { key: "end", label: "End", type: "end" },
  ],
  edges: [
    { id: "start-approved", source: "start", target: "approved", kind: "normal", outcome: "success" },
    { id: "approved-write", source: "approved", target: "write", kind: "normal", outcome: "success" },
    { id: "write-end", source: "write", target: "end", kind: "normal", outcome: "success" },
  ],
} satisfies LoopGraph;

type NodeStatus = "ready" | "running" | "succeeded" | "failed";

interface MemoryNodeRun {
  id: string;
  nodeKey: string;
  activationNo: number;
  status: NodeStatus;
  version: number;
  attemptCount: number;
  inputSnapshot: unknown;
}

interface MemoryAttempt {
  id: string;
  nodeRunId: string;
  attemptNo: number;
  status: "queued" | "claimed" | "succeeded" | "failed";
  version: number;
  claimToken: string | null;
}

function createPlatformLoopFixture(input: { failNodeKey?: string } = {}) {
  const projectId = "project_1";
  const actorUserId = "user_1";
  const nodeRuns: MemoryNodeRun[] = [];
  const attempts = new Map<string, MemoryAttempt>();
  const executionQueue: PlatformExecutionMessage[] = [];
  const traversals = new Map<string, number>();
  const writtenDocuments: Array<{ id: string; version: number; contentMarkdown: string }> = [];
  const createdApprovals: unknown[] = [];
  const documentCommands = new Map<string, { id: string; version: number }>();
  const documentEffectOrder: string[] = [];
  let run: { id: string; status: "running" | "completed" | "failed"; projectionVersion: number } | null = null;
  let document = { id: "doc_1", projectId, version: 1, contentMarkdown: "" };

  const documentDependencies: PlatformNodeExecutorDependencies = {
    assertCanWriteProject: async (input) => {
      if (input.userId !== actorUserId || input.projectId !== projectId) throw new Error("Project write denied");
      return { projectId, role: "maintainer" };
    },
    loadDocumentTarget: async (documentId) => (
      documentId === document.id ? { id: document.id, projectId: document.projectId } : null
    ),
    updateDocumentIdempotently: async (input) => {
      const replay = documentCommands.get(input.commandId);
      if (replay) return replay;
      if (input.documentId !== document.id || input.expectedVersion !== document.version) {
        throw new Error("Document version conflict");
      }
      documentEffectOrder.push("write");
      document = { ...document, version: document.version + 1, contentMarkdown: input.contentMarkdown };
      const result = { id: document.id, version: document.version };
      documentCommands.set(input.commandId, result);
      writtenDocuments.push({ ...result, contentMarkdown: document.contentMarkdown });
      return result;
    },
  };

  function requireRun() {
    if (!run) throw new Error("Loop was not triggered");
    return run;
  }

  function nodeDefinition(nodeKey: string): LoopNodeDefinition {
    const node = graph.nodes.find((candidate) => candidate.key === nodeKey);
    if (!node) throw new Error(`Unknown node: ${nodeKey}`);
    return node;
  }

  function readyCandidates() {
    const currentRun = requireRun();
    return nodeRuns
      .filter((nodeRun) => nodeRun.status === "ready")
      .map((nodeRun) => ({
        loopRunId: currentRun.id,
        projectId,
        nodeRunId: nodeRun.id,
        nodeRunVersion: nodeRun.version,
        nodeKey: nodeRun.nodeKey,
        activationNo: nodeRun.activationNo,
        attemptCount: nodeRun.attemptCount,
        inputSnapshot: nodeRun.inputSnapshot,
        bindingSnapshot: {},
        node: nodeDefinition(nodeRun.nodeKey),
      }));
  }

  async function activate(input: ActivateLoopNodeInput) {
    const nodeRun = nodeRuns.find((candidate) => candidate.id === input.nodeRunId);
    if (!nodeRun || nodeRun.status !== "ready" || nodeRun.version !== input.nodeRunVersion) throw staleLease();
    nodeRun.status = "running";
    nodeRun.version += 1;
    nodeRun.attemptCount += 1;
    attempts.set(input.attemptId, {
      id: input.attemptId,
      nodeRunId: nodeRun.id,
      attemptNo: nodeRun.attemptCount,
      status: "queued",
      version: 1,
      claimToken: null,
    });
    executionQueue.push({
      loopRunId: input.loopRunId,
      projectId,
      nodeRunId: nodeRun.id,
      attemptId: input.attemptId,
      attemptNo: nodeRun.attemptCount,
      nodeKey: nodeRun.nodeKey,
      correlationId: input.correlationId,
    });
  }

  async function claimAttempt(input: ClaimPlatformLoopAttemptInput): Promise<PlatformLoopAttemptLease | null> {
    const currentRun = requireRun();
    const attempt = attempts.get(input.attemptId);
    const nodeRun = nodeRuns.find((candidate) => candidate.id === input.nodeRunId);
    if (
      currentRun.status !== "running"
      || !attempt
      || !nodeRun
      || attempt.status !== "queued"
      || attempt.nodeRunId !== nodeRun.id
      || attempt.attemptNo !== input.attemptNo
      || nodeRun.status !== "running"
      || nodeRun.nodeKey !== input.nodeKey
    ) return null;
    attempt.status = "claimed";
    attempt.version += 1;
    attempt.claimToken = input.claimToken;
    return {
      loopRunId: currentRun.id,
      projectId,
      actorUserId,
      nodeRunId: nodeRun.id,
      nodeRunVersion: nodeRun.version,
      attemptId: attempt.id,
      attemptNo: attempt.attemptNo,
      attemptVersion: attempt.version,
      claimToken: input.claimToken,
      node: nodeDefinition(nodeRun.nodeKey),
      inputSnapshot: nodeRun.inputSnapshot,
    };
  }

  async function completeNode(input: CompleteLoopNodeInput) {
    const currentRun = requireRun();
    const attempt = attempts.get(input.attemptId);
    const nodeRun = nodeRuns.find((candidate) => candidate.id === input.nodeRunId);
    if (
      !attempt
      || !nodeRun
      || attempt.status !== "claimed"
      || attempt.version !== input.attemptVersion
      || attempt.claimToken !== input.claimToken
      || nodeRun.status !== "running"
      || nodeRun.version !== input.nodeRunVersion
    ) throw staleLease();
    if (input.result.outcome === "failure") {
      attempt.status = "failed";
      attempt.version += 1;
      nodeRun.version += 1;
      currentRun.projectionVersion += 1;
      if (nodeRun.attemptCount < 2) {
        nodeRun.status = "ready";
      } else {
        nodeRun.status = "failed";
        currentRun.status = "failed";
      }
      return;
    }
    attempt.status = "succeeded";
    attempt.version += 1;
    nodeRun.status = "succeeded";
    nodeRun.version += 1;
    currentRun.projectionVersion += 1;
    if (nodeRun.nodeKey === "write") documentEffectOrder.push("complete");

    const node = nodeDefinition(nodeRun.nodeKey);
    if (node.type === "end") {
      currentRun.status = "completed";
      return;
    }
    const edge = selectNextEdge({
      graph,
      nodeKey: nodeRun.nodeKey,
      outcome: input.result.outcome,
      data: input.result.output,
    });
    traversals.set(edge.id, (traversals.get(edge.id) ?? 0) + 1);
    const activationNo = nodeRuns.filter((candidate) => candidate.nodeKey === edge.target).length + 1;
    nodeRuns.push({
      id: `node_run:${edge.target}:${activationNo}`,
      nodeKey: edge.target,
      activationNo,
      status: "ready",
      version: 1,
      attemptCount: 0,
      inputSnapshot: input.result.output,
    });
  }

  async function drainWorker() {
    for (let cycle = 0; cycle < graph.nodes.length + 2; cycle += 1) {
      if (["completed", "failed"].includes(requireRun().status)) return;
      await scheduleReadyLoopNodes({
        limit: 10,
        now,
        loadReady: async () => readyCandidates(),
        activate,
      });
      while (executionQueue.length > 0) {
        const message = executionQueue.shift();
        if (!message) break;
        await executePlatformLoopAttempt(message, {
          now: () => now,
          claimAttempt,
          reserveEffect: async () => {
            documentEffectOrder.push("reserve");
            return { status: "prepared" };
          },
          resolveEffect: async () => {
            documentEffectOrder.push("resolve");
          },
          executeNode: (executionInput) => executionInput.node.key === input.failNodeKey
            ? Promise.resolve({
                status: "completed" as const,
                result: {
                  outcome: "failure" as const,
                  output: { errorCode: "injected_failure", message: "Injected platform failure" },
                  artifactRefs: [],
                  effectReceipts: [],
                },
              })
            : executePlatformNode(executionInput, documentDependencies),
          completeNode,
          waitNode: async () => {
            throw new Error("Platform-only E2E must not wait");
          },
        });
      }
    }
    throw new Error("Platform-only Loop did not reach a terminal state");
  }

  return {
    writtenDocuments,
    createdApprovals,
    documentEffectOrder,
    trigger(input: { commandId: string; payload: Record<string, unknown> }) {
      if (run) return { id: run.id };
      const identity = buildLoopTriggerIdentity({
        bindingId: "binding_1",
        triggerType: "manual",
        sourceEventId: input.commandId,
      });
      run = { id: identity.runId, status: "running", projectionVersion: 1 };
      nodeRuns.push({
        id: "node_run:start:1",
        nodeKey: "start",
        activationNo: 1,
        status: "ready",
        version: 1,
        attemptCount: 0,
        inputSnapshot: input.payload,
      });
      return { id: run.id };
    },
    drainWorker,
    readProjection(loopRunId: string) {
      const currentRun = requireRun();
      if (currentRun.id !== loopRunId) throw new Error("LoopRun not found");
      return {
        run: { id: currentRun.id, status: currentRun.status },
        nodes: graph.nodes.map((node) => {
          const current = nodeRuns.filter((candidate) => candidate.nodeKey === node.key).at(-1);
          return { nodeKey: node.key, status: current?.status ?? "pending" };
        }),
        edges: graph.edges.map((edge) => ({ edgeId: edge.id, traversalCount: traversals.get(edge.id) ?? 0 })),
      };
    },
    attemptCount(nodeKey: string) {
      return [...attempts.values()].filter((attempt) => (
        nodeRuns.find((nodeRun) => nodeRun.id === attempt.nodeRunId)?.nodeKey === nodeKey
      )).length;
    },
  };
}

function staleLease(): Error {
  return Object.assign(new Error("stale lease"), { code: "stale_lease" });
}

describe("platform-only Loop E2E", () => {
  it("runs start -> condition -> document write -> end without a Human Gate", async () => {
    const fixture = createPlatformLoopFixture();
    const run = fixture.trigger({ commandId: "manual_1", payload: { approved: true } });

    await fixture.drainWorker();

    expect(fixture.readProjection(run.id)).toEqual({
      run: { id: run.id, status: "completed" },
      nodes: [
        { nodeKey: "start", status: "succeeded" },
        { nodeKey: "approved", status: "succeeded" },
        { nodeKey: "write", status: "succeeded" },
        { nodeKey: "end", status: "succeeded" },
      ],
      edges: [
        { edgeId: "start-approved", traversalCount: 1 },
        { edgeId: "approved-write", traversalCount: 1 },
        { edgeId: "write-end", traversalCount: 1 },
      ],
    });
    expect(fixture.writtenDocuments).toEqual([{
      id: "doc_1",
      version: 2,
      contentMarkdown: "# Completed",
    }]);
    expect(fixture.documentEffectOrder).toEqual(["reserve", "write", "resolve", "complete"]);
    expect(fixture.createdApprovals).toHaveLength(0);
  });

  it("retries only the failed SubLoop and fails the Run after its second execution", async () => {
    const fixture = createPlatformLoopFixture({ failNodeKey: "write" });
    const run = fixture.trigger({ commandId: "manual_failure_1", payload: { approved: true } });

    await fixture.drainWorker();

    expect(fixture.readProjection(run.id)).toEqual({
      run: { id: run.id, status: "failed" },
      nodes: [
        { nodeKey: "start", status: "succeeded" },
        { nodeKey: "approved", status: "succeeded" },
        { nodeKey: "write", status: "failed" },
        { nodeKey: "end", status: "pending" },
      ],
      edges: [
        { edgeId: "start-approved", traversalCount: 1 },
        { edgeId: "approved-write", traversalCount: 1 },
        { edgeId: "write-end", traversalCount: 0 },
      ],
    });
    expect(fixture.attemptCount("write")).toBe(2);
  });
});
