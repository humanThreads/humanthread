// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KnowledgeCandidateList,
  type KnowledgeCandidateListItem,
} from "./knowledge-candidate-list";

const reviewCandidate: KnowledgeCandidateListItem = {
  id: "candidate_1",
  projectId: "project_1",
  title: "发布检查清单",
  contentSummary: "发布前必须运行测试、类型检查和生产构建。",
  contentFingerprint: `sha256:${"a".repeat(64)}`,
  sourceRefs: [{
    loopRunId: "run_1",
    nodeRunId: "node_4",
    eventId: "event_8",
    artifactId: "artifact_2",
  }],
  confidence: 0.74,
  redactionResult: { status: "sensitive_content_detected", redactionCount: 1 },
  conflictResult: { status: "conflicts_detected", conflicts: [{ documentId: "doc_existing", reason: "内容冲突" }] },
  extractorVersion: "loop-knowledge/v1",
  status: "review_required",
  reviewedByUserId: null,
  reviewReason: null,
  publishedDocumentId: null,
  publishedDocumentVersion: null,
  createdAt: "2026-07-31T08:00:00.000Z",
};

describe("KnowledgeCandidateList", () => {
  afterEach(cleanup);

  it("shows review reasons and complete provenance without exposing raw credentials", () => {
    render(<KnowledgeCandidateList projectId="project_1" initialCandidates={[reviewCandidate]} api={{ decide: vi.fn() }} />);

    expect(screen.getByText("需要审核")).toBeTruthy();
    expect(screen.getByText("检测到敏感内容，已脱敏 1 处")).toBeTruthy();
    expect(screen.getByText("发现 1 项文档冲突")).toBeTruthy();
    expect(screen.getByRole("link", { name: "查看冲突文档 doc_existing" }).getAttribute("href")).toBe(
      "/projects/project_1/documents/doc_existing",
    );
    expect(screen.getByText("内容冲突")).toBeTruthy();
    expect(screen.getByRole("link", { name: "打开运行 run_1" }).getAttribute("href")).toBe("/loop-runs/run_1");
    expect(screen.getByText("节点 node_4 · 事件 event_8 · 产物 artifact_2")).toBeTruthy();
    expect(document.body.textContent).not.toContain("sk-");
  });

  it("publishes a reviewed candidate and replaces its actions with the document target", async () => {
    const user = userEvent.setup();
    const decide = vi.fn().mockResolvedValue({
      ...reviewCandidate,
      status: "published",
      publishedDocumentId: "doc_knowledge_1",
      publishedDocumentVersion: 1,
    });
    render(<KnowledgeCandidateList projectId="project_1" initialCandidates={[reviewCandidate]} api={{ decide }} />);

    await user.click(screen.getByRole("button", { name: "发布为项目文档" }));

    expect(decide).toHaveBeenCalledWith("candidate_1", { decision: "publish" });
    const documentLink = await screen.findByRole("link", { name: "打开文档 v1" });
    expect(documentLink.getAttribute("href")).toBe(
      "/projects/project_1/documents/doc_knowledge_1",
    );
    expect(screen.queryByRole("button", { name: "发布为项目文档" })).toBeNull();
  });

  it("requires an explicit reason before rejecting a candidate", async () => {
    const user = userEvent.setup();
    const decide = vi.fn().mockResolvedValue({ ...reviewCandidate, status: "rejected" });
    render(<KnowledgeCandidateList projectId="project_1" initialCandidates={[reviewCandidate]} api={{ decide }} />);

    await user.click(screen.getByRole("button", { name: "拒绝候选" }));
    expect(screen.getByRole("alert").textContent).toContain("请填写拒绝原因");
    expect(decide).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("审核说明"), { target: { value: "与当前项目约定不一致" } });
    await user.click(screen.getByRole("button", { name: "拒绝候选" }));

    expect(decide).toHaveBeenCalledWith("candidate_1", {
      decision: "reject",
      reason: "与当前项目约定不一致",
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "拒绝候选" })).toBeNull());
    expect(screen.getByRole("status").textContent).toContain("知识候选已拒绝");
  });
});
