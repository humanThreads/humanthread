import { describe, expect, it } from "vitest";

import { createWorkbenchContextIdentity } from "./context";
import { workbenchQueryKey } from "./query-keys";

describe("workbenchQueryKey", () => {
  it("prefixes domain input with deployment, session and Space identity", () => {
    const context = createWorkbenchContextIdentity({
      deploymentUrl: "https://ht.example.com/",
      sessionId: "desktop_session_1",
      spaceKey: "company:company_1",
    });

    expect(workbenchQueryKey(context, "tasks", { relation: "assigned" })).toEqual([
      "https://ht.example.com",
      "desktop_session_1",
      "company:company_1",
      "tasks",
      { relation: "assigned" },
    ]);
  });
});
