import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  Callout,
  EmptyState,
  KpiCard,
  Panel,
  PageHeader,
  StatusPill,
  SegmentedControl,
  WorkbenchButton,
  getWorkbenchButtonClassName,
} from "./workbench-ui";

describe("workbench UI primitives", () => {
  it("generates GitHub-like button variants", () => {
    expect(getWorkbenchButtonClassName({ variant: "primary" })).toContain(
      "bg-[#1f883d]",
    );
    expect(getWorkbenchButtonClassName({ variant: "danger" })).toContain(
      "text-[#cf222e]",
    );
    expect(getWorkbenchButtonClassName({ size: "small" })).toContain("px-2.5");
  });

  it("renders panel, header, KPI, empty and callout components", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(PageHeader, {
          title: "项目空间",
          subtitle: "项目上下文",
        }),
        createElement(Panel, { title: "项目列表" }, "内容"),
        createElement(KpiCard, {
          label: "当前任务",
          value: "3",
          caption: "今日窗口",
        }),
        createElement(EmptyState, {
          title: "暂无项目",
          description: "当前空间还没有可访问项目。",
        }),
        createElement(Callout, { title: "只读状态" }, "当前功能仅展示。"),
        createElement(StatusPill, { tone: "success" }, "已授权"),
        createElement(SegmentedControl, {
          items: [
            { key: "all", label: "全部", href: "/" },
            { key: "personal", label: "个人空间", href: "/?space=personal" },
          ],
          activeKey: "all",
        }),
        createElement(WorkbenchButton, { variant: "secondary" }, "返回"),
      ),
    );

    expect(markup).toContain("项目空间");
    expect(markup).toContain("暂无项目");
    expect(markup).toContain("已授权");
    expect(markup).toContain("个人空间");
  });
});
