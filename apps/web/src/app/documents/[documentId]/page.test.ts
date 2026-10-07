import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DOCUMENT_ACCESS_DENIED_MESSAGE, DOCUMENT_ROOT_DETAIL_SECTION_TITLES, dynamic } from "./page";

describe("root document page", () => {
  it("uses the generic document detail structure", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(DOCUMENT_ROOT_DETAIL_SECTION_TITLES).toEqual([
      "文档目录",
      "Markdown 正文",
      "修订记录",
    ]);
  });

  it("uses the full-bleed document workspace shell mode", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).toContain('contentMode="workspace"');
  });

  it("defines an explicit no-access message for direct document links", () => {
    expect(DOCUMENT_ACCESS_DENIED_MESSAGE).toContain("无权限");
  });
});
