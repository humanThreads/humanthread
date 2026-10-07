import { describe, expect, it } from "vitest";
import { dynamic, TEAM_PAGE_SECTION_TITLES } from "./page";
import { getWorkbenchCompanyFilters } from "../../lib/workbench/workbench-companies";
import { getWorkbenchOverview } from "../../lib/workbench/workbench-overview";
import { PROJECT_SPACE_SEARCH_PARAM } from "../../lib/workbench/workbench-space-filters";
import { WORKBENCH_NAV_ITEMS } from "../components/workbench-nav";

describe("Team collaboration page", () => {
  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("uses the shared workbench overview query for team data", () => {
    expect(typeof getWorkbenchOverview).toBe("function");
  });

  it("loads company filters so team collaboration can filter tasks by space", () => {
    expect(typeof getWorkbenchCompanyFilters).toBe("function");
    expect(PROJECT_SPACE_SEARCH_PARAM).toBe("space");
  });

  it("is registered in the workbench navigation", () => {
    expect(
      WORKBENCH_NAV_ITEMS.find((item) => item.key === "team"),
    ).toMatchObject({
      href: "/team",
      label: "团队协作",
      key: "team",
    });
  });

  it("keeps team collaboration sections focused on member threads", () => {
    expect(TEAM_PAGE_SECTION_TITLES).toEqual([
      "当前关注任务",
      "成员线程",
      "阻塞与中断",
      "团队概览",
    ]);
  });

  it("keeps the task center handoff available from team coordination", () => {
    expect(
      WORKBENCH_NAV_ITEMS.find((item) => item.key === "tasks"),
    ).toMatchObject({
      href: "/tasks",
      label: "任务中心",
    });
  });
});
