import { describe, expect, it } from "vitest";
import {
  codingGraph,
  runAutomatedCodingLoop,
  workspaceFullGrant,
} from "./automated-coding-loop.fixture";

describe("fully automated coding Loop E2E", () => {
  it("completes code -> tests -> policy gate -> end with workspace_full and no approvals", async () => {
    const result = await runAutomatedCodingLoop({
      graph: codingGraph,
      grants: [workspaceFullGrant],
      gateOutcomes: ["pass"],
    });

    expect(result.run.status).toBe("completed");
    expect(result.approvals).toEqual([]);
    expect(result.actions).toHaveLength(2);
    expect(result.actions.every((action) => (
      action.workspaceBindingId === "workspace_1"
      && action.workspaceContained
      && !action.relativePath.startsWith("/")
      && !action.relativePath.split("/").includes("..")
    ))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("/work/");
    expect(result.nodeActivations.map((node) => node.nodeKey)).toEqual([
      "start",
      "code",
      "tests",
      "policy",
      "end",
    ]);
  });
});
