import { describe, expect, it } from "vitest";
import { evaluateWorkflowEdges } from "./workflow";

describe("evaluateWorkflowEdges", () => {
  it("waits for every parallel branch before a join", () => {
    expect(evaluateWorkflowEdges({
      definition: {
        version: 2,
        edges: [
          { from: "build", to: "join", kind: "parallel" },
          { from: "review", to: "join", kind: "parallel" },
          { from: "join", to: "release", kind: "normal" },
        ],
      },
      completed: ["build"],
      failed: [],
      approvals: [],
    })).toEqual({ ready: [], compensation: [] });

    expect(evaluateWorkflowEdges({
      definition: {
        version: 2,
        edges: [
          { from: "build", to: "join", kind: "parallel" },
          { from: "review", to: "join", kind: "parallel" },
          { from: "join", to: "release", kind: "normal" },
        ],
      },
      completed: ["build", "review"],
      failed: [],
      approvals: [],
    })).toEqual({ ready: ["join", "release"], compensation: [] });
  });

  it("emits compensation edges only for failed sources", () => {
    expect(evaluateWorkflowEdges({
      definition: {
        version: 1,
        edges: [
          { from: "review", to: "rollback", kind: "compensation", when: "failed" },
          { from: "review", to: "release", kind: "normal" },
        ],
      },
      completed: [],
      failed: ["review"],
      approvals: [],
    })).toEqual({ ready: [], compensation: ["rollback"] });
  });
});
