import { describe, expect, it } from "vitest";

import { buildDesktopReadModelPath } from "./read-model-query";

describe("desktop read-first query boundary", () => {
  it("adds the selected public Space and preserves report filters", () => {
    expect(buildDesktopReadModelPath(
      "/api/desktop/reports",
      "company:company_1",
      { range: "90d", project: "project_1" },
    )).toBe(
      "/api/desktop/reports?range=90d&project=project_1&space=company%3Acompany_1",
    );
  });
});
