import { describe, expect, it } from "vitest";
import {
  codingGraph,
  runAutomatedCodingLoop,
  workspaceFullGrant,
} from "./automated-coding-loop.fixture";

describe("coding Loop feedback exhaustion E2E", () => {
  it("reworks until the configured repeat budget is exhausted", async () => {
    const result = await runAutomatedCodingLoop({
      graph: codingGraph,
      grants: [workspaceFullGrant],
      gateOutcomes: ["rework", "rework", "rework"],
    });

    expect(result.run).toMatchObject({
      status: "exhausted",
      repeatCount: 2,
      stopReason: "max_repeat_count_exhausted",
    });
    expect(result.approvals).toEqual([]);
    expect(result.nodeActivations.filter((node) => node.nodeKey === "code")).toHaveLength(3);
  });
});
