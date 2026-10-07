import { describe, expect, it } from "vitest";
import {
  dynamic,
  PROJECTS_CONTENT_MODE,
  PROJECTS_PAGE_SECTION_TITLES,
} from "./page";
import {
  PROJECT_SPACE_SEARCH_PARAM,
  selectWorkbenchProjectSpaceFilter,
} from "../../lib/workbench/workbench-space-filters";
import { getWorkbenchProjects } from "../../lib/workbench/workbench-projects";
import { WORKBENCH_NAV_ITEMS } from "../components/workbench-nav";

describe("Project space page", () => {
  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("uses the workspace shell without a duplicate page title bar", () => {
    expect(PROJECTS_CONTENT_MODE).toBe("workspace");
  });

  it("uses the shared project overview query", () => {
    expect(typeof getWorkbenchProjects).toBe("function");
  });

  it("uses a stable query parameter for company and personal project filters", () => {
    expect(PROJECT_SPACE_SEARCH_PARAM).toBe("space");
  });

  it("selects only an accessible company or personal project filter", () => {
    const filters = [
      {
        key: "all",
        label: "全部",
        companyId: null,
        ownerType: null,
      },
      {
        key: "personal",
        label: "个人空间",
        companyId: null,
        ownerType: "personal" as const,
      },
      {
        key: "company_1",
        label: "Alpha",
        companyId: "company_1",
        ownerType: "company" as const,
      },
    ];

    expect(selectWorkbenchProjectSpaceFilter(filters, "company_1")).toEqual(
      filters[2],
    );
    expect(selectWorkbenchProjectSpaceFilter(filters, "company_hidden")).toEqual(
      filters[0],
    );
  });

  it("is registered in the workbench navigation", () => {
    expect(
      WORKBENCH_NAV_ITEMS.find((item) => item.key === "projects"),
    ).toMatchObject({
      href: "/projects",
      label: "项目空间",
      key: "projects",
    });
  });

  it("keeps project space sections stable", () => {
    expect(PROJECTS_PAGE_SECTION_TITLES).toEqual([
      "项目列表",
      "项目概览",
      "项目入口",
    ]);
  });
});
