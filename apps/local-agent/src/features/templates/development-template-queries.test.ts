import { describe, expect, it } from "vitest";

import { resolveDevelopmentTemplateSpaceId } from "./development-template-queries";

describe("development template queries", () => {
  it("maps Desktop Space keys to official Space ids", () => {
    expect(resolveDevelopmentTemplateSpaceId({ spaceKey: "personal", userId: "user_1" }))
      .toBe("space:personal:user_1");
    expect(resolveDevelopmentTemplateSpaceId({ spaceKey: "company:company_1", userId: "user_1" }))
      .toBe("space:company:company_1");
  });
});
