import { describe, expect, it } from "vitest";
import {
  PROJECT_SPACE_SEARCH_PARAM,
  WORKBENCH_SPACE_COOKIE,
  buildWorkbenchSpaceHref,
  getPreferredWorkbenchSpaceKey,
  getWorkbenchSpaceFiltersForMenu,
  selectWorkbenchProjectSpaceFilter,
} from "./workbench-space-filters";
import type { WorkbenchCompanyFilter } from "./workbench-companies";

const filters: WorkbenchCompanyFilter[] = [
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
    ownerType: "personal",
  },
  {
    key: "company_1",
    label: "Alpha",
    companyId: "company_1",
    ownerType: "company",
  },
];

describe("workbench space filters", () => {
  it("uses a stable query parameter for company and personal project filters", () => {
    expect(PROJECT_SPACE_SEARCH_PARAM).toBe("space");
    expect(WORKBENCH_SPACE_COOKIE).toBe("ht_workbench_space");
  });

  it("prefers the URL-selected space over the remembered cookie space", () => {
    expect(
      getPreferredWorkbenchSpaceKey({
        searchParamValue: "company_1",
        cookieValue: "personal",
      }),
    ).toBe("company_1");
  });

  it("falls back to the remembered cookie space when URL space is missing", () => {
    expect(
      getPreferredWorkbenchSpaceKey({
        searchParamValue: undefined,
        cookieValue: " personal ",
      }),
    ).toBe("personal");
  });

  it("selects only an accessible company or personal project filter", () => {
    expect(selectWorkbenchProjectSpaceFilter(filters, "company_1")).toEqual(
      filters[2],
    );
    expect(selectWorkbenchProjectSpaceFilter(filters, "company_hidden")).toEqual(
      filters[0],
    );
  });

  it("builds page-local links for project space filters", () => {
    expect(buildWorkbenchSpaceHref("/team", filters[0]!)).toBe("/team");
    expect(buildWorkbenchSpaceHref("/team", filters[1]!)).toBe(
      "/team?space=personal",
    );
    expect(buildWorkbenchSpaceHref("/projects", filters[2]!)).toBe(
      "/projects?space=company_1",
    );
  });

  it("keeps the avatar menu space selector populated with personal and company spaces", () => {
    expect(
      getWorkbenchSpaceFiltersForMenu({
        userCompanyFilters: [
          {
            key: "company_1",
            label: "HumanThread Company",
            companyId: "company_1",
            ownerType: "company",
          },
        ],
      }).map((filter) => filter.label),
    ).toEqual(["全部", "个人空间", "HumanThread Company"]);
  });
});
