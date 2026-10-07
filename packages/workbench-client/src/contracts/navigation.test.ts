import { describe, expect, it } from "vitest";

import { workbenchNavigationKeySchema } from "./navigation";

describe("workbenchNavigationKeySchema", () => {
  it("accepts the ten supported product domains", () => {
    expect(
      workbenchNavigationKeySchema.array().parse([
        "dashboard",
        "tasks",
        "agents",
        "notifications",
        "team",
        "projects",
        "documents",
        "reports",
        "templates",
        "settings",
      ]),
    ).toHaveLength(10);
  });

  it("rejects routes outside the desktop product contract", () => {
    expect(() => workbenchNavigationKeySchema.parse("admin-secrets")).toThrow();
  });
});
