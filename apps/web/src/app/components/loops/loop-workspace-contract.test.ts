import { describe, expect, it } from "vitest";

import { parseLoopWorkspaceProjection } from "./loop-workspace-contract";

const legacy = {
  definitionVersion: 1,
  projectionVersion: 2,
  eventCursor: 3,
  run: { id: "run_1", status: "running", repeatCount: 0, transitionCount: 1, stopReason: null },
  nodes: [],
  edges: [],
  activities: [],
};

describe("LoopRun workspace compatibility contract", () => {
  it("accepts a legacy projection without interaction fields", () => {
    expect(parseLoopWorkspaceProjection(legacy)).toMatchObject({
      run: { id: "run_1" },
      timeline: [],
      currentInteraction: null,
      capabilities: { supportsInteractions: false },
    });
  });

  it("keeps an unknown timeline kind as a generic record", () => {
    const parsed = parseLoopWorkspaceProjection({
      ...legacy,
      timeline: [{ id: "x", kind: "future.kind", occurredAt: "2026-08-05T10:00:00.000Z", summary: "Future event" }],
    });
    expect(parsed.timeline[0]).toMatchObject({ kind: "unknown", sourceKind: "future.kind", summary: "Future event" });
  });
});
