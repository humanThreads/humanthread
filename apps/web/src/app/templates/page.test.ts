import { describe, expect, it } from "vitest";
import {
  DEVELOPMENT_TEMPLATE_CATEGORY_TABS,
  dynamic,
  TEMPLATES_PAGE_SECTION_TITLES,
} from "./page";
import { WORKBENCH_NAV_ITEMS } from "../components/workbench-nav";

describe("Templates page", () => {
  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("is registered in the workbench navigation", () => {
    expect(
      WORKBENCH_NAV_ITEMS.find((item) => item.key === "templates"),
    ).toMatchObject({
      href: "/templates",
      label: "模板库",
      key: "templates",
    });
  });

  it("exposes the Loop market and my-template tabs", () => {
    expect(TEMPLATES_PAGE_SECTION_TITLES).toEqual(["Loop 市场", "我的模版"]);
    expect(DEVELOPMENT_TEMPLATE_CATEGORY_TABS).toEqual([]);
  });
});
