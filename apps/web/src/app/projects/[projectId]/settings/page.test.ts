import { describe, expect, it } from "vitest";
import {
  PROJECT_SETTINGS_PAGE_TITLE,
  resolveProjectSettingsTab,
} from "./page";

describe("项目设置页", () => {
  it("uses the independent project settings title", () => {
    expect(PROJECT_SETTINGS_PAGE_TITLE).toBe("项目设置");
  });

  it("resolves only supported configuration tabs and defaults to overview", () => {
    expect(resolveProjectSettingsTab({})).toBe("overview");
    expect(resolveProjectSettingsTab({ tab: "short-code" })).toBe("short-code");
    expect(resolveProjectSettingsTab({ tab: "loops" })).toBe("loops");
    expect(resolveProjectSettingsTab({ tab: "environment" })).toBe("environment");
    expect(resolveProjectSettingsTab({ tab: "workers" })).toBe("workers");
    expect(resolveProjectSettingsTab({ tab: "onboarding" })).toBe("onboarding");
    expect(resolveProjectSettingsTab({ tab: "unknown" })).toBe("overview");
  });
});
