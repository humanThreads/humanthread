import { describe, expect, it } from "vitest";
import { layoutLoopNodes } from "./loop-graph-layout";

describe("layoutLoopNodes", () => {
  it("orders shuffled nodes by the executable graph sequence", () => {
    const positions = layoutLoopNodes({
      nodes: ["end", "review", "start", "build"],
      edges: [
        { source: "start", target: "build", kind: "normal" },
        { source: "build", target: "review", kind: "normal" },
        { source: "review", target: "end", kind: "normal" },
      ],
      compact: false,
    });

    expect(positions).toEqual({
      start: { x: 64, y: 96 },
      build: { x: 296, y: 96 },
      review: { x: 528, y: 96 },
      end: { x: 760, y: 96 },
    });
  });

  it("places parallel branches in the same execution layer", () => {
    const positions = layoutLoopNodes({
      nodes: ["end", "branch-b", "start", "branch-a"],
      edges: [
        { source: "start", target: "branch-a", kind: "normal" },
        { source: "start", target: "branch-b", kind: "normal" },
        { source: "branch-a", target: "end", kind: "normal" },
        { source: "branch-b", target: "end", kind: "normal" },
        { source: "branch-b", target: "start", kind: "feedback" },
      ],
      compact: false,
    });

    expect(positions["branch-a"]?.x).toBe(296);
    expect(positions["branch-b"]?.x).toBe(296);
    expect(positions["branch-a"]?.y).toBeLessThan(positions["branch-b"]?.y ?? 0);
  });

  it("uses a single ordered column on compact layouts", () => {
    const positions = layoutLoopNodes({
      nodes: ["end", "start", "build"],
      edges: [{ source: "start", target: "build", kind: "normal" }, { source: "build", target: "end", kind: "normal" }],
      compact: true,
    });

    expect(positions.start).toEqual({ x: 72, y: 48 });
    expect(positions.build).toEqual({ x: 72, y: 198 });
    expect(positions.end).toEqual({ x: 72, y: 348 });
  });
});
