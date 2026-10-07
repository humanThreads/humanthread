import { describe, expect, it } from "vitest";
import { selectDispatchBatch } from "./dispatch-policy";

describe("selectDispatchBatch", () => {
  it("parallelizes disjoint tasks and serializes conflicting resources", () => {
    expect(selectDispatchBatch({ readyTasks: [{ id: "a", priority: 0, resourceKeys: ["web"], createdAt: new Date("2026-07-21T00:00:00Z") }, { id: "b", priority: 1, resourceKeys: ["db"], createdAt: new Date("2026-07-21T00:00:01Z") }, { id: "c", priority: 2, resourceKeys: ["web"], createdAt: new Date("2026-07-21T00:00:02Z") }], activeRuns: [], resourceLocks: [], projectPolicy: { maxConcurrentRuns: 2 } }).map((task) => task.id)).toEqual(["a", "b"]);
  });
});
