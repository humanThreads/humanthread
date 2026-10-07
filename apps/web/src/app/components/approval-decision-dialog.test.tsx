// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApprovalDecisionDialog,
  ApprovalDecisionSummary,
  getApprovalDecisionOptions,
  validateApprovalDecision,
} from "./approval-decision-dialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const contextualApproval = {
  id: "approval_1",
  type: "loop_human_gate",
  status: "pending",
  createdAt: new Date("2026-08-11T10:00:00.000Z"),
  taskShortId: "HUMANTHR1100003",
  taskTitle: "优化任务详情交互",
  projectName: "humanthread",
  loopLabel: "Gelsang Project Loop",
  nodeKey: "confirm_requirement",
  nodeLabel: "确认需求",
  prompt: "确认需求是否完整",
  routes: { pass: ["confirm_write_prd"], rework: [], reject: [] },
  action: "确认需求",
  scope: "当前任务范围",
  policyReason: "需要人工确认",
  reviewArtifacts: [],
};

describe("ApprovalDecisionDialog", () => {
  it("requires a rejection reason", () => {
    expect(validateApprovalDecision({ decision: "rejected", reason: "" })).toBe("请填写驳回原因");
    expect(validateApprovalDecision({ decision: "changes_requested", reason: "" })).toBe("请填写退回原因");
    expect(validateApprovalDecision({ decision: "approved", reason: "" })).toBeNull();
  });

  it("renders the exact action, scope and policy reason", () => {
    const html = renderToStaticMarkup(<ApprovalDecisionSummary approval={{ id: "a1", type: "merge", taskTitle: "合并功能分支", action: "merge", scope: "main <- agent/task-1", policyReason: "主分支合并需要人工审批" }} />);

    expect(html).toContain("main &lt;- agent/task-1");
    expect(html).toContain("主分支合并需要人工审批");
    expect(html).toContain("merge");
  });

  it("renders task, Project, Loop and node context in decision order", () => {
    const html = renderToStaticMarkup(<ApprovalDecisionSummary approval={contextualApproval} />);

    expect(html).toContain("HUMANTHR1100003 · 优化任务详情交互");
    expect(html).toContain("humanthread");
    expect(html).toContain("Gelsang Project Loop · 确认需求");
    expect(html).toContain("确认需求是否完整");
  });

  it("derives only valid Human Gate decisions and auto-selects one route", () => {
    expect(getApprovalDecisionOptions(contextualApproval)).toEqual([
      { decision: "approved", edgeId: "confirm_write_prd", label: "同意" },
    ]);
    expect(getApprovalDecisionOptions({
      ...contextualApproval,
      routes: { pass: [], rework: ["back_to_analysis", "back_to_intake"], reject: ["stop_run"] },
    })).toEqual([
      { decision: "changes_requested", edgeId: null, label: "退回" },
      { decision: "rejected", edgeId: "stop_run", label: "拒绝" },
    ]);
    expect(getApprovalDecisionOptions({ ...contextualApproval, routes: null })).toEqual([]);
  });

  it("submits the exact selected Human Gate edge", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ApprovalDecisionDialog open approval={contextualApproval} onClose={vi.fn()} onDecided={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "确认同意" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      decision: "approved",
      reason: "",
      selectedEdgeId: "confirm_write_prd",
    });
  });

  it("blocks a Human Gate that has no configured route", () => {
    render(<ApprovalDecisionDialog open approval={{ ...contextualApproval, routes: null }} onClose={vi.fn()} onDecided={vi.fn()} />);

    expect(screen.getByRole("alert").textContent).toContain("confirm_requirement");
    expect((screen.getByRole("button", { name: "无法提交" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders an Agent-generated HTML review page inside a sandboxed preview", () => {
    render(<ApprovalDecisionDialog open approval={{
      ...contextualApproval,
      reviewArtifacts: [{
        artifactId: "a".repeat(32),
        fileName: "TASK-1001-chapter-plan.html",
        mimeType: "text/html",
        byteSize: 2048,
        checksum: "b".repeat(64),
        href: `/api/loop-artifacts/${"a".repeat(32)}`,
      }],
    }} onClose={vi.fn()} onDecided={vi.fn()} />);

    const preview = screen.getByTitle("审阅页：TASK-1001-chapter-plan.html");
    expect(preview.getAttribute("src")).toBe(`/api/loop-artifacts/${"a".repeat(32)}`);
    expect(preview.getAttribute("sandbox")).toBe("");
    expect(preview.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(screen.getByRole("link", { name: "在新窗口打开" }).getAttribute("href"))
      .toBe(`/api/loop-artifacts/${"a".repeat(32)}`);
  });

  it("shows the upstream node output so the approver can see what happened before", () => {
    render(<ApprovalDecisionDialog open approval={{
      ...contextualApproval,
      upstreamOutput: "规划校验为 PASS，审阅页已生成：generated/reviews/TASK-1001-chapter-plan.html",
    }} onClose={vi.fn()} onDecided={vi.fn()} />);

    expect(screen.getByText("上一节点产出")).toBeTruthy();
    expect(screen.getByText(/规划校验为 PASS/)).toBeTruthy();
  });
});
