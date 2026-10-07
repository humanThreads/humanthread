import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectExecutionOverview } from "./project-execution-overview";

describe("ProjectExecutionOverview", () => {
  it("renders delivery progress, ready work, active runs and approvals", () => {
    const html = renderToStaticMarkup(
      <ProjectExecutionOverview
        project={{ name: "HumanThread", objective: "Deliver agent orchestration", status: "active" }}
        stages={[{ id: "s1", name: "Delivery", status: "active", completedMilestones: 1, totalMilestones: 2 }]}
        milestones={[{ id: "m1", name: "MVP", status: "at_risk", riskSummary: "Lease drill pending" }]}
        tasks={[{ id: "t1", title: "Build kernel", status: "ready", priority: 0 }]}
        activeRuns={2}
        pendingApprovals={1}
      />,
    );
    expect(html).toContain("Deliver agent orchestration");
    expect(html).toContain("就绪任务");
    expect(html).toContain("运行中 Agent");
    expect(html).toContain("待审批");
    expect(html).toContain("Lease drill pending");
  });
});
