import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentRunTabs } from "./agent-run-tabs";

const loop = {
  id: "loop_1",
  taskId: "task_1",
  taskTitle: "实现审批恢复",
  loopName: "分支开发",
  scope: "project" as const,
  parentLoopRunId: null,
  parentLoopName: null,
  waitingReason: null,
  status: "running",
  currentIteration: 2,
  maxIterations: 5,
  attempt: 3,
  lastHeartbeatAt: new Date("2026-07-21T01:00:00.000Z"),
};

const run = {
  id: "run_1",
  loopRunId: "loop_1",
  nodeKey: "develop",
  taskTitle: "实现审批恢复",
  status: "running",
  attempt: 3,
  provider: "codex",
  workerName: "Mac Studio",
  lastHeartbeatAt: null,
};

describe("AgentRunTabs", () => {
  it("shows Loop Monitor by default without rendering execution history", () => {
    const html = renderToStaticMarkup(<AgentRunTabs activeView="monitor" loops={[loop]} runs={[run]} canManage nextCursor="cursor_2" selectedSpaceKey="company_1" />);

    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Loop Monitor");
    expect(html).toContain("实现审批恢复");
    expect(html).not.toContain("节点 develop");
    expect(html).toContain("/agents?space=company_1&amp;view=attempts");
  });

  it("shows one bounded history page and a cursor link for older attempts", () => {
    const html = renderToStaticMarkup(<AgentRunTabs activeView="attempts" loops={[loop]} runs={[run]} canManage nextCursor="cursor_2" selectedSpaceKey="company_1" />);

    expect(html).toContain("节点 develop");
    expect(html).not.toContain("迭代预算");
    expect(html).toContain("继续查看较早记录");
    expect(html).toContain("cursor=cursor_2");
    expect(html).toContain("space=company_1");
  });
});
