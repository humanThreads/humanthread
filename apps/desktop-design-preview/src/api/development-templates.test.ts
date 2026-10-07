import { describe, expect, it } from "vitest";

import { resolveDevelopmentTemplateSpaceId } from "./development-templates";

describe("resolveDevelopmentTemplateSpaceId", () => {
  it("maps personal and company preview space keys to official Space ids", () => {
    expect(resolveDevelopmentTemplateSpaceId({
      spaceKey: "personal",
      userId: "user_1",
    })).toBe("space:personal:user_1");
    expect(resolveDevelopmentTemplateSpaceId({
      spaceKey: "company:company_1",
      userId: "user_1",
    })).toBe("space:company:company_1");
  });
});
