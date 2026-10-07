// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminSettingsTabs } from "./admin-settings-tabs";

describe("AdminSettingsTabs", () => {
  it("提供站点域名、文件存储、Worker 镜像目录三个设置 Tab", () => {
    render(<AdminSettingsTabs activeTab="site" />);

    expect(screen.getByRole("link", { name: "站点域名" }).getAttribute("href")).toBe("/settings/admin?tab=site");
    expect(screen.getByRole("link", { name: "文件存储" }).getAttribute("href")).toBe("/settings/admin?tab=storage");
    expect(screen.getByRole("link", { name: "Worker 镜像目录" }).getAttribute("href")).toBe("/settings/admin?tab=worker-images");
    expect(screen.getByRole("link", { name: "站点域名" }).getAttribute("aria-current")).toBe("page");
  });
});
