import { describe, expect, it } from "vitest";
import { PROJECT_MEMBER_PAGE_TITLE, dynamic } from "./page";

describe("Project member page", () => {
  it("is a dynamic Project-scoped destination", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(PROJECT_MEMBER_PAGE_TITLE).toBe("项目成员");
  });
});
