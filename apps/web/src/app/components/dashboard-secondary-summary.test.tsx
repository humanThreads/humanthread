import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectListItem } from "../../lib/workbench/workbench-projects";
import { DashboardSecondarySummary } from "./dashboard-secondary-summary";

function project(id: string, health: ProjectListItem["health"]): ProjectListItem {
  return {
    id,
    spaceId: "space_1",
    spaceLabel: "个人空间",
    name: `项目 ${id}`,
    objectiveExcerpt: null,
    owner: null,
    status: "active",
    health,
    stageProgress: { completed: 0, total: 0, percent: 0 },
    openTaskCount: 0,
    overdueTaskCount: 0,
    blockedTaskCount: 0,
    nextMilestone: null,
    updatedAt: new Date("2026-07-24T00:00:00.000Z"),
  };
}

describe("DashboardSecondarySummary", () => {
  it("prioritizes risk and limits the project list to three entries", () => {
    const markup = renderToStaticMarkup(<DashboardSecondarySummary
      projects={[project("healthy", "healthy"), project("complete", "complete"), project("blocked", "blocked"), project("risk", "at_risk")]}
      members={[]}
      activeRuns={0}
      selectedSpaceKey="personal"
    />);

    expect(markup).toContain("项目 blocked");
    expect(markup).toContain("项目 risk");
    expect(markup).toContain("项目 healthy");
    expect(markup).not.toContain("项目 complete");
    expect(markup).toContain("未自动化");
  });
});
