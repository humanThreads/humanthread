import { describe, expect, it } from "vitest";
import { buildProjectScheduledTaskReport } from "./scheduled-task-report";

describe("buildProjectScheduledTaskReport", () => {
  it("summarizes nodes and failures without generating narrative content", () => {
    expect(buildProjectScheduledTaskReport({
      runStatus: "failed",
      startedAt: "2026-09-22T01:00:00.000Z",
      finishedAt: "2026-09-22T01:01:30.000Z",
      nodes: [
        { nodeKey: "inspect", label: "检查", status: "completed", error: null, result: { summary: "通过" }, artifactRefs: [] },
        { nodeKey: "report", label: "报告", status: "failed", error: { code: "provider_error", message: "模型失败" }, result: null, artifactRefs: ["report.md"] },
      ],
    })).toEqual({
      status: "failed",
      durationMs: 90_000,
      completedNodes: 1,
      totalNodes: 2,
      failures: [{ nodeKey: "report", label: "报告", code: "provider_error", message: "模型失败" }],
      artifactRefs: ["report.md"],
      primaryArtifactRef: "report.md",
    });
  });

  it("uses stable defaults and prefers a report artifact over another artifact", () => {
    expect(buildProjectScheduledTaskReport({
      runStatus: "blocked",
      startedAt: null,
      finishedAt: null,
      nodes: [
        { nodeKey: "render", label: "渲染", status: "failed", error: { code: "", message: "" }, result: null, artifactRefs: ["output.zip", "report.json"] },
        { nodeKey: "inspect", label: "检查", status: "completed", error: null, result: null, artifactRefs: ["report.json"] },
      ],
    })).toEqual({
      status: "blocked",
      durationMs: null,
      completedNodes: 1,
      totalNodes: 2,
      failures: [{ nodeKey: "render", label: "渲染", code: "loop_node_failed", message: "节点执行失败" }],
      artifactRefs: ["output.zip", "report.json"],
      primaryArtifactRef: "report.json",
    });
  });
});
