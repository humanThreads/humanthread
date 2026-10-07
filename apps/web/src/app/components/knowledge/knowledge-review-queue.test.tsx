// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KnowledgeReviewQueue } from "./knowledge-review-queue";

afterEach(cleanup);

const batch = {
  batchId: "259b018ac65267ab7ec589813aa38964",
  jobId: "9d4f58913eef6edec22fbd8ad7191b26",
  submissionId: "a".repeat(32),
  status: "review_required",
  progress: 30,
  receivedAt: "2026-09-23T00:00:00.000Z",
  updatedAt: "2026-09-23T00:00:00.000Z",
  items: [{
    id: "item_1",
    batchId: "259b018ac65267ab7ec589813aa38964",
    ordinal: 0,
    stableKey: "rule.release.gate",
    changeType: "create",
    sourceType: "knowledge_architecture",
    entryType: "rule",
    title: "发布门禁",
    summary: "必须全量测试",
    confidence: 0.96,
    tags: ["release"],
    decision: "review_required",
    decisionReason: "automation_disabled",
    publishedVersion: null,
  }],
};

describe("KnowledgeReviewQueue", () => {
  it("shows the batch and job identifiers a reviewer needs to trace", () => {
    render(<KnowledgeReviewQueue projectId="project_1" initialBatches={[batch]} />);

    expect(screen.getByText(batch.batchId)).toBeTruthy();
    expect(screen.getByText(batch.jobId)).toBeTruthy();
    expect(screen.getByText("发布门禁")).toBeTruthy();
    expect(screen.getByText("待审核 1 条，共 1 条")).toBeTruthy();
  });

  it("approves the batch through the project-scoped decision API", async () => {
    const decide = vi.fn().mockResolvedValue({ entries: [], unresolvedItemIds: [] });
    render(<KnowledgeReviewQueue projectId="project_1" initialBatches={[batch]} api={{ decide }} />);

    await userEvent.click(screen.getByRole("button", { name: "全部通过" }));

    await waitFor(() => expect(decide).toHaveBeenCalledWith(batch.batchId, { decision: "approve" }));
    expect(screen.getByText("暂无待审核知识")).toBeTruthy();
  });

  it("requires a reason and surfaces failures when rejection does not complete", async () => {
    const decide = vi.fn().mockRejectedValue(new Error("Knowledge batch is no longer reviewable"));
    render(<KnowledgeReviewQueue projectId="project_1" initialBatches={[batch]} api={{ decide }} />);

    await userEvent.click(screen.getByRole("button", { name: "全部拒绝" }));

    await waitFor(() => expect(decide).toHaveBeenCalledWith(batch.batchId, {
      decision: "reject",
      reason: "人工审核拒绝",
    }));
    expect(screen.getByRole("alert").textContent).toContain("Knowledge batch is no longer reviewable");
    expect(screen.getByText("发布门禁")).toBeTruthy();
  });
});
