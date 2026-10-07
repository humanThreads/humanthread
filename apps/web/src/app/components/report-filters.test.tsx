import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportFilters, buildReportHref } from "./report-filters";

describe("ReportFilters", () => {
  it("clears project scope while preserving Space and range", () => {
    expect(buildReportHref({ spaceKey: "company:1", range: "30d" })).toBe(
      "/reports?range=30d&space=company%3A1",
    );
  });

  it("renders an empty project option in the GET filter form", () => {
    const markup = renderToStaticMarkup(<ReportFilters
      spaces={[{ key: "all", label: "全部", companyId: null, ownerType: null }]}
      projects={[]}
      selectedSpaceKey="all"
      selectedProjectId="project_missing"
      range="30d"
    />);

    expect(markup).toContain('<option value="">全部项目</option>');
    expect(markup).toContain('name="range" value="30d"');
  });
});
