import { deriveLoopNotificationLevel } from "@humanthread/db";
import { describe, expect, it } from "vitest";

import {
  codingGraph,
  runAutomatedCodingLoop,
  workspaceFullGrant,
} from "./automated-coding-loop.fixture";

describe("coding Loop release journey", () => {
  it("reworks once and completes without approval under workspace_full", async () => {
    const result = await runAutomatedCodingLoop({
      graph: codingGraph,
      grants: [workspaceFullGrant],
      gateOutcomes: ["rework", "pass"],
    });

    expect(result.run).toEqual({
      status: "completed",
      repeatCount: 1,
      stopReason: null,
    });
    expect(result.approvals).toEqual([]);
    expect(result.nodeActivations.filter((node) => node.nodeKey === "code")).toHaveLength(2);
    expect(result.nodeActivations.filter((node) => node.nodeKey === "tests")).toHaveLength(2);
    expect(result.actions).toHaveLength(4);
    expect(result.actions.every((action) => (
      action.workspaceBindingId === "workspace_1"
      && action.workspaceContained
      && !action.relativePath.startsWith("/")
    ))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("/work/");
    expect(deriveLoopNotificationLevel("loop.run.completed")).toBe("important");
  });
});
