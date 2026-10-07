import { describe, expect, it } from "vitest";
import { createWorkbenchContextIdentity, workbenchQueryKey } from "@humanthread/workbench-client";

import { createDesktopQueryClient } from "../lib/query-client";
import { switchWorkbenchContext } from "./context-switch";

const previous = createWorkbenchContextIdentity({
  deploymentUrl: "https://humanthread.example",
  sessionId: "desktop_session_1",
  spaceKey: "personal",
});
const next = createWorkbenchContextIdentity({
  deploymentUrl: "https://humanthread.example",
  sessionId: "desktop_session_1",
  spaceKey: "company:company_1",
});

describe("workbench context switching", () => {
  it("freezes actions and removes only the previous context before bootstrap", async () => {
    const queryClient = createDesktopQueryClient();
    queryClient.setQueryData(workbenchQueryKey(previous, "dashboard"), { id: "personal" });
    queryClient.setQueryData(workbenchQueryKey(next, "dashboard"), { id: "company" });
    const phases: string[] = [];

    const bootstrap = await switchWorkbenchContext(next, {
      previousContext: previous,
      queryClient,
      setActionsEnabled(enabled) {
        phases.push(enabled ? "enabled" : "disabled");
      },
      async bootstrap(context) {
        phases.push(`bootstrap:${context.spaceKey}`);
        return { activeSpaceKey: context.spaceKey };
      },
    });

    expect(bootstrap).toEqual({ activeSpaceKey: "company:company_1" });
    expect(phases).toEqual([
      "disabled",
      "bootstrap:company:company_1",
      "enabled",
    ]);
    expect(queryClient.getQueryData(workbenchQueryKey(previous, "dashboard")))
      .toBeUndefined();
    expect(queryClient.getQueryData(workbenchQueryKey(next, "dashboard")))
      .toEqual({ id: "company" });
  });

  it("keeps actions frozen when the target bootstrap fails", async () => {
    const queryClient = createDesktopQueryClient();
    const actionStates: boolean[] = [];

    await expect(switchWorkbenchContext(next, {
      previousContext: previous,
      queryClient,
      setActionsEnabled(enabled) {
        actionStates.push(enabled);
      },
      async bootstrap() {
        throw new Error("Space access denied");
      },
    })).rejects.toThrow("Space access denied");

    expect(actionStates).toEqual([false]);
  });
});
