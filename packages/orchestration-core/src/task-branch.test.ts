import { describe, expect, it } from "vitest";
import { deriveTaskBranch } from "./task-branch";

describe("deriveTaskBranch", () => {
  it("uses the persisted UTC creation year and platform short ID", () => {
    expect(deriveTaskBranch({
      createdAt: new Date("2026-08-03T00:00:00.000Z"),
      shortId: "HT100023",
    })).toBe("2026-HT100023");
  });

  it("rejects an unsafe platform short ID", () => {
    expect(() => deriveTaskBranch({ createdAt: new Date(), shortId: "bad/id" })).toThrow();
  });
});
