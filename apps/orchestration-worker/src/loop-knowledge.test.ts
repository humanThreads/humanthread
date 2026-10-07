import { describe, expect, it, vi } from "vitest";

import {
  evaluateKnowledgeCandidate,
  extractKnowledgeCandidates,
  type ExtractedKnowledge,
} from "./loop-knowledge";

const safeKnowledge: ExtractedKnowledge = {
  projectId: "project_1",
  title: "发布检查清单",
  content: "发布前必须运行测试、类型检查和生产构建。",
  confidence: 0.96,
  policyAllowsAutoPublish: true,
  extractorVersion: "loop-knowledge/v1",
  sourceRefs: [{
    loopRunId: "run_1",
    nodeRunId: "node_4",
    eventId: "event_8",
    artifactId: "artifact_2",
  }],
};

function evaluationDependencies(input: {
  conflicts?: Array<{ documentId: string; reason: string }>;
} = {}) {
  const persistCandidate = vi.fn(async (candidate: Record<string, unknown>) => ({
    id: "candidate_1",
    ...candidate,
  }));
  const publishCandidate = vi.fn(async (candidate: Record<string, unknown>) => ({
    ...candidate,
    status: "published" as const,
    publishedDocumentId: "doc_1",
    publishedDocumentVersion: 1,
  }));
  return {
    findConflicts: vi.fn(async () => input.conflicts ?? []),
    persistCandidate,
    publishCandidate,
  };
}

describe("Loop knowledge extraction and evaluation", () => {
  it("extracts only declared knowledge outputs from a terminal successful Run", () => {
    const extracted = extractKnowledgeCandidates({
      run: { id: "run_1", projectId: "project_1", status: "completed" },
      outputs: [
        {
          declaredKnowledge: true,
          title: "发布检查清单",
          content: "发布前必须运行测试。",
          confidence: 0.9,
          policyAllowsAutoPublish: false,
          nodeRunId: "node_4",
          eventId: "event_8",
          artifactId: "artifact_2",
        },
        {
          declaredKnowledge: false,
          title: "普通运行日志",
          content: "不应进入知识候选。",
          confidence: 1,
          policyAllowsAutoPublish: true,
          nodeRunId: "node_5",
        },
      ],
      extractorVersion: "loop-knowledge/v1",
    });

    expect(extracted).toEqual([{
      projectId: "project_1",
      title: "发布检查清单",
      content: "发布前必须运行测试。",
      confidence: 0.9,
      policyAllowsAutoPublish: false,
      extractorVersion: "loop-knowledge/v1",
      sourceRefs: [{
        loopRunId: "run_1",
        nodeRunId: "node_4",
        eventId: "event_8",
        artifactId: "artifact_2",
      }],
    }]);

    expect(extractKnowledgeCandidates({
      run: { id: "run_2", projectId: "project_1", status: "running" },
      outputs: [{
        declaredKnowledge: true,
        title: "未完成输出",
        content: "运行未完成时不能提取。",
        confidence: 1,
        policyAllowsAutoPublish: true,
      }],
      extractorVersion: "loop-knowledge/v1",
    })).toEqual([]);
  });

  it("blocks credentials, redacts stored content, and preserves complete provenance", async () => {
    const dependencies = evaluationDependencies();
    const candidate = await evaluateKnowledgeCandidate({
      ...safeKnowledge,
      content: `部署令牌 API_KEY=sk-${"x".repeat(32)}，请勿传播。`,
    }, dependencies);

    expect(candidate).toMatchObject({
      status: "review_required",
      redactionResult: { status: "sensitive_content_detected" },
      sourceRefs: safeKnowledge.sourceRefs,
    });
    expect(candidate.safeContent).toContain("[REDACTED]");
    expect(candidate.safeContent).not.toContain("sk-");
    expect(dependencies.persistCandidate).toHaveBeenCalledWith(expect.objectContaining({
      sourceRefs: safeKnowledge.sourceRefs,
      status: "review_required",
    }));
    expect(dependencies.publishCandidate).not.toHaveBeenCalled();
  });

  it.each([
    { name: "conflicting", confidence: 0.96, conflicts: [{ documentId: "doc_existing", reason: "内容冲突" }] },
    { name: "low-confidence", confidence: 0.74, conflicts: [] },
  ])("routes a $name candidate to review", async ({ confidence, conflicts }) => {
    const dependencies = evaluationDependencies({ conflicts });

    const candidate = await evaluateKnowledgeCandidate({ ...safeKnowledge, confidence }, dependencies);

    expect(candidate.status).toBe("review_required");
    expect(dependencies.publishCandidate).not.toHaveBeenCalled();
  });

  it("auto-publishes a policy-eligible, high-confidence, safe candidate", async () => {
    const dependencies = evaluationDependencies();

    const candidate = await evaluateKnowledgeCandidate(safeKnowledge, dependencies);

    expect(candidate).toMatchObject({
      status: "published",
      publishedDocumentId: "doc_1",
      publishedDocumentVersion: 1,
    });
    expect(dependencies.publishCandidate).toHaveBeenCalledOnce();
  });
});
