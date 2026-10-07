// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectSettingsTabs } from "./project-settings-tabs";

afterEach(cleanup);

describe("ProjectSettingsTabs", () => {
  it("renders Chinese configuration navigation under the dedicated settings route", () => {
    render(<ProjectSettingsTabs projectId="project_1" activeTab="environment" canEdit><div>内容</div></ProjectSettingsTabs>);

    expect(screen.getByRole("link", { name: "项目概览" }).getAttribute("href")).toBe("/projects/project_1/settings?tab=overview");
    expect(screen.getByRole("link", { name: "环境与凭证" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Worker 部署" }).getAttribute("href")).toBe("/projects/project_1/settings?tab=workers");
  });

  it("does not expose editable configuration navigation to read-only members", () => {
    render(<ProjectSettingsTabs projectId="project_1" activeTab="overview" canEdit={false}><div>内容</div></ProjectSettingsTabs>);

    expect(screen.queryByRole("link", { name: "环境与凭证" })).toBeNull();
    expect(screen.getByText("内容")).toBeTruthy();
  });
});
