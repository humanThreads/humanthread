import { describe, expect, it } from "vitest";
import { projectApprovalDecisionItem } from "./approval-read-model";

describe("projectApprovalDecisionItem", () => {
  it("projects the upstream Agent output so the approver can see what the previous node did", () => {
    const result = projectApprovalDecisionItem({
      id: "approval_upstream",
      type: "loop_runtime_safety",
      status: "pending",
      projectId: "project_1",
      createdAt: new Date("2026-09-29T12:00:00.000Z"),
      project: { name: "humanthread" },
      taskId: null,
      task: null,
      loopRunId: "loop_run_root",
      loopRun: { id: "loop_run_root", taskId: null, task: null, loopVersion: null },
      loopNodeRunId: "node_run_platform_5",
      loopNodeRun: {
        id: "node_run_platform_5",
        nodeKey: "platform-action-5",
        inputSnapshot: {
          appServer: "规划校验为 PASS，审阅页已生成：generated/reviews/TASK-1001-chapter-plan.html",
          delivery: { required: false, evidence: null },
        },
        artifacts: [],
      },
      requestPayload: { actionFingerprint: "sha256:push" },
      policySnapshot: { reasonCode: "automation_grant_scope_miss" },
    });

    expect(result.upstreamOutput).toBe("规划校验为 PASS，审阅页已生成：generated/reviews/TASK-1001-chapter-plan.html");
  });

  it("bounds and sanitizes the projected upstream output", () => {
    const result = projectApprovalDecisionItem({
      id: "approval_upstream_long",
      type: "loop_runtime_safety",
      status: "pending",
      projectId: "project_1",
      createdAt: new Date("2026-09-29T12:00:00.000Z"),
      project: { name: "humanthread" },
      taskId: null,
      task: null,
      loopRunId: null,
      loopRun: null,
      loopNodeRunId: "node_run_platform_5",
      loopNodeRun: {
        id: "node_run_platform_5",
        nodeKey: "platform-action-5",
        inputSnapshot: { appServer: `\u0000${"a".repeat(5_000)}` },
        artifacts: [],
      },
      requestPayload: {},
      policySnapshot: {},
    });

    expect(result.upstreamOutput).toHaveLength(4_000);
    expect(result.upstreamOutput).not.toContain("\u0000");
  });

  it("recovers an all-empty historical Human Gate route set from its LoopVersion graph", () => {
    const result = projectApprovalDecisionItem({
      id: "approval_legacy_gate",
      type: "loop_human_gate",
      status: "pending",
      projectId: "project_1",
      createdAt: new Date("2026-08-11T10:00:00.000Z"),
      project: { name: "humanthread" },
      taskId: "task_1",
      task: { id: "task_1", shortId: "HUMANTHR1100003", title: "优化任务详情交互" },
      loopRunId: "loop_run_1",
      loopRun: {
        id: "loop_run_1",
        taskId: "task_1",
        task: { id: "task_1", shortId: "HUMANTHR1100003", title: "优化任务详情交互" },
        loopVersion: {
          loopDefinition: { name: "Gelsang Project Loop" },
          graph: {
            schemaVersion: 1,
            inputSchema: {},
            outputSchema: {},
            limits: { maxStages: 3, maxRepeatCount: 1 },
            nodes: [
              { key: "start", label: "开始", type: "start" },
              { key: "confirm_requirement", label: "确认需求", type: "human_gate", executionTarget: "platform" },
              { key: "write_prd", label: "编写 PRD", type: "end" },
            ],
            edges: [
              { id: "gelsang_confirm_requirement_write_prd", source: "confirm_requirement", target: "write_prd", kind: "normal", outcome: "success" },
            ],
          },
        },
      },
      loopNodeRunId: "node_run_1",
      loopNodeRun: { id: "node_run_1", nodeKey: "confirm_requirement" },
      requestPayload: { routes: { pass: [], rework: [], reject: [] } },
      policySnapshot: { reason: "需求确认需要人工审批" },
    });

    expect(result.routes).toEqual({
      pass: ["gelsang_confirm_requirement_write_prd"],
      rework: [],
      reject: [],
    });
  });

  it("projects task, Loop, node and Human Gate route context", () => {
    const result = projectApprovalDecisionItem({
      id: "approval_1",
      type: "loop_human_gate",
      status: "pending",
      projectId: "project_1",
      createdAt: new Date("2026-08-11T10:00:00.000Z"),
      project: { name: "humanthread" },
      taskId: "task_1",
      task: { id: "task_1", shortId: "HUMANTHR1100003", title: "优化任务详情交互" },
      loopRunId: "loop_run_1",
      loopRun: {
        id: "loop_run_1",
        taskId: "task_1",
        task: { id: "task_1", shortId: "HUMANTHR1100003", title: "优化任务详情交互" },
        loopVersion: {
          loopDefinition: { name: "Gelsang Project Loop" },
          graph: { nodes: [{ key: "confirm_requirement", label: "确认需求" }] },
        },
      },
      loopNodeRunId: "node_run_1",
      loopNodeRun: { id: "node_run_1", nodeKey: "confirm_requirement" },
      requestPayload: {
        prompt: "请确认需求文档范围",
        routes: { pass: ["confirm_write_prd"], rework: [], reject: [] },
      },
      policySnapshot: { reason: "需求确认需要人工审批" },
    });

    expect(result).toMatchObject({
      taskShortId: "HUMANTHR1100003",
      taskTitle: "优化任务详情交互",
      projectName: "humanthread",
      loopLabel: "Gelsang Project Loop",
      nodeKey: "confirm_requirement",
      nodeLabel: "确认需求",
      prompt: "请确认需求文档范围",
      routes: { pass: ["confirm_write_prd"], rework: [], reject: [] },
    });
  });

  it("keeps an unrelated approval readable when optional context and routes are malformed", () => {
    const result = projectApprovalDecisionItem({
      id: "approval_legacy",
      type: "merge",
      status: "pending",
      projectId: "project_1",
      createdAt: new Date("2026-08-11T10:00:00.000Z"),
      project: null,
      taskId: null,
      task: null,
      loopRunId: null,
      loopRun: null,
      loopNodeRunId: null,
      loopNodeRun: null,
      requestPayload: { routes: { pass: ["edge_1"], rework: "not-an-array", reject: [] } },
      policySnapshot: null,
    });

    expect(result).toMatchObject({
      taskId: null,
      taskShortId: null,
      taskTitle: null,
      projectName: null,
      loopRunId: null,
      loopLabel: null,
      loopNodeRunId: null,
      nodeKey: null,
      nodeLabel: null,
      prompt: null,
      routes: null,
      action: "merge",
      scope: "当前任务范围",
      policyReason: "该操作需要人工审批",
    });
  });

  it("keeps the emitted task identity aligned with Loop task context", () => {
    const result = projectApprovalDecisionItem({
      id: "approval_stale_task_id",
      type: "loop_human_gate",
      status: "pending",
      projectId: "project_1",
      createdAt: new Date("2026-08-11T10:00:00.000Z"),
      project: { name: "humanthread" },
      taskId: "task_stale",
      task: null,
      loopRunId: "loop_run_1",
      loopRun: {
        id: "loop_run_1",
        taskId: "task_loop",
        task: { id: "task_loop", shortId: "HUMANTHR1100003", title: "优化任务详情交互" },
        loopVersion: null,
      },
      loopNodeRunId: null,
      loopNodeRun: null,
      requestPayload: {},
      policySnapshot: {},
    });

    expect(result).toMatchObject({
      taskId: "task_loop",
      taskShortId: "HUMANTHR1100003",
      taskTitle: "优化任务详情交互",
    });
  });

  it("projects only the review HTML produced by the upstream child Loop", () => {
    const result = projectApprovalDecisionItem({
      id: "approval_review",
      type: "loop_runtime_safety",
      status: "pending",
      projectId: "project_1",
      createdAt: new Date("2026-09-29T12:00:00.000Z"),
      project: { name: "humanthread" },
      taskId: null,
      task: null,
      loopRunId: "loop_run_root",
      loopRun: {
        id: "loop_run_root",
        taskId: null,
        task: null,
        loopVersion: null,
      },
      loopNodeRunId: "node_run_platform_5",
      loopNodeRun: {
        id: "node_run_platform_5",
        nodeKey: "platform-action-5",
        inputSnapshot: {
          childLoopRunId: "loop_run_child",
          childStatus: "completed",
          reviewArtifacts: [{
            artifactId: "a".repeat(32),
            fileName: "TASK-1001-chapter-plan.html",
            mimeType: "text/html",
            byteSize: 42,
            checksum: "b".repeat(64),
          }],
        },
        artifacts: [{
          id: "c".repeat(32),
          type: "review_html",
          mimeType: "text/html",
          byteSize: 12n,
          metadata: {
            fileName: "direct-review.html",
            relativePath: "generated/reviews/direct-review.html",
          },
        }],
      },
      requestPayload: { actionFingerprint: "sha256:push" },
      policySnapshot: { reasonCode: "automation_grant_scope_miss" },
    });

    expect(result.reviewArtifacts).toEqual([
      {
        artifactId: "a".repeat(32),
        fileName: "TASK-1001-chapter-plan.html",
        mimeType: "text/html",
        byteSize: 42,
        checksum: "b".repeat(64),
        href: `/api/loop-artifacts/${"a".repeat(32)}`,
      },
      {
        artifactId: "c".repeat(32),
        fileName: "direct-review.html",
        mimeType: "text/html",
        byteSize: 12,
        href: `/api/loop-artifacts/${"c".repeat(32)}`,
      },
    ]);
  });

  it("drops malformed or executable review Artifact references", () => {
    const result = projectApprovalDecisionItem({
      id: "approval_review_invalid",
      type: "loop_runtime_safety",
      status: "pending",
      projectId: "project_1",
      createdAt: new Date("2026-09-29T12:00:00.000Z"),
      project: null,
      taskId: null,
      task: null,
      loopRunId: null,
      loopRun: null,
      loopNodeRunId: null,
      loopNodeRun: {
        id: "node_run_1",
        nodeKey: "review",
        inputSnapshot: {
          reviewArtifacts: [
            { artifactId: "../escape", fileName: "escape.html", mimeType: "text/html", byteSize: 1 },
            { artifactId: "a".repeat(32), fileName: "script.js", mimeType: "text/javascript", byteSize: 1 },
          ],
        },
      },
      requestPayload: {},
      policySnapshot: {},
    });

    expect(result.reviewArtifacts).toEqual([]);
  });
});
