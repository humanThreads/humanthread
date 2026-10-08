import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HelpPage, { HELP_FEATURES, HELP_QUICK_LINKS } from "./page";
import { DEFAULT_SOURCE_REPOSITORY_URL } from "../components/public-home";

describe("帮助中心", () => {
  it("覆盖平台的全部核心功能", () => {
    expect(HELP_FEATURES.map((feature) => feature.key)).toEqual([
      "space",
      "project",
      "task",
      "document",
      "agent",
      "loop",
      "run",
      "approval",
      "knowledge",
      "schedule",
      "worker",
      "live-session",
      "mcp",
      "download",
      "security",
    ]);
  });

  it("每个功能都给出说明、使用步骤和注意事项", () => {
    for (const feature of HELP_FEATURES) {
      expect(feature.title.trim().length).toBeGreaterThan(0);
      expect(feature.summary.trim().length).toBeGreaterThan(0);
      expect(feature.steps.length).toBeGreaterThanOrEqual(2);
      expect(feature.note.trim().length).toBeGreaterThan(0);
    }
  });

  it("渲染功能目录、快速入口与 GitHub 地址", () => {
    const markup = renderToStaticMarkup(<HelpPage />);
    expect(markup).toContain("HumanThread 帮助中心");
    for (const feature of HELP_FEATURES) {
      expect(markup).toContain(`id="${feature.key}"`);
      expect(markup).toContain(feature.title);
    }
    for (const link of HELP_QUICK_LINKS) {
      expect(markup).toContain(`href="${link.href}"`);
    }
    expect(markup).toContain(`href="${DEFAULT_SOURCE_REPOSITORY_URL}"`);
    expect(markup).toContain(`${DEFAULT_SOURCE_REPOSITORY_URL}/issues`);
  });

  it("提供返回工作台和返回首页的入口", () => {
    const markup = renderToStaticMarkup(<HelpPage />);
    expect(markup).toContain('href="/"');
    expect(markup).toContain('href="/login?redirectTo=%2Fdashboard"');
  });
});
