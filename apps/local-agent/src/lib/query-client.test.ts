import { describe, expect, it } from "vitest";
import { createWorkbenchContextIdentity } from "@humanthread/workbench-client";

import {
  createDesktopQueryClient,
  workbenchContextQueryPrefix,
} from "./query-client";

describe("desktop query isolation", () => {
  it("uses deployment, session and Space as the removable cache prefix", () => {
    const context = createWorkbenchContextIdentity({
      deploymentUrl: "https://humanthread.example/",
      sessionId: "desktop_session_1",
      spaceKey: "company:company_1",
    });

    expect(workbenchContextQueryPrefix(context)).toEqual([
      "https://humanthread.example",
      "desktop_session_1",
      "company:company_1",
    ]);
    expect(createDesktopQueryClient().getDefaultOptions().queries).toMatchObject({
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 15_000,
    });
  });
});
