import { describe, expect, it } from "vitest";
import {
  dynamic,
  PROJECT_DETAIL_CONTENT_MODE,
  PROJECT_DETAIL_SECTION_TITLES,
  resolveLegacyProjectSettingsHref,
} from "./page";
import {
  getWorkbenchProjectDetail,
} from "../../../lib/workbench/workbench-projects";
import { listProjectDocuments } from "../../../lib/workbench/workbench-documents";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";

describe("Project detail page", () => {
  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("uses the workspace shell and lets the project hub own its header", () => {
    expect(PROJECT_DETAIL_CONTENT_MODE).toBe("workspace");
  });

  it("uses the workbench project, document and session queries", () => {
    expect(typeof requireWorkbenchSession).toBe("function");
    expect(typeof getWorkbenchProjectDetail).toBe("function");
    expect(typeof listProjectDocuments).toBe("function");
  });

  it("keeps project detail sections stable", () => {
    expect(PROJECT_DETAIL_SECTION_TITLES).toEqual([
      "项目目标",
      "交付阶段",
      "里程碑",
      "任务队列",
      "项目资源",
    ]);
  });

  it("redirects legacy configuration links to the dedicated settings route", () => {
    expect(resolveLegacyProjectSettingsHref("project_1", {})).toBeNull();
    expect(resolveLegacyProjectSettingsHref("project_1", { tab: "settings" })).toBe("/projects/project_1/settings?tab=overview");
    expect(resolveLegacyProjectSettingsHref("project_1", { tab: "loops" })).toBe("/projects/project_1/settings?tab=loops");
    expect(resolveLegacyProjectSettingsHref("project_1", { settings: "1" })).toBe("/projects/project_1/settings?tab=overview");
    expect(resolveLegacyProjectSettingsHref("project_1", { tab: "unknown" })).toBeNull();
  });
});
