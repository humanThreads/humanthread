import { createWorkbenchContextIdentity } from "@humanthread/workbench-client";
import { describe, expect, it } from "vitest";

import {
  buildProjectCollectionSearch,
  parseProjectCollectionQuery,
  projectCollectionQueryKey,
  projectDetailQueryKey,
} from "./project-queries";

describe("desktop Project queries", () => {
  it("normalizes collection filters and preserves the public Space key", () => {
    const query = parseProjectCollectionQuery(new URLSearchParams(
      "search=atlas&status=active&health=blocked",
    ));

    expect(query).toEqual({ search: "atlas", status: "active", health: "blocked" });
    expect(buildProjectCollectionSearch(query, "company:company_1").get("space"))
      .toBe("company:company_1");
  });

  it("scopes collection and detail cache keys to deployment, session and Space", () => {
    const context = createWorkbenchContextIdentity({
      deploymentUrl: "https://ht.example.com",
      sessionId: "session_1",
      spaceKey: "personal",
    });
    const query = parseProjectCollectionQuery(new URLSearchParams());

    expect(projectCollectionQueryKey(context, query).slice(0, 4)).toEqual([
      "https://ht.example.com", "session_1", "personal", "projects",
    ]);
    expect(projectDetailQueryKey(context, "project_1").slice(-2)).toEqual([
      "detail", "project_1",
    ]);
  });
});
