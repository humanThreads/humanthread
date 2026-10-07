import {
  transitionLoopNode,
  validateLoopGraph,
  type GateDecision,
  type LoopGraph,
  type TransitionCounters,
} from "@humanthread/orchestration-core";
import { describe, expect, it, vi } from "vitest";

import {
  evaluateKnowledgeCandidate,
  extractKnowledgeCandidates,
} from "./loop-knowledge";
import { executePlatformNode } from "./platform-node-executors";

const officeGraph = {
  schemaVersion: 1,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 5, maxRepeatCount: 1 },
  nodes: [
    { key: "start", label: "开始", type: "start" },
    {
      key: "draft",
      label: "整理周报",
      type: "agent_action",
      executionTarget: "local",
      promptTemplate: "根据本周工作记录整理周报。",
    },
    {
      key: "review",
      label: "内容门禁",
      type: "policy_gate",
      executionTarget: "platform",
      policy: { name: "weekly-report-quality" },
    },
    {
      key: "publish",
      label: "发布周报",
      type: "platform_action",
      executionTarget: "platform",
      action: "project_document.write",
      config: {
        documentId: "doc_weekly",
        expectedVersion: 1,
        title: "本周总结",
        contentMarkdown: "# 本周总结\n\nLoop Engine 已完成跨端闭环验收。",
      },
    },
    { key: "end", label: "结束", type: "end" },
  ],
  edges: [
    { id: "start-draft", source: "start", target: "draft", kind: "normal", outcome: "success" },
    { id: "draft-review", source: "draft", target: "review", kind: "normal", outcome: "success" },
    { id: "review-publish", source: "review", target: "publish", kind: "normal", outcome: "pass" },
    { id: "publish-end", source: "publish", target: "end", kind: "normal", outcome: "success" },
    {
      id: "review-draft",
      source: "review",
      target: "draft",
      kind: "feedback",
      outcome: "rework",
      maxTraversals: 1,
    },
  ],
} satisfies LoopGraph;

describe("office Loop release journey", () => {
  it("creates a document, requests rework once, and publishes traced knowledge", async () => {
    const result = await runOfficeLoop({ reviewOutcomes: ["rework", "pass"] });

    expect(result.run).toEqual({ status: "completed", repeatCount: 1 });
    expect(result.documents).toContainEqual(expect.objectContaining({
      path: "周报/本周总结.md",
      title: "本周总结",
      version: 2,
    }));
    expect(result.knowledge).toMatchObject({
      status: "published",
      publishedDocumentId: "doc_knowledge_weekly",
      sourceRefs: [{
        loopRunId: "run_office",
        nodeRunId: "node_publish_1",
        eventId: "event_publish_completed",
        artifactId: "doc_weekly",
      }],
    });
  });
});

async function runOfficeLoop(input: {
  reviewOutcomes: GateDecision["outcome"][];
}) {
  const validation = validateLoopGraph(officeGraph);
  if (!validation.ok) throw new Error(`Invalid office graph: ${validation.errors.join("; ")}`);
  let counters: TransitionCounters = { transitions: 2, repeats: 0, edgeTraversals: {} };

  for (const outcome of input.reviewOutcomes) {
    const selectedEdgeId = outcome === "rework" ? "review-draft" : "review-publish";
    const transition = transitionLoopNode({
      graph: officeGraph,
      nodeKey: "review",
      decision: {
        outcome,
        reasonCode: outcome === "rework" ? "missing_metrics" : "quality_passed",
        message: outcome === "rework" ? "补充量化进展" : "周报质量通过",
        evidenceRefs: ["artifact:weekly-draft"],
        selectedEdgeId,
      },
      counters,
      limits: {
        maxRepeatCount: officeGraph.limits.maxRepeatCount,
        maxTransitions: validation.maxTransitions,
      },
    });
    if (transition.status !== "routed") throw new Error(`Office review stopped: ${transition.reason}`);
    counters = transition.counters;
  }

  const documents = [{
    id: "doc_weekly",
    projectId: "project_1",
    path: "周报/本周总结.md",
    title: "本周总结",
    contentMarkdown: "",
    version: 1,
  }];
  const publishNode = officeGraph.nodes.find((node) => node.key === "publish");
  if (!publishNode) throw new Error("Office publish node is missing");
  const execution = await executePlatformNode({
    node: publishNode,
    input: { approved: true },
    projectId: "project_1",
    actorUserId: "user_1",
    effectKey: "effect:office:publish:v1",
    now: new Date("2026-07-31T10:00:00.000Z"),
  }, {
    assertCanWriteProject: vi.fn().mockResolvedValue({ role: "maintainer" }),
    loadDocumentTarget: vi.fn(async (documentId) => {
      const document = documents.find((candidate) => candidate.id === documentId);
      return document ? { id: document.id, projectId: document.projectId } : null;
    }),
    updateDocumentIdempotently: vi.fn(async (command) => {
      const document = documents.find((candidate) => candidate.id === command.documentId);
      if (!document || document.version !== command.expectedVersion) throw new Error("Document version conflict");
      document.title = command.title;
      document.contentMarkdown = command.contentMarkdown;
      document.version += 1;
      return { id: document.id, version: document.version };
    }),
  });
  if (execution.status !== "completed") throw new Error("Office document publication unexpectedly waited");

  const extracted = extractKnowledgeCandidates({
    run: { id: "run_office", projectId: "project_1", status: "completed" },
    outputs: [{
      declaredKnowledge: true,
      title: "周报发布约定",
      content: "周报发布前应经过内容门禁，并保留返工证据。",
      confidence: 0.96,
      policyAllowsAutoPublish: true,
      nodeRunId: "node_publish_1",
      eventId: "event_publish_completed",
      artifactId: "doc_weekly",
    }],
    extractorVersion: "loop-knowledge/v1",
  });
  const knowledge = await evaluateKnowledgeCandidate(extracted[0]!, {
    findConflicts: vi.fn().mockResolvedValue([]),
    persistCandidate: vi.fn(async (candidate) => ({ id: "candidate_weekly", status: candidate.status })),
    publishCandidate: vi.fn(async (candidate) => ({
      ...candidate,
      status: "published",
      publishedDocumentId: "doc_knowledge_weekly",
      publishedDocumentVersion: 1,
      sourceRefs: extracted[0]!.sourceRefs,
    })),
  });

  return {
    run: { status: "completed" as const, repeatCount: counters.repeats },
    documents,
    knowledge,
  };
}
