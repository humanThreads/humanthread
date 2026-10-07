import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGENT_CENTER_DISPATCH_LABELS,
  dynamic,
  AGENT_CENTER_SECTION_TITLES,
} from "./page";
import { WORKBENCH_NAV_ITEMS } from "../components/workbench-nav";

describe("Agent center page", () => {
  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("is registered in the workbench navigation", () => {
    expect(
      WORKBENCH_NAV_ITEMS.find((item) => item.key === "agents"),
    ).toMatchObject({
      href: "/agents",
      label: "Agent 中心",
      key: "agents",
    });
  });

  it("exposes the live session entry beside the Agent control plane", () => {
    expect(WORKBENCH_NAV_ITEMS.find((item) => item.key === "live-sessions")).toMatchObject({
      href: "/live-sessions",
      label: "在线会话",
    });
  });

  it("keeps live sessions and Loop runs on their own navigation highlights", () => {
    const source = readFileSync(new URL("../live-sessions/page.tsx", import.meta.url), "utf8");
    const runs = readFileSync(new URL("../loop-runs/page.tsx", import.meta.url), "utf8");
    expect(source).toContain('activeKey="live-sessions"');
    expect(runs).toContain('activeKey="loop-runs"');
  });

  it("keeps agent center sections stable", () => {
    expect(AGENT_CENTER_SECTION_TITLES).toEqual([
      "Profiles",
      "Workers",
      "Loop Monitor",
      "执行尝试",
      "审批箱",
    ]);
  });

  it("keeps dispatch entry copy aligned with task-center intent views", () => {
    expect(AGENT_CENTER_DISPATCH_LABELS).toEqual([
      "派发任务",
      "暂停运行",
      "审批操作",
    ]);
  });

  it("resolves the selected Space from the shared URL parameter", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    expect(source).toContain("searchParamValue: getSingleWorkbenchSearchParam(raw, PROJECT_SPACE_SEARCH_PARAM)");
  });
});
