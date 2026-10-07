import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SettingsLayout,
  getSettingsNavigation,
} from "./settings-layout";
import type { WorkbenchSettingsContext } from "../../lib/workbench/workbench-settings-context";

const context: WorkbenchSettingsContext = {
  user: {
    id: "user_1",
    name: "Alice",
    email: "alice@example.com",
    avatarUrl: null,
    status: "active",
  },
  companies: [
    {
      id: "company_1",
      name: "HumanThread",
      logoUrl: null,
      role: "owner",
      canManage: true,
    },
  ],
  isSiteAdmin: false,
};

describe("settings layout", () => {
  it("groups routes by personal, company and authorized platform scope", () => {
    const navigation = getSettingsNavigation({ ...context, isSiteAdmin: true });

    expect(navigation.map((group) => group.label)).toEqual([
      "个人",
      "公司",
      "平台",
    ]);
    expect(navigation[0]?.items.map((item) => item.href)).toEqual([
      "/settings/account",
      "/settings/security",
      "/settings/devices",
      "/settings/mcp",
      "/settings/workers",
    ]);
    expect(navigation[1]?.items.map((item) => item.href)).toEqual([
      "/settings/companies",
    ]);
    expect(navigation[2]?.items.map((item) => item.href)).toEqual([
      "/settings/admin",
    ]);
  });

  it("does not disclose platform settings to a non-site-admin", () => {
    const navigation = getSettingsNavigation(context);

    expect(navigation.map((group) => group.label)).toEqual(["个人", "公司"]);
    expect(navigation.flatMap((group) => group.items).map((item) => item.href))
      .not.toContain("/settings/admin");
  });

  it("renders a desktop navigation, one mobile trigger and children", () => {
    const markup = renderToStaticMarkup(
      createElement(
        SettingsLayout,
        { activeKey: "security", context },
        "安全设置正文",
      ),
    );

    expect(markup).toContain("设置总览");
    expect(markup).toContain("当前设置范围");
    expect(markup).toContain("安全设置正文");
    expect(markup).toContain('aria-current="page"');
    expect(markup).not.toContain("/settings/admin");
  });
});
