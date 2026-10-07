import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dynamic, DOCUMENTS_PAGE_SECTION_TITLES } from "./page";
import { WORKBENCH_NAV_ITEMS } from "../components/workbench-nav";

describe("Documents page", () => {
  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("keeps the document center section structure stable", () => {
    expect(DOCUMENTS_PAGE_SECTION_TITLES).toEqual([
      "文档目录",
      "空间文档",
      "项目文档",
      "回收站",
    ]);
  });

  it("is registered in the workbench navigation", () => {
    expect(
      WORKBENCH_NAV_ITEMS.find((item) => item.key === "documents"),
    ).toMatchObject({
      href: "/documents",
      label: "文档中心",
      key: "documents",
    });
  });

  it("uses the full-bleed document workspace shell mode", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).toContain('contentMode="workspace"');
  });

});
