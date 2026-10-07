import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoopMonitor } from "./loop-monitor";

const loop = {
  id: "loop_1",
  taskId: "task_1",
  taskTitle: "实现审批恢复",
  loopName: "分支开发",
  scope: "project" as const,
  parentLoopRunId: null,
  parentLoopName: null,
  waitingReason: "child_loop",
  status: "running",
  currentIteration: 2,
  maxIterations: 5,
  attempt: 3,
  lastHeartbeatAt: new Date("2026-07-21T01:00:00.000Z"),
};

describe("LoopMonitor", () => {
  it("renders phase, iteration, attempt and budget", () => {
    const html = renderToStaticMarkup(<LoopMonitor loops={[loop]} canManage />);
    expect(html).toContain("Loop Monitor");
    expect(html).toContain("2 / 5");
    expect(html).toContain("Attempt 3");
    expect(html).toContain("暂停");
    expect(html).toContain('/loop-runs/loop_1');
  });

  it("hides mutation controls for viewers", () => {
    const html = renderToStaticMarkup(<LoopMonitor loops={[loop]} canManage={false} />);
    expect(html).not.toContain("暂停");
    expect(html).not.toContain("取消 Loop");
  });

  it("distinguishes project and task Loops with their parent relationship", () => {
    const taskLoop = {
      ...loop,
      id: "loop_2",
      loopName: "Gelsang Project Loop",
      scope: "task" as const,
      parentLoopRunId: "loop_1",
      parentLoopName: "分支开发",
      waitingReason: null,
    };

    const html = renderToStaticMarkup(<LoopMonitor loops={[loop, taskLoop]} canManage={false} />);

    expect(html).toContain("项目级");
    expect(html).toContain("任务级");
    expect(html).toContain("分支开发");
    expect(html).toContain("Gelsang Project Loop");
    expect(html).toContain("父 Loop：分支开发");
    expect(html).toContain("等待任务级 Loop");
  });

  it("keeps terminal failures out of the live monitor", () => {
    const html = renderToStaticMarkup(<LoopMonitor loops={[{
      ...loop,
      id: "loop_failed_1",
      status: "failed",
      waitingReason: "runtime_safety_expired",
    }]} canManage />);

    expect(html).not.toContain("运行安全审批已过期");
    expect(html).not.toContain("取消 Loop");
  });
});
