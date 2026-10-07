import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentControlPlane } from "./agent-control-plane";

describe("AgentControlPlane", () => {
  it("renders profiles, stale workers and approvals without run history", () => {
    const html = renderToStaticMarkup(<AgentControlPlane profiles={[{ id: "p1", spaceId: "space_1", name: "Codex", provider: "codex", status: "active", model: null }]} workers={[{ id: "w1", name: "Mac", runtimeType: "local_agent", agentVersion: "Agent v0.1.2 · e16bff4c", status: "offline", activeRunCount: 0, maxConcurrentRuns: 1, lastHeartbeatAt: null }, { id: "w2", name: "Old Mac", runtimeType: "local_agent", agentVersion: null, status: "offline", activeRunCount: 0, maxConcurrentRuns: 1, lastHeartbeatAt: null }]} approvals={[{ id: "a1", type: "merge", status: "pending", taskTitle: "Integrate", action: "merge", scope: "main", policyReason: "主分支合并需要审批", createdAt: new Date("2026-07-21T00:00:00.000Z") }]}><div>运行视图</div></AgentControlPlane>);
    expect(html).toContain("Profiles");
    expect(html).toContain("Workers");
    expect(html).not.toContain("执行尝试");
    expect(html).toContain("审批箱");
    expect(html).toContain("离线");
    expect(html).toContain("主分支合并需要审批");
    expect(html).toContain("Agent v0.1.2 · e16bff4c");
    expect(html).toContain("版本未知");
    expect(html.indexOf("运行视图")).toBeLessThan(html.indexOf("审批箱"));
  });

  it("leads an approval with task identity and execution context", () => {
    const html = renderToStaticMarkup(<AgentControlPlane profiles={[]} workers={[]} approvals={[{
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
    }]} />);

    expect(html).toContain("HUMANTHR1100003 · 优化任务详情交互");
    expect(html).toContain("humanthread · Gelsang Project Loop · 确认需求");
    expect(html).toContain("确认需求是否完整");
    expect(html).toContain("loop_human_gate");
  });

  it("shows only the task group and live replica count for Kubernetes Worker pools", () => {
    const html = renderToStaticMarkup(<AgentControlPlane
      profiles={[]}
      workers={[]}
      workerPools={[{
        id: "a".repeat(32),
        displayName: "ht-agnet",
        health: "idle",
        currentRuns: 0,
        capacity: 2,
        runtime: "kubernetes",
        taskGroupName: "ht-agnet",
        aliveInstanceCount: 2,
        instances: [],
      }]}
      approvals={[]}
    />);

    expect(html).toContain("Kubernetes 任务组 ht-agnet");
    expect(html).toContain("存活实例 2");
    expect(html).not.toContain("ht-agnet-7b9c5d6f8-abcde");
  });

  it("shows Agent Profile management only for the selected manageable Space", () => {
    const html = renderToStaticMarkup(<AgentControlPlane
      profiles={[{ id: "p1", spaceId: "space_1", name: "Gelsang Codex", provider: "codex", status: "active", model: null }]}
      workers={[]}
      approvals={[]}
      canManageProfiles
      selectedSpaceId="space_1"
    />);

    expect(html).toContain("新建 Profile");
    expect(html).toContain("停用 Gelsang Codex");
  });

  it("hides Agent Profile management when no concrete Space is selected", () => {
    const html = renderToStaticMarkup(<AgentControlPlane
      profiles={[{ id: "p1", spaceId: "space_1", name: "Gelsang Codex", provider: "codex", status: "active", model: null }]}
      workers={[]}
      approvals={[]}
      canManageProfiles
      selectedSpaceId={null}
    />);

    expect(html).not.toContain("新建 Profile");
    expect(html).not.toContain("停用 Gelsang Codex");
  });
});
